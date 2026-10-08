import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import {
  depthPerRow,
  validateCalibration,
} from "../../../controllers/calibration-controller";
import {
  DEFAULT_CALIBRATION,
  GR_SCALE_PRESETS,
  type TrackCalibration,
} from "../../../models/digitization-models";
import { SectionPanel } from "../../section-panel";
import { useJobController } from "../job-context";
import styles from "./step-layout.module.css";
import { effectiveCurveSize } from "../../../controllers/grid-alignment-controller";
import { StandaloneGridAlignment } from "../standalone-grid-alignment";
import { digitizationGateway } from "../../../services/digitization-service";
import { flushCollectionEdits } from "../../../hooks/use-review-edits";
import { curveQueryKey } from "../../../hooks/use-curve-review";
import { getSessionScope, isCurrentSession } from "../../../services/session-scope";

/**
 * Step 3 — enter the track scale and depth range.
 *
 * Every field here is read off the scan by a human. OCR of the header is out of
 * scope (thesis §1.5.2), which makes this the one step no amount of model
 * quality removes — and the one where a mistake is most expensive, because a
 * wrong scale or depth range shifts every recovered value while still producing
 * a curve that looks entirely plausible.
 *
 * So the form validates against the same rules the backend enforces, and shows
 * the derived numbers — depth per pixel row, total interval — because those are
 * what make a wrong entry obvious. A log claiming 4 ft per pixel is wrong in a
 * way that "1200 to 40000" is not.
 */
