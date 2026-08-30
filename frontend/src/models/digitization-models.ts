/**
 * The digitization API contract, mirroring
 * `las-backend/app/services/digitization/models.py` field for field.
 *
 * Kept in one-to-one correspondence on purpose: when one side changes the other
 * has to, and matching names make that obvious in review. Field names stay
 * `snake_case` because they are the wire format, not local variables — the same
 * convention `analyze-models.ts` already follows.
 */

/** Where a job is in the wizard. */
export type DigitizationPhase =
  | "intake"
  | "cropping"
  | "calibrating"
  | "segmenting"
  | "reviewing"
  | "exporting"
  | "done"
  | "failed";

export type ScaleType = "linear" | "log";

/**
 * How the vectorizer handles a trace that runs off the scale and re-enters on
 * the other side.
 *
 * `"null"` is the default because it is honest: it marks the affected depths
 * unrecovered instead of guessing. `"unwrap"` is exact when every wrap is
 * detected but silently offsets the rest of the log by a full scale range if
 * one is missed.
 */
export type WrapPolicy = "null" | "unwrap" | "ignore";

export type TileLayer = "raster" | "mask";

export interface RasterInfo {
  width: number;
  height: number;
  /** PIL mode; `"1"` for the bilevel scans that dominate historical archives. */
  mode: string;
  image_format: string;
  size_bytes: number;
  n_pages: number;
  dpi: number | null;
}

export interface PreprocessSettings {
  denoise: boolean;
  deskew: boolean;
  /**
   * Off by default. The segmentation model trained on images that *contain* a
   * grid, so stripping it widens the domain gap rather than closing it.
   */
  attenuate_grid: boolean;
}

export interface PreprocessResult {
  applied: string[];
  /** Pass name to the reason it did not run. Never silently empty. */
  skipped: Record<string, string>;
  skew_angle_deg: number | null;
}

/** The single track the user selected, in full-image pixel coordinates. */
export interface TrackCrop {
  x_left: number;
  x_right: number;
  y_top: number;
  y_bottom: number;
}

/**
 * Where automatic track detection stands for one job.
 *
 * `"unavailable"` is distinct from `"failed"`: it means the environment or the
 * page itself rules detection out (no checkpoint on this server, or a page
 * outside the model's training size) rather than something breaking on this
 * particular attempt. The two need different wording — "draw the crop by
 * hand, detection isn't set up here" is not the same message as "detection
 * broke on this page, try again."
 */
export type DetectionStatus = "pending" | "running" | "done" | "failed" | "unavailable";

/**
 * One track the layout model found, in full-image pixel coordinates.
 *
 * Two boxes, not one. `bounds` is the **union** extent — every pixel the
 * model predicted as this track, wobble included — and is what should be
 * drawn: the honest, wobbling shape. `seed_bounds` is a robust **interior**
 * box, always contained within `bounds`, and is what should seed a
 * `TrackCrop` sent to the crop endpoint. Measured wobble reaches 7% of page
 * width, so on a narrow track the union box can include a slice of the
 * neighbouring track — feeding that to the curve digitizer is the exact
 * domain shift the backend's segmentation adapter warns turns into confident
 * garbage, which `seed_bounds` exists to avoid.
 */
export interface DetectedTrack {
  /** Left-to-right position among the tracks found, 0-based. */
  index: number;
  bounds: TrackCrop;
  seed_bounds: TrackCrop;
  confidence: number;
}

/** Where automatic track detection stands for one job, and what it found. */
export interface TrackDetection {
  status: DetectionStatus;
  tracks: DetectedTrack[];
  /**
   * Where the model put the depth-number column, when it found one. Not
   * decoration — on this corpus the GR track (what the MVP digitizes) is the
   * one immediately left of the depth column, so this is what lets the client
   * preselect the right track rather than the widest one.
   */
  depth_column: TrackCrop | null;
  message: string;
  model_version: string;
}

/** The scale and depth range the operator read off the scan header. */
export interface TrackCalibration {
  value_min: number;
  value_max: number;
  depth_top: number;
  depth_bottom: number;
  scale: ScaleType;
  depth_unit: string;
  value_unit: string;
  mnemonic: string;
}

