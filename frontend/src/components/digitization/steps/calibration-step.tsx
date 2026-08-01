import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

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

  const [calibration, setLocal] = useState<TrackCalibration | null>(null);

  useEffect(() => {
    if (!job || calibration) return;
    setLocal(job.calibration ?? DEFAULT_CALIBRATION);
  }, [job, calibration]);

  const cropWidth = job?.crop ? job.crop.x_right - job.crop.x_left : 0;
  const cropHeight = job?.crop ? job.crop.y_bottom - job.crop.y_top : 0;

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
          The depths at the top and bottom of the crop you selected — not of the whole
          scan. They must increase downward: an interpretation suite rejects a LAS whose
          depth index is not strictly increasing.
        </p>

        <div className={styles.fieldGrid}>
          {numericField("depth_top", "Depth at the top of the crop")}
          {numericField("depth_bottom", "Depth at the bottom of the crop")}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cal-depth-unit">
              Depth unit
            </label>
            <select
              id="cal-depth-unit"
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
            <span className={styles.summaryLabel}>Crop height</span>
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

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => navigate(`/digitize/${job.job_id}/crop`)}
          >
            Back
          </button>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!validation.isValid || setCalibration.isPending}
            onClick={() =>
              setCalibration.mutate(calibration, {
                onSuccess: () => navigate(`/digitize/${job.job_id}/segment`),
              })
            }
          >
            {setCalibration.isPending ? "Saving…" : "Continue to segmentation"}
          </button>
        </div>
      </SectionPanel>
    </>
  );
}