export function CalibrationStep() {
  const navigate = useNavigate();
  const { job, setCalibration } = useJobController();
  const client = useQueryClient();

  const [calibration, setLocal] = useState<TrackCalibration | null>(null);
  const [geometryBusy, setGeometryBusy] = useState(false);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || calibration) return;
    setLocal(job.calibration ?? DEFAULT_CALIBRATION);
  }, [job, calibration]);

  const { width: cropWidth, height: cropHeight } = effectiveCurveSize(job);

  const validation = useMemo(
    () =>
      calibration
        ? validateCalibration(calibration, cropWidth)
        : { errors: {}, isValid: false },
    [calibration, cropWidth]
  );

  if (!job || !calibration) return null;

  const step = depthPerRow(calibration, cropHeight);
  const interval = calibration.depth_bottom - calibration.depth_top;
  const busy = geometryBusy || calibrationBusy || setCalibration.isPending || job.phase === "segmenting";
  async function saveCalibration(continueToSegment: boolean) {
    if (!job || !calibration || busy) return;
    const session = getSessionScope(); setCalibrationBusy(true); setSaveError(null);
    try {
      const latest = await digitizationGateway.getJob(job.job_id);
      if (!isCurrentSession(session)) return;
      if (latest.phase === "segmenting") throw new Error("Wait for processing to finish before recalibrating.");
      if (job.geometry_revision && latest.geometry_revision !== job.geometry_revision) throw new Error("Source geometry changed. Reload the job before saving this calibration.");
      const changed = JSON.stringify(calibration) !== JSON.stringify(latest.calibration);
      if (changed && (latest.quality || latest.edits?.length || latest.alignment) && !window.confirm(latest.geometry_revision ? "Change this saved calibration? This segment's current work will be archived and its active result cleared. Saved alignment requires the same first/last reference depths and unit; disable alignment first to change those. Continue?" : "Change this saved calibration? This reinterprets recovered values and invalidates the current LAS. Verify these values against the scan. Continue?")) return;
      await flushCollectionEdits(client, [latest]);
      if (!isCurrentSession(session)) return;
      const saved = await setCalibration.mutateAsync(calibration);
      if (!isCurrentSession(session)) return;
      if (!saved.quality || saved.geometry_revision !== latest.geometry_revision) client.removeQueries({ queryKey: curveQueryKey(job.job_id) });
      if (continueToSegment) navigate(`/digitize/${job.job_id}/segment`);
    } catch (err) { if (isCurrentSession(session)) setSaveError(err instanceof Error ? err.message : "Calibration could not be saved."); }
    finally { if (isCurrentSession(session)) setCalibrationBusy(false); }
  }

  function update<K extends keyof TrackCalibration>(key: K, value: TrackCalibration[K]) {
    setLocal((previous) => (previous ? { ...previous, [key]: value } : previous));
  }

  function numericField(
    key: "value_min" | "value_max" | "depth_top" | "depth_bottom",
    label: string,
    hint?: string
  ) {
    const error = validation.errors[key];
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`cal-${key}`}>
          {label}
        </label>
        <input
          id={`cal-${key}`}
          className={`${styles.input} ${error ? styles.inputInvalid : ""}`}
          type="number"
          disabled={busy}
          step="any"
          value={calibration![key]}
          onChange={(event) => update(key, Number(event.target.value))}
        />
        {error ? (
          <span className={styles.fieldError}>{error}</span>
        ) : hint ? (
          <span className={styles.fieldError} style={{ color: "var(--muted)" }}>
            {hint}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <SectionPanel title="Track scale">
        <p className={styles.intro}>
          Read these off the scan's header. The values printed at the left and right
          edges of the track define the horizontal scale; everything the model recovers
          is interpreted through them.
        </p>

        <div className={styles.fieldGrid}>
          {numericField("value_min", "Value at the left edge")}
          {numericField("value_max", "Value at the right edge")}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cal-scale">
              Scale type
            </label>
            <select
              id="cal-scale"
              disabled={busy}
              className={styles.select}
              value={calibration.scale}
              onChange={(event) =>
                update("scale", event.target.value as TrackCalibration["scale"])
              }
            >
              <option value="linear">Linear</option>
              <option value="log">Logarithmic</option>
            </select>
            <span className={styles.fieldError} style={{ color: "var(--muted)" }}>
              Resistivity tracks are usually logarithmic; gamma ray is linear.
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cal-mnemonic">
              Curve mnemonic
            </label>
            <input
              id="cal-mnemonic"
              disabled={busy}
              className={`${styles.input} ${validation.errors.mnemonic ? styles.inputInvalid : ""}`}
              value={calibration.mnemonic}
              onChange={(event) => update("mnemonic", event.target.value)}
            />
            {validation.errors.mnemonic && (
              <span className={styles.fieldError}>{validation.errors.mnemonic}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cal-value-unit">
              Value unit
            </label>
            <input
              id="cal-value-unit"
              disabled={busy}
              className={`${styles.input} ${validation.errors.value_unit ? styles.inputInvalid : ""}`}
              value={calibration.value_unit}
              onChange={(event) => update("value_unit", event.target.value)}
            />
            {validation.errors.value_unit && (
              <span className={styles.fieldError}>{validation.errors.value_unit}</span>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <span className={styles.label}>Common GR scales</span>
          {GR_SCALE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              className={styles.secondaryBtn}
              onClick={() =>
                setLocal((previous) =>
                  previous
                    ? { ...previous, value_min: preset.min, value_max: preset.max }
                    : previous
                )
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel title="Depth range">
        <p className={styles.intro}>
          {job.alignment ? "The depths of the first and last printed grid reference lines — not the enclosing crop margins." : "The depths at the top and bottom of the crop you selected — not of the whole scan."} They must increase downward: an interpretation suite rejects a LAS whose
          depth index is not strictly increasing.
        </p>

        <div className={styles.fieldGrid}>
          {numericField("depth_top", job.alignment ? "First reference depth" : "Depth at the top of the crop")}
          {numericField("depth_bottom", job.alignment ? "Last reference depth" : "Depth at the bottom of the crop")}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cal-depth-unit">
              Depth unit
            </label>
            <select
              id="cal-depth-unit"
              disabled={busy}
              className={styles.select}
              value={calibration.depth_unit}
              onChange={(event) => update("depth_unit", event.target.value)}
            >
              <option value="FT">Feet (FT)</option>
              <option value="M">Metres (M)</option>
            </select>
          </div>
        </div>

        {/* The sanity check that catches a mistyped depth. A scan resolves at
            roughly 0.02–0.2 ft per row; anything far outside that is wrong. */}
        <dl className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Interval</span>
            <span className={styles.summaryValue}>
              {interval.toFixed(1)} {calibration.depth_unit}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{job.alignment ? "Aligned height" : "Crop height"}</span>
            <span className={styles.summaryValue}>{cropHeight.toLocaleString()} rows</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Resolution</span>
            <span className={styles.summaryValue}>
              {step.toFixed(4)} {calibration.depth_unit}/row
            </span>
          </div>
        </dl>

        {Number.isFinite(step) && step > 1 && (
          <p className={styles.notice}>
            {step.toFixed(2)} {calibration.depth_unit} per pixel row is far coarser than
            a scanned log usually resolves. Check the depth range and the crop height.
          </p>
        )}

        {setCalibration.error instanceof Error && (
          <p className={styles.error}>{setCalibration.error.message}</p>
        )}
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy}
            onClick={() => navigate(`/digitize/${job.job_id}/crop`)}
          >
            Back
          </button>
          <div className={styles.spacer} />
          <button type="button" className={styles.secondaryBtn} disabled={!validation.isValid || busy} onClick={() => void saveCalibration(false)}>Save calibration</button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!validation.isValid || busy}
            onClick={() => void saveCalibration(true)}
          >
            {busy ? "Saving…" : "Continue to segmentation"}
          </button>
        </div>
      </SectionPanel>
      <SectionPanel title="Manual grid alignment (optional)"><StandaloneGridAlignment key={job.job_id} job={job} locked={calibrationBusy || setCalibration.isPending} onBusyChange={setGeometryBusy} calibrationChanged={JSON.stringify(calibration) !== JSON.stringify(job.calibration)} /></SectionPanel>
    </>
  );
}
