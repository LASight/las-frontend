import { describe, expect, it } from "vitest";

import {
  addEdit,
  applyEdits,
  findGaps,
  resetEdits,
  strokeToEdit,
  summarizeEdits,
  undoLast,
  type CurveSeries,
} from "./curve-edit-controller";
import type { CurveEdit } from "../models/digitization-models";

/**
 * These cover the logic that decides what ends up in the exported LAS, which is
 * why they matter more than their size suggests: a bug here silently ships a
 * curve the reviewer never approved.
 *
 * They mirror `test_digitization.py::apply_edits` on the backend — the same
 * edits must produce the same curve on both sides, because the browser previews
 * the result and the server writes the file.
 */

function ramp(length: number): CurveSeries {
  return Array.from({ length }, (_, i) => i);
}

function allObserved(length: number): boolean[] {
  return Array.from({ length }, () => true);
}

describe("applyEdits", () => {
  it("leaves the curve untouched when there are no edits", () => {
    const result = applyEdits(ramp(10), allObserved(10), []);
    expect(result.x).toEqual(ramp(10));
  });

  it("does not mutate the model's output", () => {
    const base = ramp(10);
    const observed = allObserved(10);
    applyEdits(base, observed, [{ kind: "discard", y0: 0, y1: 10 }]);
    expect(base).toEqual(ramp(10));
    expect(observed.every(Boolean)).toBe(true);
  });

  it("discard marks a range unrecovered without leaking past it", () => {
    const result = applyEdits(ramp(10), allObserved(10), [
      { kind: "discard", y0: 2, y1: 5 },
    ]);
    expect(result.x.slice(2, 5)).toEqual([null, null, null]);
    expect(result.observed.slice(2, 5)).toEqual([false, false, false]);
    expect(result.x[1]).toBe(1);
    expect(result.x[5]).toBe(5);
  });

  it("redraw replaces the range and counts as observed", () => {
    // A human tracing the curve by eye is a better source than the model, not a
    // worse one; marking it unobserved would export their work as -999.25.
    const result = applyEdits(new Array(10).fill(null), new Array(10).fill(false), [
      { kind: "redraw", y0: 3, y1: 6, x_by_row: [100, 101, 102] },
    ]);
    expect(result.x.slice(3, 6)).toEqual([100, 101, 102]);
    expect(result.observed.slice(3, 6)).toEqual([true, true, true]);
  });

  it("accept changes no numbers", () => {
    const result = applyEdits(ramp(10), allObserved(10), [
      { kind: "accept", y0: 0, y1: 10 },
    ]);
    expect(result.x).toEqual(ramp(10));
    expect(result.observed).toEqual(allObserved(10));
  });

  it("lets a later edit win over an earlier one", () => {
    // What makes the append-only undo model correct rather than merely handy.
    const result = applyEdits(ramp(10), allObserved(10), [
      { kind: "discard", y0: 2, y1: 5 },
      { kind: "redraw", y0: 2, y1: 5, x_by_row: [7, 7, 7] },
    ]);
    expect(result.x.slice(2, 5)).toEqual([7, 7, 7]);
  });

  it("clips an out-of-range edit instead of throwing", () => {
    // This runs on every repaint of the canvas; a drag past the end of the log
    // must not blank the screen. The backend rejects it loudly at export time.
    const result = applyEdits(ramp(10), allObserved(10), [
      { kind: "discard", y0: 8, y1: 99 },
    ]);
    expect(result.x).toHaveLength(10);
    expect(result.x.slice(8)).toEqual([null, null]);
  });
});

describe("undo and reset", () => {
  it("undo drops the most recent edit", () => {
    const edits: CurveEdit[] = [
      { kind: "discard", y0: 0, y1: 1 },
      { kind: "discard", y0: 5, y1: 6 },
    ];
    expect(undoLast(edits)).toEqual([edits[0]]);
  });

  it("undo on an empty list is a no-op", () => {
    expect(undoLast([])).toEqual([]);
  });

  it("undo restores the previous curve exactly", () => {
    const base = ramp(10);
    const observed = allObserved(10);
    const edits = addEdit([], { kind: "discard", y0: 2, y1: 5 });
    expect(applyEdits(base, observed, undoLast(edits)).x).toEqual(base);
  });

  it("reset returns to the model's raw output", () => {
    const base = ramp(10);
    expect(applyEdits(base, allObserved(10), resetEdits()).x).toEqual(base);
  });
});

