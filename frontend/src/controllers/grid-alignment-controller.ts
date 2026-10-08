import type { GridAlignmentSpec, GridPoint, JobSummary, SavedGridAlignment, TrackCalibration } from "../models/digitization-models";

export type ReferenceSide = "left" | "right";
export interface ReferenceDraft { x: string; y: string; confirmed: boolean }
export interface GridAnchorDraft { left: ReferenceDraft; right: ReferenceDraft; depth: string }
export interface GridDraft { geometry_revision: string; depth_unit: string; anchors: GridAnchorDraft[] }

/** Reorder whole intermediate references, never pair points from different lines.
 * Endpoints remain fixed. Blanks stay pending at the end; no depth is inferred. */
export function orderGridLines(draft: GridDraft, selectedIndex: number) {
  const selected = draft.anchors[selectedIndex];
  const middle = draft.anchors.slice(1, -1).sort((a, b) => {
    const x = a.depth.trim() ? Number(a.depth) : NaN, y = b.depth.trim() ? Number(b.depth) : NaN;
    return Number.isFinite(x) ? Number.isFinite(y) ? x-y : -1 : Number.isFinite(y) ? 1 : 0;
  });
  const anchors = [draft.anchors[0], ...middle, draft.anchors.at(-1)!];
  const changed = anchors.some((a, i) => a !== draft.anchors[i]);
  return { draft: changed ? { ...draft, anchors } : draft, index: Math.max(0, anchors.indexOf(selected)) };
}

export function intermediateDepthIssue(draft: GridDraft, index: number): string | null {
  if (index <= 0 || index >= draft.anchors.length-1) return null;
  const text = draft.anchors[index].depth, value = text.trim() ? Number(text) : NaN;
  const top = Number(draft.anchors[0].depth), bottom = Number(draft.anchors.at(-1)!.depth);
  if (!Number.isFinite(value)) return "Enter the depth printed on this line.";
  if (!(value > top && value < bottom)) return `Use a printed depth between ${top} and ${bottom} ${draft.depth_unit}.`;
  if (draft.anchors.some((a, i) => i !== index && a.depth.trim() && Number(a.depth) === value)) return `A reference already exists at ${value} ${draft.depth_unit}. Use a different printed depth.`;
  return null;
}

export function changeGridDepth(draft: GridDraft, index: number, depth: string) {
  const next = { ...draft, anchors: draft.anchors.map((a, i) => i === index ? { ...a, depth } : a) };
  // Invalid/incomplete typing stays visible and blocked, not clamped or guessed.
  return intermediateDepthIssue(next, index) ? { draft: next, index } : orderGridLines(next, index);
}

export function gridGeometryIssues(draft: GridDraft) {
  const issues: Array<{ indices: number[]; message: string }> = [];
  for (let i = 1; i < draft.anchors.length; i++) {
    const a = draft.anchors[i-1], b = draft.anchors[i];
    if (![a, b].every(p => p.left.confirmed && p.right.confirmed && [p.left.x,p.left.y,p.right.x,p.right.y].every(v => v.trim() && Number.isFinite(Number(v))))) continue;
    const label = `${a.depth}–${b.depth} ${draft.depth_unit}`;
    const leftDown = Number(b.left.y)-Number(a.left.y), rightDown = Number(b.right.y)-Number(a.right.y);
    if (!(leftDown >= 2 && rightDown >= 2)) issues.push({ indices:[i-1,i], message:`${label}: ${leftDown < 2 && rightDown < 2 ? "both edges" : leftDown < 2 ? "the LEFT edge" : "the RIGHT edge"} run backwards or overlap on the scan. Check these two printed lines.` });
  }
  return issues;
}

export function effectiveCurveSize(job: JobSummary | null) {
  return { width: job?.alignment?.width ?? (job?.crop ? job.crop.x_right - job.crop.x_left : 0),
    height: job?.alignment?.height ?? (job?.crop ? job.crop.y_bottom - job.crop.y_top : 0) };
}

