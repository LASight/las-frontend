import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridAlignmentPreview, JobSummary } from "../models/digitization-models";
import { initialGridDraft } from "../controllers/grid-alignment-controller";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE, ApiError } from "../services/http-client";
import { accountDraftKey, endAccountSession, setSessionAccount } from "../services/session-scope";
import { gridJob, gridPreview } from "../test-fixtures/grid-alignment-fixtures";
import { curveQueryKey } from "./use-curve-review";
import { alignmentDraftKey, useGridAlignment } from "./use-grid-alignment";

vi.mock("../services/digitization-service", () => ({ digitizationGateway: { getJob: vi.fn(), setEdits: vi.fn(), previewAlignment: vi.fn(), saveAlignment: vi.fn(), deleteAlignment: vi.fn() } }));
let host: HTMLDivElement, root: Root, client: QueryClient, grid: ReturnType<typeof useGridAlignment>;
const saved = vi.fn();
function Probe({ job }: { job: JobSummary }) { grid = useGridAlignment(job, saved); return null; }
async function render(job = gridJob()) { await act(async () => root.render(<QueryClientProvider client={client}><Probe job={job} /></QueryClientProvider>)); }
async function confirmReferences() { await act(async () => grid.update(() => ({ ...initialGridDraft(gridJob(true)), geometry_revision: "geometry-source" }))); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
describe("optional alignment draft and revision transactions", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); localStorage.clear(); setSessionAccount("account-a");
    host = document.createElement("div"); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(digitizationGateway.getJob).mockResolvedValue(gridJob());
    vi.mocked(digitizationGateway.setEdits).mockResolvedValue({ ...gridJob(), edits_revision: 6 });
    vi.mocked(digitizationGateway.previewAlignment!).mockResolvedValue(gridPreview);
    vi.mocked(digitizationGateway.saveAlignment!).mockResolvedValue({ ...gridJob(true), quality: null, edits_revision: 7 });
    vi.mocked(digitizationGateway.deleteAlignment!).mockResolvedValue({ ...gridJob(), geometry_revision: "restored-crop", edits_revision: 7 });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); });
  it("undo restores one complete draft action, clears stale preview and never saves", async () => {
    await render(); await confirmReferences(); const before = structuredClone(grid.draft);
    await act(async () => grid.update((d) => ({ ...d, anchors: d.anchors.map((a,i) => i ? a : { ...a, left:{ x:"22", y:"32", confirmed:true } }) })));
    await act(async () => grid.requestPreview()); expect(grid.preview).not.toBeNull();
    await act(async () => grid.undo()); expect(grid.draft).toEqual(before); expect(grid.preview).toBeNull();
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
  });
  it.each(["account", "frame", "job"])("undo history cannot cross a changed %s", async (kind) => {
    await render(); await confirmReferences(); expect(grid.canUndo).toBe(true);
    if (kind === "account") { endAccountSession(); setSessionAccount("account-b"); await render(); }
    else await render({ ...gridJob(), ...(kind === "frame" ? { geometry_revision:"new-frame" } : { job_id:"another-job" }) });
    const current = structuredClone(grid.draft); await act(async () => grid.undo()); expect(grid.canUndo).toBe(false); expect(grid.draft).toEqual(current);
  });
  it("mounting and navigating a draft do not make any server mutation", async () => {
    await render(); expect(grid.validation.spec).toBeNull();
    await act(async () => { await grid.requestPreview(); await grid.save(); grid.cancelPreview(); });
    expect(digitizationGateway.getJob).not.toHaveBeenCalled(); expect(digitizationGateway.previewAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
  });
  it("follows untouched suggestions through upload, crop save and first calibration save", async () => {
    await render({ ...gridJob(), crop: null, calibration: null, geometry_revision: "uploaded-source" });
    expect(grid.draft.anchors[0].depth).toBe("");
    await render({ ...gridJob(), calibration: null });
    expect(grid.draft.geometry_revision).toBe("geometry-source"); expect(grid.draft.anchors[0].left.x).toBe("10");
    await render();
    expect(grid.draft.depth_unit).toBe("FT"); expect(grid.draft.anchors.map((a) => a.depth)).toEqual(["100", "200"]);
    expect(grid.draft.anchors.every((a) => !a.left.confirmed && !a.right.confirmed)).toBe(true);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.previewAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
  });
  it("repairs a cold cached empty metadata draft using saved calibration without adopting points", async () => {
    const empty = initialGridDraft({ ...gridJob(), calibration: null });
    empty.anchors[0].left.x = "25.75";
    localStorage.setItem(alignmentDraftKey(gridJob())!, JSON.stringify(empty)); await render();
    expect(grid.draft.anchors.map((a) => a.depth)).toEqual(["100", "200"]); expect(grid.draft.depth_unit).toBe("FT");
    expect(grid.draft.anchors[0].left.x).toBe("25.75"); expect(grid.validation.spec).toBeNull();
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.getJob).not.toHaveBeenCalled();
  });
  it("does not replace manually entered depths or confirmed geometry when calibration arrives", async () => {
    await render({ ...gridJob(), calibration: null });
    await act(async () => grid.update((d) => ({ ...d, depth_unit: "M", anchors: d.anchors.map((a, i) => ({ ...a, depth: String(i ? 250 : 125) })) })));
    await render(); expect(grid.draft.depth_unit).toBe("M"); expect(grid.draft.anchors.map((a) => a.depth)).toEqual(["125", "250"]);
    await act(async () => grid.update((d) => ({ ...d, anchors: d.anchors.map((a, i) => i ? a : { ...a, depth: "", left: { ...a.left, confirmed: true } }) })));
    await render({ ...gridJob(), calibration: { ...gridJob().calibration!, depth_top: 110 } });
    expect(grid.draft.anchors[0].depth).toBe(""); expect(grid.draft.anchors[0].left.confirmed).toBe(true); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("retains a user-edited old-frame draft instead of rebasing it after a crop change", async () => {
    await render({ ...gridJob(), crop: null, calibration: null, geometry_revision: "uploaded-source" });
    await act(async () => grid.update((d) => ({ ...d, anchors: d.anchors.map((a, i) => i ? a : { ...a, left: { ...a.left, x: "25.5" } }) })));
    const before = grid.draft; await render(); expect(grid.draft).toBe(before); expect(grid.draft.geometry_revision).toBe("uploaded-source"); expect(grid.validation.spec).toBeNull();
  });
  it("does not refill an intentional Advanced blank on each keystroke", async () => {
    await render(); await act(async () => grid.update((d) => ({ ...d, anchors: d.anchors.map((a, i) => i ? a : { ...a, depth: "" }) })));
    await render(); expect(grid.draft.anchors[0].depth).toBe(""); expect(grid.validation.spec).toBeNull();
  });
  it("cancelled explicit confirmation does not even flush autosaves", async () => {
    await render(); await confirmReferences(); vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => { await grid.save(); });
    expect(digitizationGateway.getJob).not.toHaveBeenCalled(); expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(grid.saving).toBe(false);
  });
  it("preview is nondurable and exposes authoritative canonical dimensions", async () => {
    await render(); await confirmReferences(); await act(async () => { await grid.requestPreview(); });
    expect(grid.preview).toEqual(gridPreview); expect(grid.preview?.alignment.width).toBe(100); expect(grid.preview?.alignment.height).toBe(200);
    expect(digitizationGateway.previewAlignment).toHaveBeenCalledWith("grid", expect.objectContaining({ expected_geometry_revision: "geometry-source", depth_unit: "FT" }));
    expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it.each(["input", "cancel", "geometry", "account"])("does not display a deferred obsolete preview after %s changes", async (reason) => {
    const pending = deferred<GridAlignmentPreview>(); vi.mocked(digitizationGateway.previewAlignment!).mockReturnValue(pending.promise);
    await render(); await confirmReferences(); let request!: Promise<void>;
    await act(async () => { request = grid.requestPreview(); }); expect(grid.previewing).toBe(true);
    if (reason === "input") await act(async () => grid.update((d) => ({ ...d, anchors: d.anchors.map((a, i) => i === 1 ? { ...a, depth: "126" } : a) })));
    if (reason === "cancel") await act(async () => grid.cancelPreview());
    if (reason === "geometry") await render({ ...gridJob(), geometry_revision: "replaced-raster" });
    if (reason === "account") { endAccountSession(); setSessionAccount("account-b"); await render(); }
    await act(async () => { pending.resolve(gridPreview); await request; });
    expect(grid.preview).toBeNull(); expect(grid.previewing).toBe(false); expect(saved).not.toHaveBeenCalled();
  });
  it("a late older preview cannot overwrite a newer authoritative response", async () => {
    const older = deferred<GridAlignmentPreview>(); vi.mocked(digitizationGateway.previewAlignment!).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ...gridPreview, preview_png_base64: "new-preview" });
    await render(); await confirmReferences(); let request!: Promise<void>;
    await act(async () => { request = grid.requestPreview(); });
    await act(async () => grid.update((d) => ({ ...d, anchors: d.anchors.map((a, i) => i === 1 ? { ...a, depth: "126" } : a) })));
    await act(async () => { await grid.requestPreview(); });
    await act(async () => { older.resolve(gridPreview); await request; });
    expect(grid.preview?.preview_png_base64).toBe("new-preview");
  });
  it("flushes the exact owned review draft before re-reading edits revision and saving geometry", async () => {
    const pending = deferred<JobSummary>(); vi.mocked(digitizationGateway.setEdits).mockReturnValue(pending.promise);
    const before = { ...gridJob(), edits_revision: 5 };
    vi.mocked(digitizationGateway.getJob).mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, edits_revision: 6 });
    const correction = { kind: "discard", y0: 0, y1: 2 };
    localStorage.setItem(accountDraftKey("review", API_BASE, "grid")!, JSON.stringify({ edits: [correction], edits_revision: 5 }));
    client.setQueryData(curveQueryKey("grid"), { x: [10, 20] });
    await render(); await confirmReferences(); const draftKey = alignmentDraftKey(gridJob())!;
    const oldDraft = localStorage.getItem(draftKey); let request!: Promise<void>;
    await act(async () => { request = grid.save(); });
    expect(grid.saving).toBe(true); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("grid", [correction], 5);
    await act(async () => { await grid.save(); }); expect(digitizationGateway.getJob).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ ...before, edits_revision: 6 }); await request; });
    expect(digitizationGateway.saveAlignment).toHaveBeenCalledWith("grid", expect.objectContaining({ expected_geometry_revision: "geometry-source", expected_edits_revision: 6, acknowledge_reset: true }));
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ geometry_revision: "geometry-aligned", edits: [], quality: null }));
    expect(client.getQueryData(curveQueryKey("grid"))).toBeUndefined(); expect(localStorage.getItem(draftKey)).toBe(oldDraft);
    expect(grid.saving).toBe(false);
  });
  it("preserves prediction cache on an unchanged-geometry save", async () => {
    const job = gridJob(true); vi.mocked(digitizationGateway.getJob).mockResolvedValue(job); vi.mocked(digitizationGateway.saveAlignment!).mockResolvedValue(job);
    client.setQueryData(curveQueryKey("grid"), { x: [1, 2] }); await render(job);
    await act(async () => { await grid.save(); });
    expect(client.getQueryData(curveQueryKey("grid"))).toEqual({ x: [1, 2] });
  });
  it("does not save geometry if pending correction persistence fails", async () => {
    localStorage.setItem(accountDraftKey("review", API_BASE, "grid")!, JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 2 }], edits_revision: 0 }));
    vi.mocked(digitizationGateway.setEdits).mockRejectedValue(new Error("Edits revision conflict"));
    await render(); await confirmReferences(); await act(async () => { await grid.save(); });
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(grid.error).toContain("Edits revision conflict");
  });
  it("rejects a stale working frame before flushing or saving", async () => {
    vi.mocked(digitizationGateway.getJob).mockResolvedValue({ ...gridJob(), geometry_revision: "changed" });
    await render(); await confirmReferences(); await act(async () => { await grid.save(); });
    expect(grid.error).toContain("Source geometry changed (409)"); expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("re-checks latest calibration and edit revision after a flush", async () => {
    vi.mocked(digitizationGateway.getJob).mockResolvedValue({ ...gridJob(), calibration: { ...gridJob().calibration!, depth_bottom: 300 } });
    await render(); await confirmReferences(); await act(async () => { await grid.save(); });
    expect(grid.error).toContain("match saved calibration"); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("reloads authorized state after a backend 409 but does not silently adopt geometry", async () => {
    vi.mocked(digitizationGateway.previewAlignment!).mockRejectedValue(new ApiError(409, "Geometry revision conflict; reload the job before aligning."));
    vi.mocked(digitizationGateway.getJob).mockResolvedValue({ ...gridJob(), geometry_revision: "changed" });
    await render(); await confirmReferences(); const draft = grid.draft;
    await act(async () => { await grid.requestPreview(); });
    expect(grid.error).toContain("reload the job"); expect(saved).toHaveBeenCalledWith(expect.objectContaining({ geometry_revision: "changed" })); expect(grid.draft).toBe(draft); expect(grid.preview).toBeNull();
  });
  it("keeps account and geometry-frame drafts separate without deleting earlier data", async () => {
    await render(); await confirmReferences(); const keyA = alignmentDraftKey(gridJob())!, rawA = localStorage.getItem(keyA);
    endAccountSession(); setSessionAccount("account-b"); await render();
    expect(grid.draft.anchors[0].left.confirmed).toBe(false); const keyB = alignmentDraftKey(gridJob())!;
    expect(keyB).not.toBe(keyA); expect(localStorage.getItem(keyA)).toBe(rawA); expect(JSON.parse(localStorage.getItem(keyB)!).anchors[0].left.confirmed).toBe(false);
    endAccountSession(); setSessionAccount("account-a"); await render(); expect(grid.draft.anchors[0].left.confirmed).toBe(true);
    await render({ ...gridJob(), geometry_revision: "new-frame" }); expect(grid.validation.spec).toBeNull();
    await act(async () => grid.reloadReferences()); expect(grid.draft.geometry_revision).toBe("new-frame"); expect(grid.draft.anchors[0].left.confirmed).toBe(false); expect(localStorage.getItem(keyA)).toBe(rawA);
  });
  it("cold-loads only account-scoped confirmed drafts for the exact geometry", async () => {
    const draft = { ...initialGridDraft(gridJob(true)), geometry_revision: "geometry-source" };
    localStorage.setItem(alignmentDraftKey(gridJob())!, JSON.stringify(draft));
    localStorage.setItem(`digitization-input-draft:${API_BASE}:grid`, "legacy data retained");
    await render(); expect(grid.draft).toEqual(draft); expect(grid.validation.spec).not.toBeNull();
    expect(localStorage.getItem(`digitization-input-draft:${API_BASE}:grid`)).toBe("legacy data retained"); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it.each(["old", "segmenting", "detecting"])("does not call alignment APIs for %s jobs", async (kind) => {
    const job = kind === "old" ? { ...gridJob(), geometry_revision: undefined } : kind === "segmenting" ? { ...gridJob(), phase: "segmenting" as const } : { ...gridJob(), detection: { status: "running" as const, tracks: [], depth_column: null, message: "", model_version: "test" } };
    await render(job); await confirmReferences(); await act(async () => { await grid.requestPreview(); await grid.save(); });
    expect(digitizationGateway.previewAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.getJob).not.toHaveBeenCalled();
  });
  it("explicit disable warns about restored rectangular mapping and carries both revisions", async () => {
    const job = gridJob(true); vi.mocked(digitizationGateway.getJob).mockResolvedValue(job); await render(job);
    vi.mocked(window.confirm).mockReturnValueOnce(false); await act(async () => { await grid.save(true); }); expect(digitizationGateway.deleteAlignment).not.toHaveBeenCalled();
    await act(async () => { await grid.save(true); });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("old rectangular crop depth mapping"));
    expect(digitizationGateway.deleteAlignment).toHaveBeenCalledWith("grid", { expected_geometry_revision: "geometry-aligned", expected_edits_revision: 0, acknowledge_reset: true });
  });
});
