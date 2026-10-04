import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { segmentJob } from "../../test-fixtures/collection-fixtures";
import type { ViewTransform } from "./cropper/viewport-transform";
import type { ReviewTool } from "../../hooks/use-curve-review";
import { RasterViewport } from "./raster-viewport";
const observed = vi.hoisted(() => ({ view: { scale: 1, tx: 0, ty: 0 } }));
vi.mock("./cropper/use-lod-tiles", () => ({ useLodTiles: ({ view }: { view: ViewTransform }) => { observed.view = view; return { tiles: [], error: null, isLoading: false, retry: vi.fn() }; } }));
vi.mock("./scan-minimap", () => ({ ScanMinimap: () => null }));
let host: HTMLDivElement, root: Root, resize: ResizeObserverCallback, target: Element;
let originals: Array<[string, PropertyDescriptor | undefined]>;
const stroke = vi.fn(), missing = vi.fn();
const job = { ...segmentJob("review"), crop: { x_left: 0, x_right: 500, y_top: 0, y_bottom: 1000 }, raster: { ...segmentJob("review").raster, width: 500, height: 1000 } };
const series = Object.freeze([1, 2, null, 4, 5]);
function Frame({ focused = false, tool = "redraw", showPrediction = true }: { focused?: boolean; tool?: ReviewTool; showPrediction?: boolean }) {
  return <div data-focus={focused}><RasterViewport job={job} x={series as unknown as Array<number | null>} gaps={[{ y0: 2, y1: 3 }]} tool={tool} showMask={false} showPrediction={showPrediction} predictionOpacity={showPrediction ? 100 : 0} onStroke={stroke} onDiscardRange={missing} /></div>;
}
const canvas = () => host.querySelector<HTMLCanvasElement>('canvas[aria-label="Curve review canvas"]')!;
async function render(props = {}) { await act(async () => root.render(<Frame {...props} />)); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
async function pointer(type: string, x = 100, y = 50, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }); Object.defineProperty(event, "pointerId", { value: 1 });
  await act(async () => canvas().dispatchEvent(event)); await flush();
}
describe("review navigation and draft stroke preservation (event tests, no ML evidence)", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); stroke.mockClear(); missing.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe(element: Element) { target = element; resize([{ target, contentRect: { width: 500, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
    const captured = new Set<number>();
    originals = ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: (id: number) => { captured.add(id); } }, hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) }, releasePointerCapture: { configurable: true, value: (id: number) => { captured.delete(id); } },
    });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name); } });
  it("preserves the same canvas, zoom and in-progress stroke across focus-layout/opacity changes and resize", async () => {
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('button[title="Zoom in"]')!.click()); await flush();
    const before = observed.view; const node = canvas();
    await pointer("pointerdown", 100, 50); await pointer("pointermove", 110, 70);
    await render({ focused: true, showPrediction: false });
    await act(async () => resize([{ target, contentRect: { width: 700, height: 600 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(canvas()).toBe(node); expect(observed.view.scale).toBe(before.scale);
    await pointer("pointermove", 120, 90); await pointer("pointerup", 120, 90);
    expect(stroke).toHaveBeenCalledTimes(1); expect(stroke.mock.calls[0][0]).toHaveLength(3);
    expect(stroke.mock.calls[0][0][0]).toEqual({ x: (100 - before.tx) / before.scale, row: Math.round((50 - before.ty) / before.scale) });
    expect(missing).not.toHaveBeenCalled(); expect(series).toEqual([1, 2, null, 4, 5]);
    await render({ focused: false, showPrediction: false }); expect(canvas()).toBe(node); expect(observed.view.scale).toBe(before.scale);
  });
  it.each(["redraw", "discard"] as const)("middle mouse pans instead of editing with %s selected", async (tool) => {
    await render({ tool }); await pointer("pointerdown", 100, 100, 1); await pointer("pointermove", 100, 50, 1); await pointer("pointerup", 100, 50, 1);
    expect(stroke).not.toHaveBeenCalled(); expect(missing).not.toHaveBeenCalled(); expect(observed.view.ty).toBe(-50);
  });
  it("Space temporarily pans without changing the Redraw tool or stroke data", async () => {
    await render(); await act(async () => canvas().focus());
    await act(async () => canvas().dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true })));
    await pointer("pointerdown", 100, 100); await pointer("pointermove", 100, 50); await pointer("pointerup", 100, 50);
    expect(stroke).not.toHaveBeenCalled(); expect(missing).not.toHaveBeenCalled();
    await act(async () => canvas().dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true })));
    await pointer("pointerdown"); await pointer("pointermove", 110, 70); await pointer("pointerup", 110, 70); expect(stroke).toHaveBeenCalledTimes(1);
  });
  it.each(["pointercancel", "lostpointercapture", "escape"])("cancels a pending stroke without committing data: %s", async (type) => {
    await render(); await pointer("pointerdown"); await pointer("pointermove", 110, 70);
    if (type === "escape") await act(async () => canvas().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    else await pointer(type, 110, 70);
    await pointer("pointerup", 110, 70); expect(stroke).not.toHaveBeenCalled(); expect(missing).not.toHaveBeenCalled();
  });
  it("Mark missing sends only an explicit depth interval, never erases the source", async () => {
    await render({ tool: "discard" }); await pointer("pointerdown", 100, 50); await pointer("pointermove", 110, 70); await pointer("pointerup", 110, 70);
    expect(missing).toHaveBeenCalledWith(50, 71); expect(stroke).not.toHaveBeenCalled(); expect(series).toEqual([1, 2, null, 4, 5]);
  });

  it.each(["redraw", "discard"] as const)("does not begin %s in zoomed-out image padding", async tool => {
    await render({ tool });
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Show the whole run"]')!.click()); await flush();
    expect(observed.view.tx).toBeGreaterThan(0);
    await pointer("pointerdown", 10, 50); await pointer("pointermove", 20, 70); await pointer("pointerup", 20, 70);
    expect(stroke).not.toHaveBeenCalled(); expect(missing).not.toHaveBeenCalled();
  });
});
