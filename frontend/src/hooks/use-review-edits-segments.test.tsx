import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurveEdit, JobSummary } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE } from "../services/http-client";
import { accountDraftKey, endAccountSession, setSessionAccount } from "../services/session-scope";
import { segmentJob } from "../test-fixtures/collection-fixtures";
import { useCurveReview } from "./use-curve-review";
import { flushCollectionEdits } from "./use-review-edits";

vi.mock("../services/digitization-service", () => ({ digitizationGateway: { getCurve: vi.fn(), setEdits: vi.fn(), getJob: vi.fn() } }));
let root: Root; let client: QueryClient; let review: ReturnType<typeof useCurveReview>;
const first = segmentJob("first"); const second = segmentJob("second");
function Probe({ job }: { job: JobSummary }) { review = useCurveReview(job); return <span>{review.x.join(",")}</span>; }
async function render(job: JobSummary) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><Probe job={job} /></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}
describe("segment isolation with durable review overlays", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); localStorage.clear(); setSessionAccount("account-a"); root = createRoot(document.createElement("div"));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(digitizationGateway.getCurve).mockImplementation(async (id) => ({ y0: 0, y1: 3, stride: 1, x: id === "first" ? [1, 2, 3] : [4, 5, 6], observed: [true, true, true] }));
    vi.mocked(digitizationGateway.setEdits).mockImplementation(async (id, edits, revision) => ({ ...segmentJob(id), edits, edits_revision: (revision ?? 0) + 1 }));
    vi.mocked(digitizationGateway.getJob).mockImplementation(async (id) => segmentJob(id));
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); });
  it("switches between jobs without leaking strokes or the immutable curve cache", async () => {
    await render(first);
    await act(async () => { review.applyStroke([{ row: 0, x: 10 }, { row: 1, x: 20 }]); await review.flushEdits(); });
    expect(review.x).toEqual([10, 20, 3]);
    await render(second);
    expect(review.edits).toEqual([]); expect(review.x).toEqual([4, 5, 6]);
    await act(async () => { review.discardRange(2, 3); await review.flushEdits(); });
    expect(review.x).toEqual([4, 5, null]);
    await render(first);
    expect(review.x).toEqual([10, 20, 3]); expect(review.baseX).toEqual([1, 2, 3]);
    expect(digitizationGateway.getCurve).toHaveBeenCalledTimes(2);
    expect(digitizationGateway.setEdits).toHaveBeenNthCalledWith(1, "first", expect.arrayContaining([expect.objectContaining({ kind: "redraw" })]), 0);
    expect(digitizationGateway.setEdits).toHaveBeenNthCalledWith(2, "second", [{ kind: "discard", y0: 2, y1: 3 }], 0);
  });
  it("recovers and flushes each member's local draft by job ID without cross-segment edits", async () => {
    const discard: CurveEdit = { kind: "discard", y0: 0, y1: 1 };
    const accept: CurveEdit = { kind: "accept", y0: 1, y1: 2 };
    localStorage.setItem(accountDraftKey("review", API_BASE, "first")!, JSON.stringify({ edits: [discard], edits_revision: 5 }));
    localStorage.setItem(accountDraftKey("review", API_BASE, "second")!, JSON.stringify({ edits: [accept], edits_revision: 8 }));
    await flushCollectionEdits(client, [first, second]);
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("first", [discard], 5);
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("second", [accept], 8);
    expect(localStorage.length).toBe(0);
  });

  it("bounds edge-crossing edits before autosave and rehydrates the valid failed draft", async () => {
    vi.mocked(digitizationGateway.setEdits).mockRejectedValue(new Error("offline"));
    await render(first);
    await act(async () => {
      review.applyStroke([{ row: -2, x: -10 }, { row: 2, x: 30 }, { row: 5, x: 150 }]);
      await review.flushEdits().catch(() => {});
    });
    expect(review.edits).toEqual([{ kind: "redraw", y0: 0, y1: 3, x_by_row: [10, 20, 30] }]);
    await act(async () => { review.discardRange(-10, 20); await review.flushEdits().catch(() => {}); });
    expect(review.edits[1]).toEqual({ kind: "discard", y0: 0, y1: 3 });
    const raw = localStorage.getItem(accountDraftKey("review", API_BASE, "first")!)!;
    expect(JSON.parse(raw).edits.every((edit: CurveEdit) => edit.y0 >= 0 && edit.y1 <= 3)).toBe(true);
    await act(async () => root.unmount()); client.clear();
    root = createRoot(document.createElement("div")); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(first);
    expect(review.edits).toEqual(JSON.parse(raw).edits);
    expect(review.hasUnsavedEdits).toBe(true);
  });

  it("ignores entirely outside gestures and clamps manual x without changing raw unwrap data", async () => {
    await render(first);
    await act(async () => {
      review.applyStroke([{ row: -5, x: 20 }, { row: -1, x: 30 }]);
      review.applyStroke([{ row: 0, x: -20 }, { row: 2, x: -10 }]);
      review.discardRange(4, 20); review.acceptRange(-5, -1);
    });
    expect(review.edits).toEqual([]); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
    await act(async () => {
      review.applyStroke([{ row: 0, x: -20 }, { row: 1, x: 30 }, { row: 2, x: 150 }]);
      await review.flushEdits();
    });
    expect(review.edits[0]).toEqual({ kind: "redraw", y0: 0, y1: 3, x_by_row: [0, 30, 99] });
    expect(review.baseX).toEqual([1, 2, 3]);
    await act(async () => { review.undo(); await review.flushEdits(); });
    expect(review.x).toEqual([1, 2, 3]);
  });

  it("isolates account drafts, preserves A on sign-out and never queues A edits under B", async () => {
    let acknowledge!: (value: JobSummary) => void;
    vi.mocked(digitizationGateway.setEdits).mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; })).mockRejectedValue(new Error("offline"));
    await render(first);
    let flush!: ReturnType<typeof review.flushEdits>;
    await act(async () => {
      review.applyStroke([{ row: 0, x: 10 }, { row: 1, x: 20 }]);
      review.discardRange(2, 3);
      flush = review.flushEdits();
      void flush.catch(() => {});
    });
    const keyA = accountDraftKey("review", API_BASE, "first")!;
    endAccountSession(); setSessionAccount("account-b");
    await act(async () => { acknowledge({ ...first, edits_revision: 1 }); await flush.catch(() => {}); });
    await render(first); // Even accidental client reuse cannot recover A's store.
    expect(review.edits).toEqual([]); expect(digitizationGateway.setEdits).toHaveBeenCalledTimes(1);
    await expect(flushCollectionEdits(client, [first])).rejects.toThrow("Session changed");
    expect(localStorage.getItem(keyA)).not.toBeNull();
    endAccountSession(); setSessionAccount("account-a");
    await render(first);
    expect(review.edits).toHaveLength(2); expect(review.hasUnsavedEdits).toBe(true);
    expect(vi.mocked(digitizationGateway.setEdits).mock.calls.every(([id]) => id === "first")).toBe(true);
  });

  it("never reads a legacy unscoped draft automatically", async () => {
    const raw = JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 1 }], edits_revision: 0 });
    const key = `digitization-review-draft:${API_BASE}:first`;
    localStorage.setItem(key, raw);
    await render(first);
    expect(review.edits).toEqual([]); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(raw); expect(review.hasLegacyDraft).toBe(true);
  });

  it("recovers legacy corrections only explicitly after a fresh authorized job read", async () => {
    const raw = JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 1 }], edits_revision: 4 });
    const key = `digitization-review-draft:${API_BASE}:first`;
    localStorage.setItem(key, raw); await render(first);
    await act(async () => { await review.recoverLegacyEdits(); await review.flushEdits(); });
    expect(digitizationGateway.getJob).toHaveBeenCalledWith("first");
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("first", [{ kind: "discard", y0: 0, y1: 1 }], 4);
    expect(review.x).toEqual([null, 2, 3]); expect(localStorage.getItem(key)).toBe(raw);
  });

  it("leaves legacy corrections untouched and unread when fresh job access fails", async () => {
    const raw = JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 1 }], edits_revision: 4 });
    localStorage.setItem(`digitization-review-draft:${API_BASE}:first`, raw);
    vi.mocked(digitizationGateway.getJob).mockRejectedValueOnce(new Error("Forbidden"));
    await render(first);
    await act(async () => { await review.recoverLegacyEdits(); });
    expect(review.edits).toEqual([]); expect(review.saveError).toBe("Forbidden");
    expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
    expect(localStorage.getItem(accountDraftKey("review", API_BASE, "first")!)).toBeNull();
  });
});
