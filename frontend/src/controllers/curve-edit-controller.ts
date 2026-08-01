import type { CurveEdit } from "../models/digitization-models";

/**
 * Replaying human corrections over the model's curve.
 *
 * Pure functions over plain arrays, deliberately outside React: this is the
 * logic that decides what ends up in the exported LAS, so it is the part that
 * most needs to be testable without a DOM.
 *
 * The model's output is **never mutated**. Corrections are an append-only list
 * replayed over a copy, which gives three things for free:
 *
 * - undo is `edits.slice(0, -1)`, redo is pushing it back;
 * - "reset to the AI result" is `[]`;
 * - the difference between the raw prediction and the corrected curve stays
 *   computable, which is the actual measure of whether a human-in-the-loop tool
 *   saves anyone time — and a number the report needs.
 *
 * These mirror `apply_edits` in `las_assembly.py`. The backend re-applies the
 * same list at export time, so what the reviewer sees is what gets written.
 */

/** A curve in crop-local pixel columns; `null` marks an unrecovered row. */
export type CurveSeries = Array<number | null>;

export interface AppliedCurve {
  x: CurveSeries;
  observed: boolean[];
}

/**
 * Apply corrections in order.
 *
 * Later edits win over earlier ones covering the same rows — which is what
 * makes the append-only undo model correct rather than merely convenient.
 *
 * Out-of-range edits are clipped here rather than throwing: this runs on every
 * repaint of the review canvas, and a half-open drag near the end of the log
 * should not blank the screen. The backend, which decides what actually goes
 * into the file, rejects them loudly instead.
 */
export function applyEdits(
  baseX: CurveSeries,
  baseObserved: boolean[],
  edits: readonly CurveEdit[]
): AppliedCurve {
  const x = baseX.slice();
  const observed = baseObserved.slice();

  for (const edit of edits) {
    const start = Math.max(0, Math.min(edit.y0, x.length));
    const end = Math.max(start, Math.min(edit.y1, x.length));

    if (edit.kind === "discard") {
      for (let y = start; y < end; y += 1) {
        x[y] = null;
        observed[y] = false;
      }
    } else if (edit.kind === "redraw" && edit.x_by_row) {
      for (let y = start; y < end; y += 1) {
        const value = edit.x_by_row[y - edit.y0];
        if (value === undefined) continue;
        x[y] = value;
        // A human tracing the curve by eye is a better source than the model,
        // not a worse one. Marking it unobserved would export their work as
        // -999.25.
        observed[y] = true;
      }
    }
    // "accept" changes no numbers; it records that a human looked, which is
    // what the LAS provenance notes report.
  }

  return { x, observed };
}

/** Drop the most recent correction. */
export function undoLast(edits: readonly CurveEdit[]): CurveEdit[] {
  return edits.slice(0, -1);
}

/** Throw away every correction and return to the model's raw output. */
export function resetEdits(): CurveEdit[] {
  return [];
}

/** Append a correction. */
export function addEdit(edits: readonly CurveEdit[], edit: CurveEdit): CurveEdit[] {
  return [...edits, edit];
}

/**
 * Build a `redraw` from a freehand stroke.
 *
 * A pointer drag produces scattered `(row, column)` samples — fast movement
 * skips rows entirely — but a `redraw` must carry exactly one column per row in
 * its range. This sorts the samples, fills the skipped rows by linear
 * interpolation, and holds the end values flat past the ends of the stroke.
 *
 * @param samples - Raw pointer samples in crop-local coordinates, any order.
 * @returns A `redraw` edit, or `null` if the stroke covers no rows.
 */
export function strokeToEdit(
  samples: ReadonlyArray<{ row: number; x: number }>
): CurveEdit | null {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a.row - b.row);
  const y0 = Math.floor(sorted[0].row);
  const y1 = Math.floor(sorted[sorted.length - 1].row) + 1;
  if (y1 <= y0) return null;

  const xByRow: number[] = new Array(y1 - y0);
  let cursor = 0;

  for (let y = y0; y < y1; y += 1) {
    while (cursor < sorted.length - 1 && sorted[cursor + 1].row <= y) cursor += 1;

    const current = sorted[cursor];
    const next = sorted[cursor + 1];

    if (!next || y <= current.row) {
      xByRow[y - y0] = current.x;
      continue;
    }

    const span = next.row - current.row;
    const t = span === 0 ? 0 : (y - current.row) / span;
    xByRow[y - y0] = current.x + t * (next.x - current.x);
  }

  return { kind: "redraw", y0, y1, x_by_row: xByRow };
}

export interface EditStats {
  total: number;
  redrawnRows: number;
  discardedRows: number;
  acceptedRows: number;
  /** Rows touched by any correction, counting each row once. */
  touchedRows: number;
}

/**
 * Summarise the corrections for the review panel.
 *
 * Counts each row once even when several edits overlap it, so "12% corrected"
 * means twelve percent of the track rather than an inflated sum of overlapping
 * ranges.
 */
export function summarizeEdits(
  edits: readonly CurveEdit[],
  totalRows: number
): EditStats {
  const touched = new Set<number>();
  let redrawnRows = 0;
  let discardedRows = 0;
  let acceptedRows = 0;

  for (const edit of edits) {
    const start = Math.max(0, Math.min(edit.y0, totalRows));
    const end = Math.max(start, Math.min(edit.y1, totalRows));
    const rows = end - start;

    if (edit.kind === "redraw") redrawnRows += rows;
    else if (edit.kind === "discard") discardedRows += rows;
    else acceptedRows += rows;

    for (let y = start; y < end; y += 1) touched.add(y);
  }

  return {
    total: edits.length,
    redrawnRows,
    discardedRows,
    acceptedRows,
    touchedRows: touched.size,
  };
}

/** Contiguous runs of unrecovered rows — where the LAS will carry -999.25. */
export function findGaps(x: CurveSeries): Array<{ y0: number; y1: number }> {
  const gaps: Array<{ y0: number; y1: number }> = [];
  let start: number | null = null;

  for (let y = 0; y < x.length; y += 1) {
    const missing = x[y] === null || x[y] === undefined || Number.isNaN(x[y] as number);
    if (missing && start === null) start = y;
    if (!missing && start !== null) {
      gaps.push({ y0: start, y1: y });
      start = null;
    }
  }
  if (start !== null) gaps.push({ y0: start, y1: x.length });

  return gaps;
}