/** Crop corners are suggestions only, never accepted reference geometry. */
export function initialGridDraft(job: JobSummary): GridDraft {
  const saved = job.alignment;
  const point = (x: number, y: number, confirmed: boolean): ReferenceDraft => ({ x: String(x), y: String(y), confirmed });
  return { geometry_revision: job.geometry_revision ?? "", depth_unit: saved?.depth_unit ?? job.calibration?.depth_unit ?? "",
    anchors: saved ? saved.anchors.map((a) => ({ depth: String(a.depth), left: point(a.left.x, a.left.y, true), right: point(a.right.x, a.right.y, true) })) :
      ["top", "bottom"].map((end) => ({ depth: job.calibration ? String(end === "top" ? job.calibration.depth_top : job.calibration.depth_bottom) : "",
        left: point(job.crop?.x_left ?? 0, (end === "top" ? job.crop?.y_top : job.crop?.y_bottom) ?? 0, false),
        right: point(job.crop?.x_right ?? 0, (end === "top" ? job.crop?.y_top : job.crop?.y_bottom) ?? 0, false) })) };
}

/** A draft can be created before the operator saves physical calibration.
 * Fill only absent endpoint metadata when that calibration becomes available.
 * Coordinates, confirmations, custom depths and intermediate lines are untouched.
 * Actual marked/saved or stale-frame geometry must never be reinterpreted here. */
export function fillEmptyGridMetadata(draft: GridDraft, job: JobSummary): GridDraft {
  if (!job.calibration || job.alignment || draft.geometry_revision !== job.geometry_revision || draft.anchors.some((a) => a.left.confirmed || a.right.confirmed)) return draft;
  let changed = false;
  const depth_unit = draft.depth_unit.trim() ? draft.depth_unit : job.calibration.depth_unit ?? "";
  if (depth_unit !== draft.depth_unit) changed = true;
  const anchors = draft.anchors.map((a, i) => {
    if (a.depth.trim() || (i !== 0 && i !== draft.anchors.length - 1)) return a;
    changed = true;
    return { ...a, depth: String(i === 0 ? job.calibration!.depth_top : job.calibration!.depth_bottom) };
  });
  return changed ? { ...draft, depth_unit, anchors } : draft;
}

export function parseGridDraft(raw: string | null, revision: string): GridDraft | undefined {
  try {
    const value = JSON.parse(raw ?? "null") as GridDraft | null;
    if (value?.geometry_revision === revision && typeof value.depth_unit === "string" && Array.isArray(value.anchors) && value.anchors.length >= 2 && value.anchors.length <= 32 &&
      value.anchors.every((a) => a && typeof a.depth === "string" && [a.left, a.right].every((p) => p && typeof p.x === "string" && typeof p.y === "string" && typeof p.confirmed === "boolean"))) return value;
  } catch { /* An obsolete or malformed draft is retained, not applied. */ }
  return undefined;
}

const numeric = (text: string) => text.trim() ? Number(text) : NaN;
const subtract = (a: GridPoint, b: GridPoint): GridPoint => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: GridPoint, b: GridPoint) => a.x * b.y - a.y * b.x;
const mix = (a: GridPoint, b: GridPoint, t: number): GridPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Float64 spacing, matching the backend's np.spacing(abs(depth)). Read the
 * exponent bits rather than log2, which can round upward near a power of two. */
function depthSpacing(depth: number): number {
  if (!Number.isFinite(depth)) return NaN;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(depth));
  const exponent = (bits.getUint32(0) >>> 20) & 0x7ff;
  return exponent === 0 ? Number.MIN_VALUE : 2 ** (exponent - 1023 - 52);
}

function normalizedAnchorDepths(alignment: SavedGridAlignment): number[] | null {
  const anchors = alignment.anchors;
  if (anchors.length < 2 || anchors.length > 32) return null;
  const first = anchors[0].depth, span = anchors.at(-1)!.depth - first;
  if (!Number.isFinite(first) || !Number.isFinite(span) || span <= 0) return null;
  const relative = anchors.map((a) => (a.depth - first) / span);
  return relative.some((d, i) => !Number.isFinite(d) || (i > 0 && !(d > relative[i - 1]))) ? null : relative;
}

