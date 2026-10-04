import { describe, expect, it, vi } from "vitest";
import type { CurveEdit } from "../../models/digitization-models";
import { drawCurveOverlay, overlayRuns, REVIEW_OVERLAY_STYLE } from "./curve-overlay";

describe("review overlay presentation, not scientific fidelity", () => {
  it("retains every finite row without resampling, interpolation or input mutation", () => {
    const source = Object.freeze([10, 12, 40, 9, 13, 70]);
    const runs = overlayRuns(source, 0, source.length);
    expect(runs[0].points).toEqual(source.map((x, row) => ({ row, x })));
    expect(source).toEqual([10, 12, 40, 9, 13, 70]);
  });
  it("breaks at a one-row NULL even if distant zoom would have skipped that row", () => {
    const runs = overlayRuns([1, 2, null, 4, 5, NaN, 7, Infinity, 9], 0, 9);
    expect(runs.map((run) => run.points.map((point) => point.row))).toEqual([[0, 1], [3, 4], [6], [8]]);
  });
  it("uses actual redraw provenance, preserves accept, and never classifies discarded NULL as manual data", () => {
    const edits: CurveEdit[] = [
      { kind: "redraw", y0: 1, y1: 4, x_by_row: [10, 20, 30] },
      { kind: "accept", y0: 1, y1: 4 }, { kind: "discard", y0: 2, y1: 3 },
    ];
    const runs = overlayRuns([1, 10, null, 30, 5], 0, 5, edits);
    expect(runs.map((run) => run.kind)).toEqual(["prediction", "manual", "manual", "prediction"]);
    expect(runs.every((run) => !run.points.some((point) => point.row === 2))).toBe(true);
  });
  it("clips to the requested visible range without modifying correction arrays", () => {
    const edits: CurveEdit[] = [{ kind: "redraw", y0: 0, y1: 6, x_by_row: [1, 2, 3, 4, 5, 6] }];
    const snapshot = structuredClone(edits);
    expect(overlayRuns([1, 2, 3, 4, 5, 6], 2, 4, edits)[0].points).toEqual([{ row: 2, x: 3 }, { row: 3, x: 4 }]);
    expect(edits).toEqual(snapshot);
  });
  it.each([1 / 64, 1, 8])("keeps 2.75 CSS-pixel colour and a restrained halo at zoom %s", (scale) => {
    const strokes: Array<{ width: number; color: unknown }> = [];
    const context = { save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      globalAlpha: 1, lineWidth: 0, strokeStyle: "", stroke() { strokes.push({ width: this.lineWidth, color: this.strokeStyle }); } };
    const runs = overlayRuns([10, 20, 30], 0, 3);
    drawCurveOverlay(context as unknown as CanvasRenderingContext2D, runs, { scale, tx: 5, ty: -20 });
    expect(strokes).toEqual([{ width: 4.75, color: "#ffffff" }, { width: 2.75, color: REVIEW_OVERLAY_STYLE.prediction }]);
    expect(context.moveTo).toHaveBeenCalledWith(10 * scale + 5, -20);
    expect(context.lineTo).toHaveBeenCalledWith(30 * scale + 5, 2 * scale - 20);
    expect(context.save).toHaveBeenCalledTimes(3); expect(context.restore).toHaveBeenCalledTimes(3);
  });
});

describe("prediction-only visibility and opacity", () => {
  function canvas() {
    const stack: number[] = [];
    const strokes: Array<{ alpha: number; color: string }> = [];
    return { strokes, globalAlpha: .8, lineWidth: 0, strokeStyle: "", save: vi.fn(function(this: { globalAlpha: number }) { stack.push(this.globalAlpha); }),
      restore: vi.fn(function(this: { globalAlpha: number }) { this.globalAlpha = stack.pop()!; }), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke() { strokes.push({ alpha: this.globalAlpha, color: this.strokeStyle }); } };
  }
  const runs = [
    { kind: "prediction" as const, points: [{ row: 0, x: 1 }, { row: 1, x: 2 }] },
    { kind: "manual" as const, points: [{ row: 1, x: 2 }, { row: 2, x: 3 }] },
  ];
  it("fades both prediction halo and colour, never the manual redraw or caller's alpha", () => {
    const context = canvas(); const snapshot = structuredClone(runs);
    drawCurveOverlay(context as unknown as CanvasRenderingContext2D, runs, { scale: 2, tx: 0, ty: 0 }, { predictionOpacity: 25 });
    expect(context.strokes).toEqual([{ alpha: .2, color: "#ffffff" }, { alpha: .8, color: "#ffffff" }, { alpha: .2, color: REVIEW_OVERLAY_STYLE.prediction }, { alpha: .8, color: REVIEW_OVERLAY_STYLE.manual }]);
    expect(context.globalAlpha).toBe(.8); expect(context.save).toHaveBeenCalledTimes(5); expect(context.restore).toHaveBeenCalledTimes(5); expect(runs).toEqual(snapshot);
  });
  it.each([{ showPrediction: false }, { predictionOpacity: 0 }, { predictionOpacity: -50 }])("draws only corrections when prediction is hidden: %j", (presentation) => {
    const context = canvas();
    drawCurveOverlay(context as unknown as CanvasRenderingContext2D, runs, { scale: 1 / 64, tx: 0, ty: 0 }, presentation);
    expect(context.strokes).toEqual([{ alpha: .8, color: "#ffffff" }, { alpha: .8, color: REVIEW_OVERLAY_STYLE.manual }]);
    expect(context.globalAlpha).toBe(.8); expect(context.save).toHaveBeenCalledTimes(3); expect(context.restore).toHaveBeenCalledTimes(3);
  });
  it("does not reconstruct a NULL path when re-enabled", () => {
    const series = Object.freeze([1, 2, null, 4, 5]);
    const paths = overlayRuns(series, 0, series.length);
    const context = canvas();
    drawCurveOverlay(context as unknown as CanvasRenderingContext2D, paths, { scale: 1, tx: 0, ty: 0 }, { showPrediction: false });
    expect(context.strokes).toEqual([]);
    drawCurveOverlay(context as unknown as CanvasRenderingContext2D, paths, { scale: 1, tx: 0, ty: 0 });
    expect(paths.map((run) => run.points.map((point) => point.row))).toEqual([[0, 1], [3, 4]]);
    expect(series).toEqual([1, 2, null, 4, 5]);
  });
});
