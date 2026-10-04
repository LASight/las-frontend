import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { segmentJob } from "../../../test-fixtures/collection-fixtures";
import type { ViewTransform } from "./viewport-transform";
import { TrackCropper } from "./track-cropper";
const observed = vi.hoisted(() => ({ view: { scale: 1, tx: 0, ty: 0 } }));
vi.mock("./use-lod-tiles", () => ({ useLodTiles: ({ view }: { view: ViewTransform }) => { observed.view = view; return { tiles: [], error: null, isLoading: false, retry: vi.fn() }; } }));
vi.mock("../scan-minimap", () => ({ ScanMinimap: () => null }));
let host: HTMLDivElement, root: Root, resize: ResizeObserverCallback, target: Element;
let captureDescriptors: Array<[string, PropertyDescriptor | undefined]>;
const crop = { x_left: 100, x_right: 200, y_top: 100, y_bottom: 300 };
const proposal = { index: 1, bounds: { x_left: 400, x_right: 500, y_top: 100, y_bottom: 300 }, seed_bounds: { x_left: 410, x_right: 490, y_top: 110, y_bottom: 290 }, confidence: .7 };
const change = vi.fn(), adopt = vi.fn(), start = vi.fn();
const stage = () => host.querySelector<HTMLElement>('[aria-label="Source crop canvas"]')!;
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
async function pointer(type: string, x: number, y: number, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(event, "pointerId", { value: 1 });
  await act(async () => stage().dispatchEvent(event)); await flush();
}
async function selectMode() { await act(async () => host.querySelector<HTMLButtonElement>("#crop-mode-select")!.click()); }
async function render(disabled = false) {
  const job = { ...segmentJob("nav"), raster: { ...segmentJob("nav").raster, width: 1000, height: 10000 } };
  await act(async () => root.render(<TrackCropper job={job} crop={crop} onChange={change} onSelectTrack={adopt} onDragStart={start} detectedTracks={[proposal]} disabled={disabled} />));
}
describe("crop gestures with real pan/zoom hook (not scientific fidelity)", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); change.mockClear(); adopt.mockClear(); start.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const captures = new Set<number>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe(element: Element) { target = element; resize([{ target, contentRect: { width: 1000, height: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
    captureDescriptors = ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: (id: number) => { captures.add(id); } },
      hasPointerCapture: { configurable: true, value: (id: number) => captures.has(id) },
      releasePointerCapture: { configurable: true, value: (id: number) => { captures.delete(id); } },
    });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const [name, descriptor] of captureDescriptors) { if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name); } });
  it("defaults to Navigate, ignoring proposals and handles on both clicks and drags", async () => {
    await render(); expect(stage().dataset.interactionMode).toBe("navigate");
    await pointer("pointerdown", 450, 150); await pointer("pointerup", 450, 150);
    await pointer("pointerdown", 100, 150); await pointer("pointermove", 110, 100); await pointer("pointerup", 110, 100);
    expect(change).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(observed.view.ty).toBeLessThan(0);
  });
  it("adopts only on a small select-mode pointer-up, never pointer-down", async () => {
    await render(); await selectMode(); await pointer("pointerdown", 450, 150); expect(adopt).not.toHaveBeenCalled();
    await pointer("pointerup", 453, 152); expect(adopt).toHaveBeenCalledTimes(1); expect(adopt).toHaveBeenCalledWith(proposal); expect(change).not.toHaveBeenCalled();
  });
  it("turns proposal drags into pan even if the pointer returns to the start", async () => {
    await render(); await selectMode(); await pointer("pointerdown", 450, 150); await pointer("pointermove", 450, 100); await pointer("pointermove", 450, 150); await pointer("pointerup", 450, 150);
    expect(adopt).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  });
  it.each(["pointercancel", "lostpointercapture"])("never adopts a cancelled pending proposal: %s", async (type) => {
    await render(); await selectMode(); await pointer("pointerdown", 450, 150); await pointer(type, 450, 150); await pointer("pointerup", 450, 150); expect(adopt).not.toHaveBeenCalled();
  });
  it("Escape releases a pending gesture without adopting or changing mode", async () => {
    await render(); await selectMode(); await pointer("pointerdown", 450, 150);
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await pointer("pointerup", 450, 150); expect(adopt).not.toHaveBeenCalled(); expect(stage().dataset.interactionMode).toBe("select");
  });
  it("middle mouse bypasses proposal and crop handle hit testing in Select mode", async () => {
    await render(); await selectMode(); await pointer("pointerdown", 100, 150, 1); await pointer("pointermove", 100, 80, 1); await pointer("pointerup", 100, 80, 1);
    expect(change).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled(); expect(observed.view.ty).toBeLessThan(0);
  });
  it("Space-drag pans over a handle and suppresses page scroll only with canvas focus", async () => {
    await render(); await selectMode(); await act(async () => stage().focus());
    const space = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    await act(async () => stage().dispatchEvent(space)); expect(space.defaultPrevented).toBe(true);
    await pointer("pointerdown", 100, 150); await pointer("pointermove", 100, 80); await pointer("pointerup", 100, 80);
    expect(change).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(observed.view.ty).toBeLessThan(0);
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true })));
  });
  it.each(["input", "textarea", "editable", "slider"])("does not hijack Space while typing in %s", async (kind) => {
    await render(); await selectMode(); const input = document.createElement(kind === "input" || kind === "textarea" ? kind : "div");
    if (kind === "editable") input.setAttribute("contenteditable", "true"); if (kind === "slider") input.setAttribute("role", "slider");
    input.tabIndex = 0; host.append(input); input.focus();
    const event = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false);
    await pointer("pointerdown", 100, 150); await pointer("pointermove", 90, 150); await pointer("pointerup", 90, 150); expect(change).toHaveBeenCalled();
  });
  it("scrolls without changing zoom or crop; Ctrl/Cmd wheel and pinch zoom at the pointer", async () => {
    await render(); const initialScale = observed.view.scale;
    await act(async () => stage().dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }))); await flush();
    expect(observed.view.scale).toBe(initialScale); expect(observed.view.ty).toBe(-100);
    await act(async () => stage().dispatchEvent(new WheelEvent("wheel", { deltaY: -20, ctrlKey: true, clientX: 250, clientY: 150, bubbles: true, cancelable: true }))); await flush();
    expect(observed.view.scale).toBeGreaterThan(initialScale); const next = observed.view.scale;
    await act(async () => stage().dispatchEvent(new WheelEvent("wheel", { deltaY: -30, metaKey: true, clientX: 250, clientY: 150, bubbles: true, cancelable: true }))); await flush();
    expect(observed.view.scale).toBeGreaterThan(next); expect(change).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled();
  });
  it("Shift wheel travels horizontally and resizing preserves the chosen zoom", async () => {
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('button[title="Zoom in"]')!.click()); await flush();
    const before = observed.view;
    await act(async () => stage().dispatchEvent(new WheelEvent("wheel", { deltaY: 50, shiftKey: true, bubbles: true, cancelable: true }))); await flush();
    expect(observed.view.tx).toBe(before.tx - 50); expect(observed.view.ty).toBe(before.ty);
    await act(async () => resize([{ target, contentRect: { width: 1300, height: 700 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(observed.view.scale).toBe(before.scale); expect(change).not.toHaveBeenCalled();
  });
  it("double-click zooms only in Navigate; select handles and keyboard nudges are explicit", async () => {
    await render(); await selectMode(); const before = observed.view.scale;
    await act(async () => stage().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 150, clientY: 150 }))); await flush(); expect(observed.view.scale).toBe(before);
    const edge = host.querySelector<HTMLButtonElement>('[aria-label^="left crop edge"]')!;
    await act(async () => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))); expect(change).toHaveBeenCalledWith({ ...crop, x_left: 99 });
    await act(async () => host.querySelector<HTMLButtonElement>("#crop-mode-navigate")!.click());
    await act(async () => stage().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 150, clientY: 150 }))); await flush(); expect(observed.view.scale).toBeGreaterThan(before);
  });
  it("a locked editor can navigate but never crop or adopt", async () => {
    await render(true); expect(host.querySelector<HTMLButtonElement>("#crop-mode-select")!.disabled).toBe(true);
    await pointer("pointerdown", 100, 150); await pointer("pointermove", 100, 80); await pointer("pointerup", 100, 80);
    expect(change).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled();
  });
});