/** Conservative local guard; the server preview/save remains authoritative. */
export function validateGridDraft(draft: GridDraft, job: JobSummary): { errors: string[]; spec: GridAlignmentSpec | null } {
  const errors: string[] = [];
  if (!job.geometry_revision) errors.push("This server does not support grid alignment. Upgrade the digitization API before aligning.");
  else if (draft.geometry_revision !== job.geometry_revision) errors.push("The source geometry changed. Reload references for the current raster before saving.");
  if (!job.crop || !job.calibration) errors.push("Save the crop and calibration before aligning the grid.");
  if (draft.depth_unit !== "FT" && draft.depth_unit !== "M") errors.push("Choose the printed depth unit: FT or M.");
  if (draft.anchors.length < 2 || draft.anchors.length > 32) errors.push("Use 2–32 depth lines, with LEFT and RIGHT references on each.");
  const anchors = draft.anchors.map((a, index) => {
    const left = { x: numeric(a.left.x), y: numeric(a.left.y) }, right = { x: numeric(a.right.x), y: numeric(a.right.y) }, depth = numeric(a.depth);
    if (!a.left.confirmed || !a.right.confirmed) errors.push(`Line ${index + 1}: place and confirm both printed scale references.`);
    if (![left.x, left.y, right.x, right.y, depth].every(Number.isFinite)) errors.push(`Line ${index + 1}: enter finite X, Y and known depth values.`);
    for (const p of [left, right]) {
      if (p.x < 0 || p.y < 0 || p.x > job.raster.width || p.y > job.raster.height) errors.push(`Line ${index + 1}: references must be inside the working raster.`);
      if (job.crop && (p.x < job.crop.x_left || p.x > job.crop.x_right || p.y < job.crop.y_top || p.y > job.crop.y_bottom)) errors.push(`Line ${index + 1}: references must lie within the confirmed enclosing crop.`);
    }
    if (!(right.x - left.x >= 2) || !(Math.hypot(right.x - left.x, right.y - left.y) >= 4)) errors.push(`Line ${index + 1}: RIGHT must be ordered to the right of LEFT and references at least four pixels apart.`);
    if (Math.abs(depth) > 1e9) errors.push(`Line ${index + 1}: depth exceeds supported precision.`);
    return { left, right, depth };
  });
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i];
    if (!(b.depth > a.depth)) errors.push(`Line ${i + 1}: known depths must increase downward.`);
    // A bilinear band's Jacobian is affine. Positive at all four corners rules
    // out local folds/crossings throughout the band, without smoothing anything.
    const top = subtract(a.right, a.left), bottom = subtract(b.right, b.left);
    const left = subtract(b.left, a.left), right = subtract(b.right, a.right);
    if (!(left.y >= 2 && right.y >= 2)) errors.push(`Band ${i}: both sides must advance downward by at least two pixels.`);
    if ([cross(top, left), cross(top, right), cross(bottom, left), cross(bottom, right)].some((v) => !(v > 1e-6))) errors.push(`Band ${i}: references cross, fold or have zero width/height.`);
    else if ([[top, left], [top, right], [bottom, left], [bottom, right]].some(([across, vertical]) => cross(across, vertical) / (Math.hypot(across.x, across.y) * Math.hypot(vertical.x, vertical.y)) < .05)) errors.push(`Band ${i}: excessive shear; use a smaller segment.`);
  }
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const widths = anchors.map((a) => Math.hypot(a.right.x - a.left.x, a.right.y - a.left.y));
  const middleWidth = median(widths);
  if (widths.some((w) => w / middleWidth > 4 || middleWidth / w > 4)) errors.push("Track width changes exceed the local alignment limit. Split this segment.");
  const heights = anchors.slice(1).map((a, i) => (Math.hypot(a.left.x - anchors[i].left.x, a.left.y - anchors[i].left.y) + Math.hypot(a.right.x - anchors[i].right.x, a.right.y - anchors[i].right.y)) / 2);
  const density = heights.map((h, i) => h / (anchors[i + 1].depth - anchors[i].depth)), middleDensity = median(density);
  if (density.some((d) => !Number.isFinite(d) || d / middleDensity > 4 || d / middleDensity < .25)) errors.push("Depth spacing changes exceed the local alignment limit. Verify anchors or split the segment.");
  const width = Math.max(4, Math.round(middleWidth)), height = Math.max(2, Math.round(heights.reduce((s, h) => s + h, 0)));
  if (width > 4096 || height > 250000 || width * height > 64000000) errors.push("Aligned dimensions exceed safe limits. Use a smaller segment.");
  const depthStep = anchors.length >= 2 ? (anchors.at(-1)!.depth - anchors[0].depth) / height : NaN;
  if (depthStep <= 8 * depthSpacing(Math.max(...anchors.map((a) => Math.abs(a.depth))))) errors.push("Depth span is insufficient for aligned row precision. Verify the depth references.");
  if (job.calibration && !matchesCalibration(anchors[0]?.depth, anchors.at(-1)?.depth, draft.depth_unit, job.calibration)) errors.push("First/last depths and unit must match saved calibration. Save your calibration draft first.");
  return { errors, spec: errors.length ? null : { anchors, depth_unit: draft.depth_unit as "FT" | "M" } };
}

