import type { CurveEdit, SavedGridAlignment } from "../../models/digitization-models";
import { projectAlignedPoint } from "../../controllers/grid-alignment-controller";
import type { ViewTransform } from "./cropper/viewport-transform";

/** Screen/CSS-pixel widths: context uses DPR, coordinates use view transform.
 * A neutral opaque under-stroke separates coloured data from black grid ink;
 * no glow, smoothing, invented confidence, or changes to the source bitmap. */
export const REVIEW_OVERLAY_STYLE = {
  prediction: "#1958b7", manual: "#b44b14", halo: "#ffffff", width: 2.75, haloWidth: 4.75,
} as const;
export interface OverlayRun { kind: "prediction" | "manual"; points: Array<{ row: number; x: number }> }

/** Every finite source row is retained. NULL/non-finite rows break paths even
 * at distant zooms; there is no visual resampling that could bridge a dropout. */
export function overlayRuns(x: readonly (number | null)[], firstRow: number, lastRow: number, edits: readonly CurveEdit[] = []): OverlayRun[] {
  const start = Math.max(0, Math.floor(firstRow));
  const end = Math.min(x.length, Math.ceil(lastRow));
  const manual = new Uint8Array(Math.max(0, end - start));
  for (const edit of edits) {
    if (edit.kind === "accept") continue;
    for (let row = Math.max(start, edit.y0); row < Math.min(end, edit.y1); row++) {
      if (edit.kind === "discard") manual[row - start] = 0;
      else if (edit.x_by_row?.[row - edit.y0] !== undefined) manual[row - start] = 1;
    }
  }
  const runs: OverlayRun[] = [];
  let run: OverlayRun | null = null;
  let previous: { row: number; x: number } | null = null;
  for (let row = start; row < end; row++) {
    const value = x[row];
    if (value === null || value === undefined || !Number.isFinite(value)) { run = null; previous = null; continue; }
    const kind = manual[row - start] ? "manual" : "prediction";
    if (!run || run.kind !== kind) {
      run = { kind, points: previous ? [previous] : [] };
      runs.push(run);
    }
    previous = { row, x: value };
    run.points.push(previous);
  }
  return runs;
}

export interface OverlayPresentation { showPrediction?: boolean; predictionOpacity?: number }

/** Project each retained row; never connect across NULL or off-mesh unwraps. */
export function projectOverlayRuns(runs: OverlayRun[], alignment: SavedGridAlignment): OverlayRun[] {
  const projected: OverlayRun[] = [];
  for (const run of runs) {
    let current: OverlayRun | null = null;
    for (const point of run.points) {
      const source = projectAlignedPoint(alignment, point.x, point.row);
      if (!source) { current = null; continue; }
      if (!current) { current = { kind: run.kind, points: [] }; projected.push(current); }
      current.points.push({ x: source.x, row: source.y });
    }
  }
  return projected;
}

export function drawCurveOverlay(context: CanvasRenderingContext2D, runs: OverlayRun[], view: ViewTransform, presentation: OverlayPresentation = {}): void {
  const opacity = Number.isFinite(presentation.predictionOpacity ?? 100) ? Math.max(0, Math.min(100, presentation.predictionOpacity ?? 100)) / 100 : 1;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash([]);
  // Paint all halos first, then all data, so one halo cannot erase an adjacent
  // semantic colour at the boundary of a manual redraw.
  for (const halo of [true, false]) {
    for (const run of runs) {
      if (run.kind === "prediction" && (presentation.showPrediction === false || opacity === 0)) continue;
      context.save();
      // Both prediction strokes (including the white under-stroke) fade. Manual
      // corrections keep the caller's alpha and remain visible independently.
      if (run.kind === "prediction") context.globalAlpha *= opacity;
      context.strokeStyle = halo ? REVIEW_OVERLAY_STYLE.halo : REVIEW_OVERLAY_STYLE[run.kind];
      context.lineWidth = halo ? REVIEW_OVERLAY_STYLE.haloWidth : REVIEW_OVERLAY_STYLE.width;
      context.beginPath();
      run.points.forEach((point, index) => {
        const x = point.x * view.scale + view.tx;
        const y = point.row * view.scale + view.ty;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      if (run.points.length === 1) {
        const point = run.points[0];
        context.arc(point.x * view.scale + view.tx, point.row * view.scale + view.ty, context.lineWidth / 2, 0, 2 * Math.PI);
        context.fillStyle = context.strokeStyle; context.fill();
      } else context.stroke();
      context.restore();
    }
  }
  context.restore();
}
