import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawCurveOverlay } from "./curve-overlay";
import { RasterViewport } from "./raster-viewport";
import type { ViewTransform } from "./cropper/viewport-transform";
import { gridJob } from "../../test-fixtures/grid-alignment-fixtures";
import { digitizationGateway } from "../../services/digitization-service";
import { useCurveReview } from "../../hooks/use-curve-review";
import { projectAlignedPoint } from "../../controllers/grid-alignment-controller";
import { setSessionAccount } from "../../services/session-scope";
import { reviewDraftKey } from "../../hooks/use-review-edits";
import type { JobSummary } from "../../models/digitization-models";
import { API_BASE } from "../../services/http-client";

const observed = vi.hoisted(() => ({ options: [] as Array<{ jobId?: string; image: { width: number; height: number }; view: ViewTransform; origin?: { x: number; y: number }; layer?: string; revision?: string; cacheRevision?: number }> }));
vi.mock("./cropper/use-lod-tiles", () => ({ useLodTiles: (options: typeof observed.options[number]) => { observed.options.push(options); return { tiles: [], error: null, isLoading: false, retry: vi.fn() }; } }));
vi.mock("./scan-minimap", () => ({ ScanMinimap: () => null }));
vi.mock("./curve-overlay", async () => ({ ...await vi.importActual<typeof import("./curve-overlay")>("./curve-overlay"), drawCurveOverlay: vi.fn() }));
vi.mock("../../services/digitization-service", () => ({ digitizationGateway: { getCurve: vi.fn(), setEdits: vi.fn(), getJob: vi.fn() } }));
let host: HTMLDivElement, root: Root, client: QueryClient, review: ReturnType<typeof useCurveReview>;
let originals: Array<[string, PropertyDescriptor | undefined]>;
const context = { setTransform: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn() };
function Frame({ focused = false, hide = false, jobOverride }: { focused?: boolean; hide?: boolean; jobOverride?: JobSummary }) {
  const job = jobOverride ?? gridJob(true); review = useCurveReview(job);
  return <div data-focus={focused}><RasterViewport job={job} x={review.x} edits={review.edits} gaps={review.gaps} tool={review.tool} showMask={true} showPrediction={!hide} predictionOpacity={hide ? 0 : 80} onStroke={review.applyStroke} onDiscardRange={review.discardRange} /></div>;
}
async function render(props = {}) { await act(async () => root.render(<QueryClientProvider client={client}><Frame {...props} /></QueryClientProvider>)); await tick(); }
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
const canvas = () => host.querySelector<HTMLCanvasElement>('canvas[aria-label="Curve review canvas"]')!;
const view = () => observed.options.at(-2)!.view;
async function select(value: "original" | "aligned") { const select = host.querySelector<HTMLSelectElement>('select[aria-label="Review raster view"]')!; await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick(); }
async function pointer(type: string, x: number, y: number) { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }); Object.defineProperty(event, "pointerId", { value: 1 }); await act(async () => canvas().dispatchEvent(event)); await tick(); }
describe("one shared prediction in saved canonical/source frames", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); observed.options = []; localStorage.clear(); setSessionAccount("review-account");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(digitizationGateway.getCurve).mockResolvedValue({ y0: 0, y1: 200, stride: 1, x: Array.from({ length: 200 }, (_, i) => i === 10 ? null : i === 20 ? 120 : 50), observed: Array(200).fill(true) });
    vi.mocked(digitizationGateway.setEdits).mockImplementation(async (_, edits, revision) => ({ ...gridJob(true), edits, edits_revision: (revision ?? 0) + 1 }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("ResizeObserver", class { constructor(private cb: ResizeObserverCallback) {} observe(target: Element) { this.cb([{ target, contentRect: { width: 500, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
    const captured = new Set<number>(); originals = ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperties(HTMLElement.prototype, { setPointerCapture: { configurable: true, value: (id: number) => captured.add(id) }, hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) }, releasePointerCapture: { configurable: true, value: (id: number) => captured.delete(id) } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name); } });
  it("cold-loads aligned tiles in canonical dimensions with zero crop offset", async () => {
    await render(); const [scan, mask] = observed.options.slice(-2);
    expect(scan).toMatchObject({ image: { width: 100, height: 200 }, origin: { x: 0, y: 0 }, layer: "aligned", revision: "geometry-aligned" });
    expect(mask).toMatchObject({ image: { width: 100, height: 200 }, layer: "mask", cacheRevision: 0 }); expect(mask.origin).toBeUndefined();
    expect(host.textContent).toContain("Saved grid alignment"); expect(digitizationGateway.getCurve).toHaveBeenCalledTimes(1);
  });
  it("clips correction indices and columns to the canonical frame, not crop margins", async () => {
    await render(); await act(async () => { review.applyStroke([{ row: 198, x: 80 }, { row: 203, x: 130 }]); await review.flushEdits(); });
    expect(review.edits[0]).toEqual({ kind: "redraw", y0: 198, y1: 200, x_by_row: [80, 90] });
    await act(async () => { review.discardRange(199, 350); await review.flushEdits(); });
    expect(review.edits[1]).toEqual({ kind: "discard", y0: 199, y1: 200 });
    expect(review.baseX).toHaveLength(200); expect(review.baseX[20]).toBe(120);
  });
  it("uses one canvas and one model read, restoring each frame's camera and tool/undo on toggles", async () => {
    await render(); await act(async () => { review.setTool("redraw"); review.applyStroke([{ row: 30, x: 30 }, { row: 31, x: 40 }]); await review.flushEdits(); });
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Zoom in"]')!.click()); await tick(); const canonical = { ...view() }, node = canvas(); const edits = structuredClone(review.edits);
    await select("original"); expect(canvas()).toBe(node); await pointer("pointerdown", 100, 100); await pointer("pointermove", 100, 50); await pointer("pointerup", 100, 50); const original = { ...view() };
    await render({ focused: true, hide: true }); expect(canvas()).toBe(node); expect(review.edits).toEqual(edits); expect(review.tool).toBe("redraw");
    await select("aligned"); expect(view()).toEqual(canonical); await select("original"); expect(view()).toEqual(original);
    expect(review.edits).toEqual(edits); expect(review.canUndo).toBe(true); expect(digitizationGateway.getCurve).toHaveBeenCalledTimes(1);
    await act(async () => { review.undo(); await review.flushEdits(); }); expect(review.edits).toEqual([]);
  });
  it.each(["redraw", "discard"] as const)("Original is read-only even with the %s tool retained", async (tool) => {
    await render(); await act(async () => review.setTool(tool)); await select("original");
    await pointer("pointerdown", 100, 100); await pointer("pointermove", 120, 120); await pointer("pointerup", 120, 120);
    expect(review.edits).toEqual([]); expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(review.tool).toBe(tool);
    expect(host.textContent).toContain("Edit in Aligned view");
    const [scan, mask] = observed.options.slice(-2); expect(scan).toMatchObject({ image: { width: 240, height: 600 }, layer: "raster", revision: "geometry-aligned" }); expect(scan.origin).toBeUndefined(); expect(mask.jobId).toBeUndefined();
    expect(host.textContent).toContain("mask cannot be projected");
  });
  it("Original draws projected row points and mapped NULL polygons without connecting unwrapped ink", async () => {
    await render(); await select("original");
    const runs = vi.mocked(drawCurveOverlay).mock.calls.at(-1)![1];
    expect(runs.map((run) => run.points.length)).toEqual([10, 9, 179]);
    const expected = projectAlignedPoint(gridJob(true).alignment!, 50, 0)!;
    expect(runs[0].points[0]).toEqual({ x: expected.x, row: expected.y });
    expect(context.closePath).toHaveBeenCalled(); expect(review.x[10]).toBeNull(); expect(review.x[20]).toBe(120);
  });
  it("labels preprocessed working raster honestly instead of the exact uploaded source", async () => {
    function Preprocessed() { return <RasterViewport job={{ ...gridJob(true), preprocess: { applied: ["deskew"], skipped: {}, skew_angle_deg: 1 } }} x={[1, 2]} gaps={[]} tool="inspect" showMask={false} onStroke={vi.fn()} onDiscardRange={vi.fn()} />; }
    await act(async () => root.render(<Preprocessed />)); await select("original"); expect(host.textContent).toContain("preprocessed working raster, not the exact uploaded image");
  });
  it("does not transfer an unsaved correction draft or old prediction into a different canonical geometry", async () => {
    vi.mocked(digitizationGateway.setEdits).mockRejectedValue(new Error("offline")); await render();
    await act(async () => { review.applyStroke([{ row: 30, x: 30 }, { row: 31, x: 40 }]); await review.flushEdits().catch(() => {}); });
    const oldKey = reviewDraftKey(gridJob(true))!, oldDraft = localStorage.getItem(oldKey); expect(oldDraft).not.toBeNull();
    const replacement = { ...gridJob(true), geometry_revision: "replaced-alignment", edits_revision: 10, alignment: { ...gridJob(true).alignment!, revision: "replaced-alignment", width: 150, height: 300 } };
    vi.mocked(digitizationGateway.getCurve).mockResolvedValue({ y0: 0, y1: 300, stride: 1, x: Array(300).fill(25), observed: Array(300).fill(true) });
    await render({ jobOverride: replacement }); expect(review.edits).toEqual([]); expect(review.x).toHaveLength(300); expect(review.x[30]).toBe(25);
    expect(digitizationGateway.getCurve).toHaveBeenCalledTimes(2); expect(localStorage.getItem(oldKey)).toBe(oldDraft); expect(reviewDraftKey(replacement)).not.toBe(oldKey);
  });
  it("retains legacy crop-frame corrections without offering unsafe adoption in aligned review", async () => {
    const legacyKey = `digitization-review-draft:${API_BASE}:grid`, raw = JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 2 }], edits_revision: 0 });
    localStorage.setItem(legacyKey, raw); await render(); expect(review.edits).toEqual([]); expect(review.hasLegacyDraft).toBe(false); expect(review.hasIncompatibleLegacyDraft).toBe(true);
    await act(async () => { await review.recoverLegacyEdits(); }); expect(review.saveError).toContain("no aligned-frame provenance"); expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(localStorage.getItem(legacyKey)).toBe(raw);
  });
});
