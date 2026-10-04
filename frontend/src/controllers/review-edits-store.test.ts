import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewEditsStore } from "./review-edits-store";
import { addEdit, applyEdits, resetEdits, undoLast } from "./curve-edit-controller";
import type { CurveEdit } from "../models/digitization-models";

const redraw: CurveEdit = { kind: "redraw", y0: 0, y1: 2, x_by_row: [15, 25] };
const discard: CurveEdit = { kind: "discard", y0: 1, y1: 2 };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("durable review overlay", () => {
  beforeEach(() => localStorage.clear());

  it("serializes strokes and undo/reset while a save is pending", async () => {
    const first = deferred<number>();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(2);
    const store = new ReviewEditsStore([], save, "job", localStorage, 0);
    store.update((edits) => addEdit(edits, redraw));
    store.update((edits) => addEdit(edits, discard));
    store.update(undoLast);
    store.update(resetEdits);
    expect(save).toHaveBeenCalledTimes(1);
    const flushed = store.flush();
    first.resolve(1);
    expect((await flushed).edits).toEqual([]);
    expect(save.mock.calls).toEqual([[[redraw], 0], [[], 1]]);
    expect(store.getSnapshot()).toMatchObject({ dirty: false, edits_revision: 2 });
    expect(localStorage.getItem("job")).toBeNull();
  });

  it("keeps failed drafts, restores their base revision on reload and blocks flush", async () => {
    const save = vi.fn().mockRejectedValue(new Error("revision conflict"));
    const store = new ReviewEditsStore([], save, "job", localStorage, 4);
    store.update((edits) => addEdit(edits, redraw));
    await expect(store.flush()).rejects.toThrow("revision conflict");
    const restored = new ReviewEditsStore([discard], save, "job", localStorage, 5);
    expect(restored.getSnapshot()).toMatchObject({ edits: [redraw], edits_revision: 4, dirty: true });
    await expect(restored.flush()).rejects.toThrow("revision conflict");
    expect(restored.getSnapshot().edits).toEqual([redraw]);
  });

  it("rehydrates acknowledged edits from the backend, preserving the raw model", async () => {
    const original = [1, 2, 3];
    const flags = [true, true, true];
    const save = vi.fn().mockResolvedValue(9);
    const store = new ReviewEditsStore([redraw, discard], save, "job", localStorage, 8);
    const result = applyEdits(original, flags, store.getSnapshot().edits);
    expect(result.x).toEqual([15, null, 3]);
    expect(original).toEqual([1, 2, 3]);
    expect(flags).toEqual([true, true, true]);
    store.update(undoLast);
    await store.flush();
    const restored = new ReviewEditsStore([redraw], save, "job", localStorage, 9);
    expect(restored.getSnapshot().edits).toEqual([redraw]);
    expect(save).toHaveBeenCalledWith([redraw], 8);
  });

  it("ignores stale server responses but accepts a newer upstream reset", () => {
    const store = new ReviewEditsStore([redraw], async () => 3, "job", undefined, 2);
    store.reconcile([], 1);
    expect(store.getSnapshot().edits).toEqual([redraw]);
    store.reconcile([], 3);
    expect(store.getSnapshot().edits).toEqual([]);
  });

  it("allows explicit recovery from a conflict without silently losing the draft", async () => {
    const store = new ReviewEditsStore([], async () => { throw new Error("conflict"); }, "job", localStorage, 1);
    store.update((edits) => addEdit(edits, redraw));
    await expect(store.flush()).rejects.toThrow("conflict");
    store.reconcile([discard], 2);
    expect(store.getSnapshot().edits).toEqual([redraw]);
    store.restoreSaved([discard], 2);
    expect(store.getSnapshot()).toMatchObject({ edits: [discard], edits_revision: 2, dirty: false, error: null });
    expect(localStorage.getItem("job")).toBeNull();
  });
});
