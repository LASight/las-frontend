import { describe, expect, it } from "vitest";

import type { JobSummary, TrackCrop, TrackDetection } from "../models/digitization-models";
import { detectionNotice, isDetecting, nextCropSeed } from "./detection-controller";

function jobWith(detection: TrackDetection | null): JobSummary {
  return {
    job_id: "job-1",
    phase: "cropping",
    file_name: "stucky_1.tif",
    created_at: 0,
    raster: { width: 1400, height: 24000, mode: "1", image_format: "TIFF", size_bytes: 0, n_pages: 1, dpi: null },
    preprocess: null,
    detection,
    crop: null,
    calibration: null,
    settings: null,
    progress: null,
    quality: null,
    error: null,
  };
}

const CROP: TrackCrop = { x_left: 60, x_right: 560, y_top: 0, y_bottom: 24000 };

describe("isDetecting", () => {
  it("is true while pending or running", () => {
    expect(isDetecting(jobWith({ status: "pending", tracks: [], depth_column: null, message: "", model_version: "" }))).toBe(true);
    expect(isDetecting(jobWith({ status: "running", tracks: [], depth_column: null, message: "", model_version: "" }))).toBe(true);
  });

  it("is false once resolved, whichever way", () => {
    for (const status of ["done", "failed", "unavailable"] as const) {
      expect(isDetecting(jobWith({ status, tracks: [], depth_column: null, message: "", model_version: "" }))).toBe(false);
    }
  });

  it("is false for a job with no detection state yet", () => {
    expect(isDetecting(jobWith(null))).toBe(false);
  });

  it("is false for a null job", () => {
    expect(isDetecting(null)).toBe(false);
  });
});

describe("detectionNotice", () => {
  it("does not read as a failure when the model simply found nothing", () => {
    const notice = detectionNotice(
      jobWith({ status: "done", tracks: [], depth_column: null, message: "", model_version: "v1" })
    );
    expect(notice.toLowerCase()).not.toContain("fail");
    expect(notice).toContain("draw the crop");
  });

  it("distinguishes unavailable from failed", () => {
    const unavailable = detectionNotice(
      jobWith({ status: "unavailable", tracks: [], depth_column: null, message: "no checkpoint", model_version: "" })
    );
    const failed = detectionNotice(
      jobWith({ status: "failed", tracks: [], depth_column: null, message: "boom", model_version: "" })
    );
    expect(unavailable).not.toBe(failed);
    expect(failed).toContain("boom");
  });

  it("reports the count when tracks were found", () => {
    const one = detectionNotice(
      jobWith({
        status: "done",
        tracks: [{ index: 0, bounds: CROP, seed_bounds: CROP, confidence: 0.9 }],
        depth_column: null, message: "", model_version: "v1",
      })
    );
    expect(one).toContain("1");

    const three = detectionNotice(
      jobWith({
        status: "done",
        tracks: [0, 1, 2].map((i) => ({ index: i, bounds: CROP, seed_bounds: CROP, confidence: 0.9 })),
        depth_column: null, message: "", model_version: "v1",
      })
    );
    expect(three).toContain("3");
  });

  it("is empty when there is no detection state at all", () => {
    expect(detectionNotice(jobWith(null))).toBe("");
  });
});

describe("nextCropSeed", () => {
  const DONE_WITH_TRACKS: TrackDetection = {
    status: "done",
    tracks: [{ index: 0, bounds: CROP, seed_bounds: CROP, confidence: 0.9 }],
    depth_column: null,
    message: "",
    model_version: "v1",
  };
  const PENDING: TrackDetection = {
    status: "pending", tracks: [], depth_column: null, message: "", model_version: "",
  };

  it("a persisted crop always wins, regardless of source or detection", () => {
    const persisted: TrackCrop = { x_left: 1, x_right: 2, y_top: 0, y_bottom: 10 };
    expect(nextCropSeed("none", persisted, DONE_WITH_TRACKS, CROP)).toBe(persisted);
    expect(nextCropSeed("user", persisted, DONE_WITH_TRACKS, CROP)).toBe(persisted);
  });

  it("never overwrites once the user has touched the crop", () => {
    // The core guarantee: a detection landing mid-drag must not clobber it.
    expect(nextCropSeed("user", null, DONE_WITH_TRACKS, CROP)).toBeNull();
  });

  it("adopts the preselected crop once detection finishes with a result", () => {
    expect(nextCropSeed("none", null, DONE_WITH_TRACKS, CROP)).toBe(CROP);
    expect(nextCropSeed("default", null, DONE_WITH_TRACKS, CROP)).toBe(CROP);
  });

  it("keeps replacing a provisional seed as detection improves, until the user acts", () => {
    // e.g. after a preprocess re-run superseded an earlier "detection" adoption.
    expect(nextCropSeed("detection", null, DONE_WITH_TRACKS, CROP)).toBe(CROP);
  });

  it("has nothing to offer while detection is still running", () => {
    expect(nextCropSeed("none", null, PENDING, CROP)).toBeNull();
  });

  it("has nothing to offer when detection finished with zero tracks", () => {
    const empty: TrackDetection = { status: "done", tracks: [], depth_column: null, message: "", model_version: "v1" };
    expect(nextCropSeed("none", null, empty, null)).toBeNull();
  });

  it("has nothing to offer with no detection state at all", () => {
    expect(nextCropSeed("none", null, null, CROP)).toBeNull();
  });
});
