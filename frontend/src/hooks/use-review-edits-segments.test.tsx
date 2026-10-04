import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurveEdit, JobSummary } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE } from "../services/http-client";
import { segmentJob } from "../test-fixtures/collection-fixtures";
import { useCurveReview } from "./use-curve-review";
import { flushCollectionEdits } from "./use-review-edits";

vi.mock("../services/digitization-service", () => ({ digitizationGateway: { getCurve: vi.fn(), setEdits: vi.fn() } }));
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
    vi.clearAllMocks(); localStorage.clear(); root = createRoot(document.createElement("div"));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(digitizationGateway.getCurve).mockImplementation(async (id) => ({ y0: 0, y1: 3, stride: 1, x: id === "first" ? [1, 2, 3] : [4, 5, 6], observed: [true, true, true] }));
    vi.mocked(digitizationGateway.setEdits).mockImplementation(async (id, edits, revision) => ({ ...segmentJob(id), edits, edits_revision: (revision ?? 0) + 1 }));
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
    localStorage.setItem(`digitization-review-draft:${API_BASE}:first`, JSON.stringify({ edits: [discard], edits_revision: 5 }));
    localStorage.setItem(`digitization-review-draft:${API_BASE}:second`, JSON.stringify({ edits: [accept], edits_revision: 8 }));
    await flushCollectionEdits(client, [first, second]);
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("first", [discard], 5);
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("second", [accept], 8);
    expect(localStorage.length).toBe(0);
  });
});