function matchesCalibration(first: number | undefined, last: number | undefined, unit: string, cal: TrackCalibration) {
  const same = (a: number | undefined, b: number) => a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= Math.max(1e-8, Math.abs(a) * Number.EPSILON * 8, Math.abs(b) * Number.EPSILON * 8);
  return same(first, cal.depth_top) && same(last, cal.depth_bottom) && unit === cal.depth_unit;
}

/** Canonical row/column → full source raster. Out-of-range unwrap values have
 * no source ink; NULL is a path break, not an extrapolated reference. */
export function projectAlignedPoint(alignment: SavedGridAlignment, x: number, row: number): GridPoint | null {
  if (![x, row, alignment.width, alignment.height].every(Number.isFinite) || alignment.width <= 0 || alignment.height <= 0 || x < 0 || x > alignment.width || row < 0 || row > alignment.height) return null;
  const anchors = alignment.anchors;
  const relativeDepths = normalizedAnchorDepths(alignment);
  if (!relativeDepths) return null;
  // Never form a large absolute depth plus a small row increment: cancellation
  // there would move the Original overlay to the wrong position in its band.
  const depthFraction = row / alignment.height;
  let band = anchors.length - 2;
  for (let i = 0; i < anchors.length - 1; i++) if (depthFraction < relativeDepths[i + 1]) { band = i; break; }
  const a = anchors[band], b = anchors[band + 1];
  const t = (depthFraction - relativeDepths[band]) / (relativeDepths[band + 1] - relativeDepths[band]);
  const result = mix(mix(a.left, b.left, t), mix(a.right, b.right, t), x / alignment.width);
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

/** Include band boundaries so projected NULL polygons follow the saved mesh. */
export function projectedBandPolygon(alignment: SavedGridAlignment, y0: number, y1: number): GridPoint[] {
  const relativeDepths = normalizedAnchorDepths(alignment);
  if (!relativeDepths || ![y0, y1, alignment.width, alignment.height].every(Number.isFinite) || alignment.width <= 0 || alignment.height <= 0) return [];
  const start = Math.max(0, y0), end = Math.min(alignment.height, y1);
  if (end <= start) return [];
  const rows = [start, ...relativeDepths.map((d) => d * alignment.height).filter((r) => r > start && r < end), end];
  return [...rows.map((r) => projectAlignedPoint(alignment, 0, r)), ...rows.reverse().map((r) => projectAlignedPoint(alignment, alignment.width, r))].filter((p): p is GridPoint => p !== null);
}
