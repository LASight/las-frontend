import type { JobSummary, TrackCrop, TrackDetection } from "../models/digitization-models";

/**
 * Automatic track detection's state machine, as pure functions — the
 * detection analogue of `digitization-job-controller.ts`.
 *
 * Kept as its **own** module rather than folded into that controller:
 * detection is not a wizard phase (`create_job` schedules it in the
 * background and it never touches `phase`), so mixing it into the
 * phase/step logic would give one module two unrelated jobs and put this
 * feature's tests inside a file that already has 31 of its own.
 */

/** True while detection is in flight - the only time the crop step should poll. */
export function isDetecting(job: JobSummary | null): boolean {
  const status = job?.detection?.status;
  return status === "pending" || status === "running";
}

/**
 * A short status line for the crop step's banner.
 *
 * Wording matters here more than most strings in this app: "no tracks found"
 * must not read as a failure (it is a normal outcome on an unusual page), and
 * "unavailable" must not read as "detection broke on your page" (it means the
 * model is not set up on this server at all, or the page falls outside what it
 * was trained on) — the fix for each is different, and conflating them would
 * send a user chasing the wrong problem.
 */
export function detectionNotice(job: JobSummary | null): string {
  const detection = job?.detection;
  if (!detection) return "";

  switch (detection.status) {
    case "pending":
    case "running":
      // "Loading the model..." rather than "Finding tracks...": the first
      // request after the server starts pays several seconds for a cold
      // import, during which "finding tracks" would be a lie.
      return "Looking for tracks…";
    case "done":
      if (detection.tracks.length === 0) {
        return "Couldn't find the track columns automatically — draw the crop below.";
      }
      return detection.tracks.length === 1
        ? "Found 1 track."
        : `Found ${detection.tracks.length} tracks.`;
    case "failed":
      return detection.message
        ? `Detection failed: ${detection.message}`
        : "Detection failed — draw the crop below.";
    case "unavailable":
      return "Automatic detection isn't available here — draw the crop below.";
    default:
      return "";
  }
}

/** Where the crop rectangle currently on screen came from. */
export type CropSource = "none" | "default" | "detection" | "user";

/**
 * What the local crop should become right now, or `null` to leave it alone.
 *
 * Three rules, in order:
 *
 * 1. A **persisted** crop (`job.crop`, already saved via a previous
 *    `POST /crop`) always wins — it is a decision the user already committed
 *    to, on this visit or an earlier one, and nothing should second-guess it.
 * 2. Once the user has touched the rectangle (`source === "user"`), detection
 *    arriving or changing must never move it. Track boxes routinely land
 *    *after* the user has already started dragging (detection takes about a
 *    second; a user can start editing well within that), and clobbering an
 *    in-progress edit is the one mistake this whole feature cannot afford to
 *    make even once.
 * 3. Otherwise, adopt the preselected track the moment detection finishes
 *    with at least one result. This applies whether the crop is still
 *    untouched (`"none"`/`"default"`) or was itself adopted from an earlier,
 *    since-superseded detection (`"detection"`) — e.g. after a preprocess
 *    re-run - so an improved result keeps replacing a provisional one for as
 *    long as the user has not weighed in.
 *
 * Call this from a `useEffect` keyed on `[job.crop, job.detection, source]`;
 * a `null` return means "nothing to seed yet," and the caller falls back to
 * `defaultCrop(raster)` exactly as it did before this feature existed.
 */
export function nextCropSeed(
  source: CropSource,
  persistedCrop: TrackCrop | null,
  detection: TrackDetection | null,
  preferredCrop: TrackCrop | null
): TrackCrop | null {
  if (persistedCrop) return persistedCrop;
  if (source === "user") return null;
  if (detection?.status === "done" && detection.tracks.length > 0) {
    return preferredCrop;
  }
  return null;
}