export interface SegmentationSettings {
  threshold: number;
  wrap_policy: WrapPolicy;
  max_gap_px: number | null;
}

export interface SegmentationProgress {
  windows_total: number;
  windows_done: number;
  message: string;
}

export interface CurveQuality {
  coverage: number;
  n_wraps: number;
  n_rows: number;
  n_unrecovered: number;
}

/**
 * A depth slice of the digitized curve, in crop-local pixel columns.
 *
 * `x[i]` is `null` where the trace could not be recovered — which is exactly
 * what the reviewer needs to see, and why a sentinel number would be wrong.
 */
export interface CurveWindow {
  y0: number;
  y1: number;
  stride: number;
  x: Array<number | null>;
  observed: boolean[];
}

export type CurveEditKind = "redraw" | "discard" | "accept";

/**
 * One human correction over a row range, in crop-local coordinates.
 *
 * Edits are append-only and replayed over the model's output, never applied to
 * it destructively. Undo is dropping the last entry, reset is emptying the
 * list, and "how much did the human change" stays answerable for the report.
 */
export interface CurveEdit {
  kind: CurveEditKind;
  y0: number;
  y1: number;
  /** Required for `redraw`; must hold exactly `y1 - y0` entries. */
  x_by_row?: number[];
}

export interface LasHeaderFields {
  well: string;
  company: string;
  field_name: string;
  location: string;
  county: string;
  state: string;
  country: string;
  api: string;
  uwi: string;
}

export interface ExportRequest {
  edits: CurveEdit[];
  header: LasHeaderFields;
  step: number;
}

/** Full job state — what the wizard rehydrates from on every page load. */
export interface JobSummary {
  job_id: string;
  phase: DigitizationPhase;
  file_name: string;
  created_at: number;
  raster: RasterInfo;
  preprocess: PreprocessResult | null;
  /**
   * Required, not optional — every job created going forward carries one, and
   * making it required here is what forces `MockDigitizationGateway` to be
   * updated for this field rather than silently drifting from the real API.
   */
  detection: TrackDetection | null;
  crop: TrackCrop | null;
  calibration: TrackCalibration | null;
  settings: SegmentationSettings | null;
  progress: SegmentationProgress | null;
  quality: CurveQuality | null;
  error: string | null;
}

export interface SendToAnalysisResponse {
  analysis_id: string;
  well_count: number;
  file_name: string;
}

export interface DigitizationHealth {
  available: boolean;
  /** Names the missing piece when `available` is false. Worth showing verbatim. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PREPROCESS: PreprocessSettings = {
  denoise: true,
  deskew: true,
  attenuate_grid: false,
};

/**
 * `max_gap_px` is deliberately finite.
 *
 * The vectorizer's own default is "interpolate every gap", which is right for
 * its closed-loop tests and wrong for a product: a run that finds the trace on
 * 20% of rows would then export a curve with no NULLs at all — four fifths of
 * it a straight line through ink the model never found, and nothing in the file
 * to say so. 25 rows is a dropout of a few grid lines, the kind of gap
 * interpolation genuinely bridges; anything longer is reported as a hole.
 */
export const DEFAULT_SEGMENTATION: SegmentationSettings = {
  threshold: 0.5,
  wrap_policy: "null",
  max_gap_px: 25,
};

/**
 * Gamma ray on a linear scale — the MVP's target curve and the one historical
 * logs almost always carry.
 */
export const DEFAULT_CALIBRATION: TrackCalibration = {
  value_min: 0,
  value_max: 150,
  depth_top: 0,
  depth_bottom: 1000,
  scale: "linear",
  depth_unit: "FT",
  value_unit: "GAPI",
  mnemonic: "GR",
};

export const EMPTY_LAS_HEADER: LasHeaderFields = {
  well: "",
  company: "",
  field_name: "",
  location: "",
  county: "",
  state: "",
  country: "",
  api: "",
  uwi: "",
};

/** The scales printed on historical GR tracks, offered as one-click presets. */
export const GR_SCALE_PRESETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "0–100 GAPI", min: 0, max: 100 },
  { label: "0–150 GAPI", min: 0, max: 150 },
  { label: "0–200 GAPI", min: 0, max: 200 },
];
