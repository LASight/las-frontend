import { describe, expect, it } from "vitest";

import {
  canVisitStep,
  describeJobStatus,
  describeSteps,
  hasReachedPhase,
  isRunning,
  nextStep,
  previousStep,
  progressFraction,
  stepForPhase,
  stepPath,
} from "./digitization-job-controller";
import type {
  DigitizationPhase,
  JobSummary,
  TrackCalibration,
  TrackCrop,
} from "../models/digitization-models";

/**
 * The rules behind the wizard's route guards.
 *
 * Making each step a real URL means anyone can deep-link to any of them, so
 * "which steps is this job allowed on, and where should a stray link land"
 * stops being a UI nicety and becomes logic worth pinning down.
 */

const CROP: TrackCrop = { x_left: 100, x_right: 800, y_top: 0, y_bottom: 20_000 };

const CALIBRATION: TrackCalibration = {
  value_min: 0,
  value_max: 150,
  depth_top: 1000,
  depth_bottom: 5000,
  scale: "linear",
  depth_unit: "FT",
  value_unit: "GAPI",
  mnemonic: "GR",
};

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    job_id: "job-1",
    phase: "cropping",
    file_name: "stucky_1.tif",
    created_at: 0,
    raster: {
      width: 1400,
      height: 32_000,
      mode: "1",
      image_format: "TIFF",
      size_bytes: 1,
      n_pages: 1,
      dpi: 300,
    },
    preprocess: null,
    detection: null,
    crop: null,
    calibration: null,
    settings: null,
    progress: null,
    quality: null,
    error: null,
    ...overrides,
  };
}

describe("stepForPhase", () => {
  const cases: Array<[DigitizationPhase, string]> = [
    ["intake", "crop"],
    ["cropping", "crop"],
    ["calibrating", "calibrate"],
    ["segmenting", "segment"],
    ["reviewing", "review"],
    ["exporting", "export"],
    ["done", "export"],
  ];

  it.each(cases)("puts a %s job on the %s step", (phase, step) => {
    expect(stepForPhase(phase)).toBe(step);
  });

  it("resumes a failed job at segmentation, the only unattended stage", () => {
    expect(stepForPhase("failed")).toBe("segment");
  });
});

describe("hasReachedPhase", () => {
  it("is true for the phase itself", () => {
    expect(hasReachedPhase("reviewing", "reviewing")).toBe(true);
  });

  it("is true for an earlier phase", () => {
    expect(hasReachedPhase("done", "reviewing")).toBe(true);
  });

  it("is false for a later phase", () => {
    expect(hasReachedPhase("cropping", "reviewing")).toBe(false);
  });

  it("does not let a failed job into review", () => {
    // Segmentation failed, so there is no curve; /review would show an empty
    // canvas that looks like a data bug.
    expect(hasReachedPhase("failed", "reviewing")).toBe(false);
  });
});

describe("canVisitStep", () => {
  it("blocks every step without a job", () => {
    expect(canVisitStep(null, "crop")).toBe(false);
  });

  it("always allows the crop step", () => {
    expect(canVisitStep(job(), "crop")).toBe(true);
  });

  it("requires a crop before calibration", () => {
    expect(canVisitStep(job(), "calibrate")).toBe(false);
    expect(canVisitStep(job({ crop: CROP }), "calibrate")).toBe(true);
  });

  it("requires both a crop and a calibration before segmenting", () => {
    expect(canVisitStep(job({ crop: CROP }), "segment")).toBe(false);
    expect(
      canVisitStep(job({ crop: CROP, calibration: CALIBRATION }), "segment")
    ).toBe(true);
  });

  it("requires a finished segmentation before review or export", () => {
    const ready = job({ crop: CROP, calibration: CALIBRATION, phase: "segmenting" });
    expect(canVisitStep(ready, "review")).toBe(false);
    expect(canVisitStep({ ...ready, phase: "reviewing" }, "review")).toBe(true);
    expect(canVisitStep({ ...ready, phase: "reviewing" }, "export")).toBe(true);
  });
});

describe("step navigation", () => {
  it("walks forward and stops at the end", () => {
    expect(nextStep("crop")).toBe("calibrate");
    expect(nextStep("export")).toBeNull();
  });

  it("walks backward and stops at the start", () => {
    expect(previousStep("review")).toBe("segment");
    expect(previousStep("crop")).toBeNull();
  });

  it("builds a step path under the job", () => {
    expect(stepPath("abc", "review")).toBe("/digitize/abc/review");
  });
});

describe("describeSteps", () => {
  it("marks unreachable steps locked rather than linking to a redirect", () => {
    const steps = describeSteps(job(), "crop");
    const byId = Object.fromEntries(steps.map((step) => [step.id, step.status]));
    expect(byId.crop).toBe("current");
    expect(byId.calibrate).toBe("locked");
    expect(byId.review).toBe("locked");
  });

  it("marks earlier reachable steps done so a reviewer can go back", () => {
    const ready = job({
      crop: CROP,
      calibration: CALIBRATION,
      phase: "reviewing",
      quality: { coverage: 0.97, n_wraps: 0, n_rows: 20_000, n_unrecovered: 600 },
    });
    const byId = Object.fromEntries(
      describeSteps(ready, "review").map((step) => [step.id, step.status])
    );
    expect(byId.crop).toBe("done");
    expect(byId.calibrate).toBe("done");
    expect(byId.review).toBe("current");
    expect(byId.export).toBe("available");
  });

  it("labels every step", () => {
    expect(describeSteps(job(), "crop").every((step) => step.label.length > 0)).toBe(true);
  });
});

describe("progress", () => {
  it("only reports a job as running while it is segmenting", () => {
    expect(isRunning(job({ phase: "segmenting" }))).toBe(true);
    expect(isRunning(job({ phase: "reviewing" }))).toBe(false);
    expect(isRunning(null)).toBe(false);
  });

  it("has no fraction before any window is planned", () => {
    expect(progressFraction(job())).toBeNull();
    expect(
      progressFraction(
        job({ progress: { windows_total: 0, windows_done: 0, message: "" } })
      )
    ).toBeNull();
  });

  it("reports the fraction of windows done", () => {
    expect(
      progressFraction(
        job({ progress: { windows_total: 160, windows_done: 40, message: "" } })
      )
    ).toBeCloseTo(0.25, 10);
  });

  it("never exceeds 1", () => {
    expect(
      progressFraction(
        job({ progress: { windows_total: 10, windows_done: 99, message: "" } })
      )
    ).toBe(1);
  });
});

describe("describeJobStatus", () => {
  it("says so when nothing is loaded", () => {
    expect(describeJobStatus(null)).toMatch(/no raster/i);
  });

  it("counts windows while segmenting", () => {
    const status = describeJobStatus(
      job({
        phase: "segmenting",
        progress: { windows_total: 160, windows_done: 40, message: "Running" },
      })
    );
    expect(status).toContain("40");
    expect(status).toContain("160");
  });

  it("leads with coverage once a curve exists", () => {
    // Low coverage means the model missed the trace, which no correction fixes;
    // it belongs in the first line the reviewer reads, not buried in a panel.
    const status = describeJobStatus(
      job({
        phase: "reviewing",
        quality: { coverage: 0.643, n_wraps: 2, n_rows: 20_000, n_unrecovered: 7140 },
      })
    );
    expect(status).toContain("64.3%");
  });

  it("surfaces the failure reason verbatim", () => {
    const status = describeJobStatus(
      job({ phase: "failed", error: "RuntimeError: checkpoint missing" })
    );
    expect(status).toContain("checkpoint missing");
  });
});
