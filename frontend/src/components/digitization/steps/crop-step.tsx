import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DEFAULT_PREPROCESS, type TrackCrop } from "../../../models/digitization-models";
import { SectionPanel } from "../../section-panel";
import { defaultCrop, normalizeCrop } from "../cropper/crop-rect";
import { TrackCropper } from "../cropper/track-cropper";
import { useJobController } from "../job-context";
import styles from "./step-layout.module.css";

/**
 * Step 2 — clean up the scan and bound the track to digitize.
 *
 * Preprocessing sits here rather than on its own step because the two decisions
 * are made by looking at the same picture: you denoise until the trace is
 * legible, then you draw the crop around it.
 */
export function CropStep() {
  const navigate = useNavigate();
  const { job, setCrop, preprocess } = useJobController();

  const [crop, setLocalCrop] = useState<TrackCrop | null>(null);
  const [settings, setSettings] = useState(DEFAULT_PREPROCESS);

  useEffect(() => {
    if (!job || crop) return;
    setLocalCrop(job.crop ?? defaultCrop(job.raster));
  }, [job, crop]);

  if (!job || !crop) return null;

  const preprocessResult = job.preprocess;
  const cropError = crop.y_bottom <= crop.y_top ? "Bottom row must be below top row." : null;

  /**
   * Repair a typed value before it reaches the crop.
   *
   * The `min`/`max` attributes below are advisory — a keyboard ignores them —
   * so without this an inverted or out-of-raster crop reaches the pipeline and
   * produces a calibration that is arithmetically fine and meaningless.
   */
  const editCrop = (patch: Partial<TrackCrop>) =>
    setLocalCrop(normalizeCrop({ ...crop, ...patch }, job.raster));

  return (
    <>
      <SectionPanel title="Preprocess">
        <p className={styles.intro}>
          Cleanup runs from the original upload each time, so unticking a pass undoes
          it rather than stacking another on top.
        </p>

        <div className={styles.fieldGrid}>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={settings.denoise}
              onChange={(event) =>
                setSettings({ ...settings, denoise: event.target.checked })
              }
            />
            Remove scanner speckle
          </label>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={settings.deskew}
              onChange={(event) =>
                setSettings({ ...settings, deskew: event.target.checked })
              }
            />
            Correct skew
          </label>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={settings.attenuate_grid}
              onChange={(event) =>
                setSettings({ ...settings, attenuate_grid: event.target.checked })
              }
            />
            Attenuate the grid
          </label>
        </div>

        <p className={styles.hint}>
          Grid attenuation is off by default. The segmentation model was trained on
          images that contain a grid, so removing it moves the input further from what
          the model has seen, not closer. Try it only if a heavy grid is visibly
          swamping the trace.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={preprocess.isPending}
            onClick={() => preprocess.mutate(settings)}
          >
            {preprocess.isPending ? "Processing…" : "Apply preprocessing"}
          </button>
        </div>

        {preprocessResult && (
          <>
            <dl className={styles.summary}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Applied</span>
                <span className={styles.summaryValue}>
                  {preprocessResult.applied.join(", ") || "nothing"}
                </span>
              </div>
              {preprocessResult.skew_angle_deg !== null && (
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Measured skew</span>
                  <span className={styles.summaryValue}>
                    {preprocessResult.skew_angle_deg.toFixed(3)}°
                  </span>
                </div>
              )}
            </dl>

            {Object.entries(preprocessResult.skipped).map(([pass, reason]) => (
              <p key={pass} className={styles.notice}>
                <strong>{pass}</strong> was not applied: {reason}
              </p>
            ))}
          </>
        )}
      </SectionPanel>

      <SectionPanel title="Select the track to digitize">
        <p className={styles.intro}>
          Digitize one track at a time. The model was trained on single gamma-ray
          tracks, so cropping to one is not just tidiness — feeding it a whole
          multi-track scan produces confident nonsense.
        </p>

        <TrackCropper job={job} crop={crop} onChange={setLocalCrop} />

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crop-x-left">
              Left column (px)
            </label>
            <input
              id="crop-x-left"
              className={styles.input}
              type="number"
              value={crop.x_left}
              min={0}
              max={crop.x_right - 20}
              onChange={(event) => editCrop({ x_left: Number(event.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crop-x-right">
              Right column (px)
            </label>
            <input
              id="crop-x-right"
              className={styles.input}
              type="number"
              value={crop.x_right}
              min={crop.x_left + 20}
              max={job.raster.width}
              onChange={(event) => editCrop({ x_right: Number(event.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crop-y-top">
              Top row (px)
            </label>
            <input
              id="crop-y-top"
              className={styles.input}
              type="number"
              value={crop.y_top}
              min={0}
              max={crop.y_bottom - 1}
              onChange={(event) => editCrop({ y_top: Number(event.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crop-y-bottom">
              Bottom row (px)
            </label>
            <input
              id="crop-y-bottom"
              className={styles.input}
              type="number"
              value={crop.y_bottom}
              min={crop.y_top + 1}
              max={job.raster.height}
              onChange={(event) => editCrop({ y_bottom: Number(event.target.value) })}
            />
          </div>
        </div>

        <p className={styles.hint}>
          Selection: {crop.x_right - crop.x_left} × {crop.y_bottom - crop.y_top} px.
          Trim the top and bottom rows to exclude the header block and any blank tail —
          whatever you include has to be covered by the depth range on the next step.
        </p>

        {cropError && <p className={styles.error}>{cropError}</p>}
        {setCrop.error instanceof Error && (
          <p className={styles.error}>{setCrop.error.message}</p>
        )}

        <div className={styles.actions}>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!!cropError || setCrop.isPending}
            onClick={() =>
              setCrop.mutate(crop, {
                onSuccess: () => navigate(`/digitize/${job.job_id}/calibrate`),
              })
            }
          >
            {setCrop.isPending ? "Saving…" : "Continue to calibration"}
          </button>
        </div>
      </SectionPanel>
    </>
  );
}
