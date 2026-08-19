import type { TrackCalibration } from "../models/digitization-models";

/**
 * Pixel <-> physical conversions for a calibrated track.
 *
 * A deliberate mirror of `orion_training/calibration.py`. Duplicating
 * arithmetic across a language boundary is normally a smell, but the
 * alternative is worse here: the review canvas has to label its value axis and
 * read out the value under the cursor *live*, at 60 fps, and round-tripping
 * every pointer move to the server for that is not viable.
 *
 * What keeps the two honest is that they are tested against the same numbers —
 * track edges map to the scale endpoints, the log midpoint is the geometric
 * mean, and both directions invert exactly. If this file and the Python ever
 * disagree, the preview the reviewer approved would not match the LAS the
 * backend writes, which is the one bug this whole design exists to prevent.
 *
 * Coordinates here are **crop-local**: column 0 is the crop's left edge, which
 * is the frame the backend's vectorizer and calibration both use.
 */

/** Result of validating a calibration form. Empty `errors` means valid. */
export interface CalibrationValidation {
  errors: Partial<Record<keyof TrackCalibration, string>>;
  isValid: boolean;
}

/**
 * Check a calibration before it is sent.
 *
 * The same rules the backend enforces, applied in the browser so the operator
 * gets them next to the field rather than as a 422 after submitting.
 */
export function validateCalibration(
  calibration: TrackCalibration,
  trackWidthPx: number
): CalibrationValidation {
  const errors: Partial<Record<keyof TrackCalibration, string>> = {};

  if (!Number.isFinite(calibration.value_min)) {
    errors.value_min = "Enter the value printed at the left edge of the track.";
  }
  if (!Number.isFinite(calibration.value_max)) {
    errors.value_max = "Enter the value printed at the right edge of the track.";
  }
  if (calibration.value_min === calibration.value_max) {
    errors.value_max = "The two ends of the scale must differ.";
  }
  if (
    calibration.scale === "log" &&
    Math.min(calibration.value_min, calibration.value_max) <= 0
  ) {
    errors.value_min = "A logarithmic scale needs both ends strictly positive.";
  }

  if (!Number.isFinite(calibration.depth_top)) {
    errors.depth_top = "Enter the depth at the top of the crop.";
  }
  if (!Number.isFinite(calibration.depth_bottom)) {
    errors.depth_bottom = "Enter the depth at the bottom of the crop.";
  }
  if (calibration.depth_bottom <= calibration.depth_top) {
    // Not a nicety: an interpretation suite rejects the whole file over this.
    errors.depth_bottom = "Bottom depth must be greater than top depth.";
  }

  if (!calibration.mnemonic.trim()) {
    errors.mnemonic = "A curve needs a mnemonic, e.g. GR.";
  } else if (/\s/.test(calibration.mnemonic)) {
    errors.mnemonic = "LAS mnemonics cannot contain spaces.";
  }
  if (!calibration.value_unit.trim()) {
    errors.value_unit = "Always give an explicit unit, e.g. GAPI.";
  }

  if (trackWidthPx <= 0) {
    errors.value_min = "Select a track crop first.";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

/**
 * Crop-local pixel column to a physical value.
 *
 * @param x - Pixel column; `null` (unrecovered) passes straight through.
 * @param calibration - The track's scale.
 * @param trackWidthPx - Crop width in pixels.
 * @param clamp - Snap positions outside the track to the nearest edge. On by
 *   default: ink bleeds half a stroke width past the scale edge because the
 *   stroke is centred on the sample, and those pixels mean "at the edge", not
 *   "beyond the scale". Turn it off only with `wrap_policy: "unwrap"`, where an
 *   out-of-track position deliberately encodes an over-scale value.
 */
export function pixelToValue(
  x: number | null,
  calibration: TrackCalibration,
  trackWidthPx: number,
  clamp = true
): number | null {
  if (x === null || !Number.isFinite(x) || trackWidthPx <= 0) return null;

  const position = clamp ? Math.min(Math.max(x, 0), trackWidthPx) : x;
  const fraction = position / trackWidthPx;

  if (calibration.scale === "log") {
    return (
      calibration.value_min *
      Math.pow(calibration.value_max / calibration.value_min, fraction)
    );
  }
  return calibration.value_min + fraction * (calibration.value_max - calibration.value_min);
}

/** Inverse of {@link pixelToValue}, never clamped — the honest inverse. */
export function valueToPixel(
  value: number,
  calibration: TrackCalibration,
  trackWidthPx: number
): number {
  const fraction =
    calibration.scale === "log"
      ? Math.log(value / calibration.value_min) /
        Math.log(calibration.value_max / calibration.value_min)
      : (value - calibration.value_min) /
        (calibration.value_max - calibration.value_min);
  return fraction * trackWidthPx;
}

/**
 * Crop-local row to depth.
 *
 * Top-edge convention, matching `rows_to_depth` in the Python: row 0 sits
 * exactly at `depth_top` and the last row one step short of `depth_bottom`.
 */
export function rowToDepth(
  row: number,
  calibration: TrackCalibration,
  cropHeightPx: number
): number {
  if (cropHeightPx <= 0) return calibration.depth_top;
  const step = (calibration.depth_bottom - calibration.depth_top) / cropHeightPx;
  return calibration.depth_top + row * step;
}

/** Inverse of {@link rowToDepth}. */
export function depthToRow(
  depth: number,
  calibration: TrackCalibration,
  cropHeightPx: number
): number {
  const span = calibration.depth_bottom - calibration.depth_top;
  if (span === 0) return 0;
  return ((depth - calibration.depth_top) / span) * cropHeightPx;
}

/** Depth covered by one pixel row — the vertical resolution of the scan. */
export function depthPerRow(
  calibration: TrackCalibration,
  cropHeightPx: number
): number {
  if (cropHeightPx <= 0) return 0;
  return (calibration.depth_bottom - calibration.depth_top) / cropHeightPx;
}

/** One labelled gridline on the value axis. */
export interface AxisTick {
  value: number;
  /** Crop-local pixel column. */
  x: number;
  label: string;
}

/**
 * Ticks for the value axis drawn across the track.
 *
 * Linear scales get evenly spaced values; logarithmic scales get evenly spaced
 * *pixels*, because that is where a log axis actually puts its decades and
 * evenly spaced values would bunch every tick against the left edge.
 */
export function buildValueTicks(
  calibration: TrackCalibration,
  trackWidthPx: number,
  count = 5
): AxisTick[] {
  if (trackWidthPx <= 0 || count < 2) return [];

  const ticks: AxisTick[] = [];
  for (let i = 0; i < count; i += 1) {
    const fraction = i / (count - 1);
    const x = fraction * trackWidthPx;
    const value = pixelToValue(x, calibration, trackWidthPx, false);
    if (value === null) continue;
    ticks.push({ value, x, label: formatValue(value) });
  }
  return ticks;
}

/** Compact value label: enough precision to be useful, not enough to be noise. */
export function formatValue(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 100) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/** Depth label, at the two decimals LAS conventionally carries. */
export function formatDepth(depth: number, unit: string): string {
  return `${depth.toFixed(2)} ${unit}`;
}