describe("strokeToEdit", () => {
  it("returns null for an empty stroke", () => {
    expect(strokeToEdit([])).toBeNull();
  });

  it("produces exactly one column per row in its range", () => {
    const edit = strokeToEdit([
      { row: 10, x: 100 },
      { row: 14, x: 140 },
    ]);
    expect(edit).not.toBeNull();
    expect(edit!.y0).toBe(10);
    expect(edit!.y1).toBe(15);
    expect(edit!.x_by_row).toHaveLength(5);
  });

  it("interpolates rows the pointer skipped", () => {
    // A fast drag samples every few rows; the gaps have to be filled or the
    // redraw would punch holes in the curve it is meant to repair.
    const edit = strokeToEdit([
      { row: 0, x: 0 },
      { row: 4, x: 40 },
    ]);
    expect(edit!.x_by_row).toEqual([0, 10, 20, 30, 40]);
  });

  it("sorts samples, so an upward drag works the same as a downward one", () => {
    const upward = strokeToEdit([
      { row: 4, x: 40 },
      { row: 0, x: 0 },
    ]);
    expect(upward!.y0).toBe(0);
    expect(upward!.x_by_row).toEqual([0, 10, 20, 30, 40]);
  });

  it("handles a single-point stroke", () => {
    const edit = strokeToEdit([{ row: 7, x: 70 }]);
    expect(edit!.y0).toBe(7);
    expect(edit!.y1).toBe(8);
    expect(edit!.x_by_row).toEqual([70]);
  });
});

describe("summarizeEdits", () => {
  it("reports nothing for an empty list", () => {
    expect(summarizeEdits([], 1000).total).toBe(0);
    expect(summarizeEdits([], 1000).touchedRows).toBe(0);
  });

  it("counts rows per edit kind", () => {
    const stats = summarizeEdits(
      [
        { kind: "discard", y0: 0, y1: 100 },
        { kind: "redraw", y0: 200, y1: 250, x_by_row: new Array(50).fill(1) },
      ],
      1000
    );
    expect(stats.discardedRows).toBe(100);
    expect(stats.redrawnRows).toBe(50);
    expect(stats.total).toBe(2);
  });

  it("counts an overlapping row once", () => {
    // Otherwise "12% corrected" inflates every time a reviewer touches up the
    // same stretch twice.
    const stats = summarizeEdits(
      [
        { kind: "discard", y0: 0, y1: 100 },
        { kind: "discard", y0: 50, y1: 150 },
      ],
      1000
    );
    expect(stats.touchedRows).toBe(150);
    expect(stats.discardedRows).toBe(200);
  });
});

describe("findGaps", () => {
  it("finds nothing in a fully recovered curve", () => {
    expect(findGaps(ramp(10))).toEqual([]);
  });

  it("returns each unrecovered run as a half-open range", () => {
    const curve: CurveSeries = [1, 2, null, null, 5, null, 7];
    expect(findGaps(curve)).toEqual([
      { y0: 2, y1: 4 },
      { y0: 5, y1: 6 },
    ]);
  });

  it("closes a gap that runs to the end of the log", () => {
    expect(findGaps([1, 2, null, null])).toEqual([{ y0: 2, y1: 4 }]);
  });

  it("treats an all-null curve as one gap", () => {
    expect(findGaps([null, null, null])).toEqual([{ y0: 0, y1: 3 }]);
  });

  it("treats NaN as unrecovered, like null", () => {
    expect(findGaps([1, Number.NaN, 3])).toEqual([{ y0: 1, y1: 2 }]);
  });
});
