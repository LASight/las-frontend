import type { DigitizationPhase, JobSummary } from "../models/digitization-models";

/**
 * The wizard's state machine, as pure functions.
 *
 * Deliberately outside React and outside the gateway. The rules about which
 * step a job may be on, and which step it should resume at, are the kind of
 * logic that is easy to get subtly wrong and painful to debug through a UI —
 * so they live here, where a test can assert them directly with no DOM and no
 * network.
 *
 * The server holds the authoritative job. This module never *decides* a
 * transition; it interprets the phase the server reports and answers the two
 * questions the router needs: has this job reached a given step, and where
 * should a deep link land.
 */

/** Wizard steps, in order. */
export const STEPS = [
  "crop",
  "calibrate",
  "segment",
  "review",
  "export",
] as const;

export type StepId = (typeof STEPS)[number];

/** How far a job in each phase has progressed through the steps. */
const PHASE_TO_STEP: Record<DigitizationPhase, StepId> = {
  intake: "crop",
  cropping: "crop",
  calibrating: "calibrate",
  segmenting: "segment",
  reviewing: "review",
  exporting: "export",
  done: "export",
  // A failed job resumes at the step that failed, which is always segmentation
  // in practice: it is the only stage that runs unattended.
  failed: "segment",
};

/** Phases ordered by how far the job has got, for "has it reached X" checks. */
const PHASE_ORDER: DigitizationPhase[] = [
  "intake",
  "cropping",
  "calibrating",
  "segmenting",
  "reviewing",
  "exporting",
  "done",
];

function phaseRank(phase: DigitizationPhase): number {
  // "failed" is not on the ladder — it is a state a job falls into, not a stage
  // it passes through — so it ranks with the phase it failed during.
  if (phase === "failed") return PHASE_ORDER.indexOf("segmenting");
  const index = PHASE_ORDER.indexOf(phase);
  return index === -1 ? 0 : index;
}

/** The step a job in this phase belongs on. */
export function stepForPhase(phase: DigitizationPhase): StepId {
  return PHASE_TO_STEP[phase] ?? "crop";
}

/**
 * Whether a job has progressed at least as far as `required`.
 *
 * What the route guard asks. A deep link to `/review` on a job that has not
 * been segmented should redirect to the step it is actually on, not render a
 * page with nothing behind it.
 */
export function hasReachedPhase(
  phase: DigitizationPhase,
  required: DigitizationPhase
): boolean {
  return phaseRank(phase) >= phaseRank(required);
}

/** Whether a step is reachable given the job's phase. */
export function canVisitStep(job: JobSummary | null, step: StepId): boolean {
  if (!job) return false;

  switch (step) {
    case "crop":
      return true;
    case "calibrate":
      return job.crop !== null;
    case "segment":
      return job.crop !== null && job.calibration !== null;
    case "review":
    case "export":
      return hasReachedPhase(job.phase, "reviewing");
    default:
      return false;
  }
}

/** The step after `step`, or `null` at the end of the wizard. */
export function nextStep(step: StepId): StepId | null {
  const index = STEPS.indexOf(step);
  return index >= 0 && index < STEPS.length - 1 ? STEPS[index + 1] : null;
}

/** The step before `step`, or `null` at the start. */
export function previousStep(step: StepId): StepId | null {
  const index = STEPS.indexOf(step);
  return index > 0 ? STEPS[index - 1] : null;
}

/** A step's route under `/digitize/:jobId`. */
export function stepPath(jobId: string, step: StepId): string {
  return `/digitize/${jobId}/${step}`;
}

export type StepStatus = "done" | "current" | "available" | "locked";

export interface StepDescriptor {
  id: StepId;
  label: string;
  status: StepStatus;
  path: string;
}

const STEP_LABELS: Record<StepId, string> = {
  crop: "Select track",
  calibrate: "Calibrate",
  segment: "Segment",
  review: "Review",
  export: "Export LAS",
};

/**
 * Describe every step for the wizard's progress bar.
 *
 * Steps ahead of the job come back `"locked"` so they render as unreachable
 * rather than as links that would bounce off the route guard — telling the user
 * why they cannot go there beats letting them try and get redirected.
 */
export function describeSteps(
  job: JobSummary | null,
  currentStep: StepId
): StepDescriptor[] {
  const currentIndex = STEPS.indexOf(currentStep);

  return STEPS.map((id, index) => {
    let status: StepStatus;
    if (id === currentStep) status = "current";
    else if (!canVisitStep(job, id)) status = "locked";
    else if (index < currentIndex) status = "done";
    else status = "available";

    return {
      id,
      label: STEP_LABELS[id],
      status,
      path: job ? stepPath(job.job_id, id) : "#",
    };
  });
}

/** Whether the job is mid-segmentation, i.e. the client should keep polling. */
export function isRunning(job: JobSummary | null): boolean {
  return job?.phase === "segmenting";
}

/** Progress as a fraction in `[0, 1]`, or `null` when nothing is running. */
export function progressFraction(job: JobSummary | null): number | null {
  const progress = job?.progress;
  if (!progress || progress.windows_total <= 0) return null;
  return Math.min(1, progress.windows_done / progress.windows_total);
}

/**
 * A one-line description of where the job stands, for the sidebar status.
 *
 * Reports coverage as soon as it is known: low coverage means the segmentation
 * missed the trace, and no amount of post-processing fixes that — the reviewer
 * needs to see it rather than infer it from a curve that looks confident.
 */
export function describeJobStatus(job: JobSummary | null): string {
  if (!job) return "No raster loaded.";

  switch (job.phase) {
    case "intake":
    case "cropping":
      return `${job.file_name} — select the track to digitize.`;
    case "calibrating":
      return "Enter the track scale and depth range.";
    case "segmenting": {
      const progress = job.progress;
      if (!progress || progress.windows_total === 0) return "Starting segmentation…";
      return `Segmenting: window ${progress.windows_done} of ${progress.windows_total}.`;
    }
    case "reviewing":
    case "exporting":
      return job.quality
        ? `Trace recovered on ${(job.quality.coverage * 100).toFixed(1)}% of rows.`
        : "Ready for review.";
    case "done":
      return "LAS exported.";
    case "failed":
      return `Segmentation failed: ${job.error ?? "unknown error"}`;
    default:
      return "";
  }
}
