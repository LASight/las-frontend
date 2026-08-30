import { detectionNotice, isDetecting } from "../../../controllers/detection-controller";
import type { JobSummary } from "../../../models/digitization-models";
import styles from "./detection-status-chip.module.css";

/**
 * The one-line status affordance for automatic track detection.
 *
 * `aria-live="polite"` because the boxes it describes fade in silently on the
 * canvas — without this, a screen-reader user has no way to know detection
 * ran at all, let alone what it found. `role="status"` pairs with it so the
 * region is announced as a status update rather than requiring focus.
 *
 * Renders nothing once there is nothing to say (no job yet, or the field is
 * absent for a job that predates this feature) — a chip is either useful or
 * it should not exist, never present-but-blank.
 */
type Props = {
  job: JobSummary | null;
  onRetry?: () => void;
  retrying?: boolean;
};

export function DetectionStatusChip({ job, onRetry, retrying }: Props) {
  const notice = detectionNotice(job);
  if (!notice) return null;

  const status = job?.detection?.status;
  const canRetry = Boolean(onRetry) && (status === "failed" || status === "unavailable");

  return (
    <div className={styles.chip} data-status={status} role="status" aria-live="polite">
      {isDetecting(job) && <span className={styles.spinner} aria-hidden="true" />}
      <span>{notice}</span>
      {canRetry && (
        <button
          type="button"
          className={styles.retry}
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? "Retrying…" : "Try again"}
        </button>
      )}
    </div>
  );
}
