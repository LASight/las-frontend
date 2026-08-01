import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { progressFraction } from "../../../controllers/digitization-job-controller";
import {
  DEFAULT_SEGMENTATION,
  type SegmentationSettings,
} from "../../../models/digitization-models";
import { digitizationGateway } from "../../../services/digitization-service";
import { SectionPanel } from "../../section-panel";
import { useJobController } from "../job-context";
import segStyles from "./segmentation-step.module.css";
import styles from "./step-layout.module.css";

/**
 * Step 4 — run the segmentation model over the cropped track.
 *
 * The only stage the server runs unattended, and the slow one: tiled inference
 * over a full-length log is roughly 160 windows and minutes of CPU. So the
 * request returns `202` and this polls, showing a real denominator rather than
 * an indefinite spinner.
 *
 * It also checks up front whether the model is even installed. Discovering that
 * after filling in a crop and a calibration would be a poor way to find out.
 */
export function SegmentationStep() {
  const navigate = useNavigate();
  const { job, startSegmentation } = useJobController();
  const [settings, setSettings] = useState<SegmentationSettings>(DEFAULT_SEGMENTATION);

  const health = useQuery({
    queryKey: ["digitization", "health"],
    queryFn: () => digitizationGateway.health(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (job?.settings) setSettings(job.settings);
  }, [job?.settings]);

  // The server flips the phase to "reviewing" when the run lands; the poll picks
  // that up and the wizard moves on without the user watching for it.
  useEffect(() => {
    if (job?.phase === "reviewing") {
      navigate(`/digitize/${job.job_id}/review`, { replace: true });
    }
  }, [job?.phase, job?.job_id, navigate]);

  if (!job) return null;

  const running = job.phase === "segmenting";
  const fraction = progressFraction(job);
  const modelUnavailable = health.data && !health.data.available;

  return (
    <>
      <SectionPanel title="Segmentation">
        <p className={styles.intro}>
          The model slides a 1,024-pixel window down the track with 25% overlap,
          predicting each window at training scale and averaging the overlaps. The
          resulting mask is then reduced to one trace position per depth row.
        </p>

        {modelUnavailable && (
          <p className={styles.error}>
            Segmentation is unavailable: {health.data?.reason}
          </p>
        )}

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="seg-threshold">
              Probability threshold
            </label>
            <input
              id="seg-threshold"
              className={styles.input}
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={settings.threshold}
              disabled={running}
              onChange={(event) =>
                setSettings({ ...settings, threshold: Number(event.target.value) })
              }
            />
            <span className={styles.fieldError} style={{ color: "var(--muted)" }}>
              Raise to 0.6–0.7 if the mask latches onto grid lines.
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="seg-wrap">
              Wrap handling
            </label>
            <select
              id="seg-wrap"
              className={styles.select}
              value={settings.wrap_policy}
              disabled={running}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  wrap_policy: event.target.value as SegmentationSettings["wrap_policy"],
                })
              }
            >
              <option value="null">Mark as unrecovered (recommended)</option>
              <option value="unwrap">Unwrap to values beyond the scale</option>
              <option value="ignore">Leave as-is</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="seg-gap">
              Max interpolated gap (rows)
            </label>
            <input
              id="seg-gap"
              className={styles.input}
              type="number"
              min={0}
              placeholder="unlimited"
              value={settings.max_gap_px ?? ""}
              disabled={running}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  max_gap_px: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
            <span className={styles.fieldError} style={{ color: "var(--muted)" }}>
              Longer gaps stay unrecovered and export as NULL.
            </span>
          </div>
        </div>

        <p className={styles.hint}>
          When the trace runs off the scale it re-enters on the opposite edge.
          Unwrapping is exact if every wrap is caught, but a single missed one silently
          offsets the rest of the log by a full scale range — which is why marking those
          rows unrecovered is the default. It reports what it could not read instead of
          guessing.
        </p>

        {job.error && <p className={styles.error}>{job.error}</p>}
        {startSegmentation.error instanceof Error && (
          <p className={styles.error}>{startSegmentation.error.message}</p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={running}
            onClick={() => navigate(`/digitize/${job.job_id}/calibrate`)}
          >
            Back
          </button>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={running || startSegmentation.isPending || !!modelUnavailable}
            onClick={() => startSegmentation.mutate(settings)}
          >
            {running
              ? "Running…"
              : job.phase === "failed"
                ? "Retry segmentation"
                : "Run segmentation"}
          </button>
        </div>
      </SectionPanel>

      {(running || fraction !== null) && (
        <SectionPanel title="Progress">
          <div className={segStyles.progressTrack}>
            <div
              className={segStyles.progressFill}
              style={{ width: `${(fraction ?? 0) * 100}%` }}
            />
          </div>
          <p className={segStyles.progressText}>
            {job.progress
              ? `${job.progress.message} — window ${job.progress.windows_done} of ${job.progress.windows_total}`
              : "Starting…"}
          </p>
          <p className={styles.hint}>
            This runs on CPU. A full-length log takes several minutes; the page can be
            left and reopened at this URL without losing the run.
          </p>
        </SectionPanel>
      )}
    </>
  );
}
