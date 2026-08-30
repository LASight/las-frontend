import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  type CropSource,
  nextCropSeed,
} from "../../../controllers/detection-controller";
import {
  DEFAULT_PREPROCESS,
  type DetectedTrack,
  type TrackCrop,
} from "../../../models/digitization-models";
import { SectionPanel } from "../../section-panel";
import { defaultCrop, normalizeCrop } from "../cropper/crop-rect";
import { DetectionStatusChip } from "../cropper/detection-status-chip";
import { preferredTrack, trackToCrop } from "../cropper/detected-tracks";
import { TrackCropper } from "../cropper/track-cropper";
import { useJobController } from "../job-context";
import styles from "./step-layout.module.css";
import { TrackPicker } from "./track-picker";

/**
 * Step 2 — clean up the scan and bound the track to digitize.
 *
 * Preprocessing sits here rather than on its own step because the two decisions
 * are made by looking at the same picture: you denoise until the trace is
 * legible, then you draw the crop around it.
 */
export function CropStep() {
  const navigate = useNavigate();
  const { job, setCrop, preprocess, retryDetection } = useJobController();

  const [crop, setLocalCrop] = useState<TrackCrop | null>(null);
  const [settings, setSettings] = useState(DEFAULT_PREPROCESS);
  const [cropSource, setCropSource] = useState<CropSource>("none");
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);

  // Seed the crop from, in order: a crop already saved server-side; the
  // model's preselected track, once detection finishes with a result; or the
  // same untargeted default this step always used before detection existed.
  // Re-runs on every `job` update (so a detection landing after mount, or an
  // improved one after a preprocess re-run, is picked up) but does nothing
  // once the user has touched the rectangle - see `nextCropSeed`.
  useEffect(() => {
    if (!job) return;

    const preferred =
      job.detection?.status === "done" && job.detection.tracks.length > 0
        ? preferredTrack(job.detection.tracks, job.detection.depth_column)
        : null;
    const preferredCrop = preferred ? trackToCrop(preferred, job.raster) : null;

    const seed = nextCropSeed(cropSource, job.crop, job.detection, preferredCrop);
    if (seed) {
      setLocalCrop(seed);
      if (!job.crop) {
        setCropSource("detection");
        setSelectedTrackIndex(preferred?.index ?? null);
      }
      return;
    }

    if (cropSource === "none") {
      setLocalCrop(defaultCrop(job.raster));
      setCropSource("default");
    }
  }, [job, cropSource]);

  if (!job || !crop) return null;

  const preprocessResult = job.preprocess;
  const cropError = crop.y_bottom <= crop.y_top ? "Bottom row must be below top row." : null;
  const detectedTracks = job.detection?.tracks ?? [];

  /**
   * Repair a typed value before it reaches the crop.
   *
   * The `min`/`max` attributes below are advisory — a keyboard ignores them —
   * so without this an inverted or out-of-raster crop reaches the pipeline and
   * produces a calibration that is arithmetically fine and meaningless.
   */
  const editCrop = (patch: Partial<TrackCrop>) => {
    setCropSource("user");
    setLocalCrop(normalizeCrop({ ...crop, ...patch }, job.raster));
  };

  // A click is a deliberate choice, not a provisional guess - treated the
  // same as a manual drag ("user"), so a later re-detection (e.g. after a
  // preprocess re-run) cannot silently override a track the user picked on
  // purpose. Only the auto-preselected track on a still-untouched crop uses
  // the more provisional "detection" source (see the seeding effect above).
  const selectTrack = (track: DetectedTrack) => {
    setCropSource("user");
    setSelectedTrackIndex(track.index);
    setLocalCrop(trackToCrop(track, job.raster));
  };

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

        <DetectionStatusChip
          job={job}
          onRetry={() => retryDetection.mutate()}
          retrying={retryDetection.isPending}
        />

        <TrackPicker
          tracks={detectedTracks}
          selectedIndex={selectedTrackIndex}
          onSelect={selectTrack}
        />

        <TrackCropper
          job={job}
          crop={crop}
          onChange={setLocalCrop}
          detectedTracks={detectedTracks}
          selectedTrackIndex={selectedTrackIndex}
          onSelectTrack={selectTrack}
          onDragStart={() => setCropSource("user")}
        />

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
