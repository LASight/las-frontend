import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialGridDraft } from "../../controllers/grid-alignment-controller";
import type { GridDraft } from "../../controllers/grid-alignment-controller";
import { gridJob } from "../../test-fixtures/grid-alignment-fixtures";
import { GridReferenceViewport } from "./grid-reference-viewport";
import type { ViewTransform } from "./cropper/viewport-transform";

const observed = vi.hoisted(() => ({ view: { scale: 1, tx: 0, ty: 0 } }));
vi.mock("./cropper/use-lod-tiles", () => ({ useLodTiles: ({ view }: { view: ViewTransform }) => { observed.view = view; return { tiles: [], error: null, isLoading: false, retry: vi.fn() }; } }));
let host: HTMLDivElement, root: Root, originals: Array<[string, PropertyDescriptor | undefined]>;
const place = vi.fn(), cancel = vi.fn();
const move = vi.fn();
function Frame({ placing = false, disabled = false, focused = false, side = "left" }: { placing?: boolean; disabled?: boolean; focused?: boolean; side?: "left" | "right" }) {
  return <div data-focus={focused}><GridReferenceViewport job={gridJob()} draft={initialGridDraft(gridJob())} target={{ index: 0, side }} placing={placing} disabled={disabled} onPlace={place} onCancelPlace={cancel} /></div>;
}
const canvas = () => host.querySelector<HTMLCanvasElement>('canvas[aria-label="Grid reference canvas"]')!;
async function render(props = {}) { await act(async () => root.render(<Frame {...props} />)); }
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
async function pointer(type: string, x = 60, y = 60, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }); Object.defineProperty(event, "pointerId", { value: 1 });
  await act(async () => canvas().dispatchEvent(event)); await tick();
}
describe("explicit grid placement vs safe scan navigation", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("ResizeObserver", class { constructor(private cb: ResizeObserverCallback) {} observe(target: Element) { this.cb([{ target, contentRect: { width: 240, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
    const captured = new Set<number>(); originals = ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperties(HTMLElement.prototype, { setPointerCapture: { configurable: true, value: (id: number) => captured.add(id) }, hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) }, releasePointerCapture: { configurable: true, value: (id: number) => captured.delete(id) } });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name); } });
  it("navigation is the default and neither clicks nor pans adopt crop references", async () => {
    await render(); expect(host.textContent).toContain("Pan / Inspect");
    await pointer("pointerdown"); await pointer("pointerup");
    await pointer("pointerdown", 100, 100); await pointer("pointermove", 100, 50); await pointer("pointerup", 100, 50);
    expect(place).not.toHaveBeenCalled(); expect(observed.view.ty).toBe(-50);
  });
  async function adjustable() {
    const draft: GridDraft = initialGridDraft(gridJob()); draft.anchors[0].left = { x:"70", y:"90", confirmed:true };
    await act(async () => root.render(<GridReferenceViewport job={gridJob()} draft={draft} target={{ index:0, side:"left" }} placing={false} disabled={false} onPlace={place} onCancelPlace={cancel} onMoveReference={move} />));
    const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Adjust marked points")!;
    await act(async () => button.click());
  }
  it("explicit point adjustment commits once on release without advancing placement", async () => {
    await adjustable(); await pointer("pointerdown",70,90); await pointer("pointermove",80,100); expect(move).not.toHaveBeenCalled();
    await pointer("pointerup",80,100); expect(move).toHaveBeenCalledTimes(1); expect(move).toHaveBeenCalledWith(0,"left",{ x:80,y:100 }); expect(place).not.toHaveBeenCalled();
  });
  it.each(["pointercancel", "lostpointercapture", "escape"])("adjustment on %s is rolled back locally", async (mode) => {
    await adjustable(); await pointer("pointerdown",70,90); await pointer("pointermove",80,100);
    if (mode === "escape") await act(async () => canvas().dispatchEvent(new KeyboardEvent("keydown",{ key:"Escape", bubbles:true })));
    else await pointer(mode);
    await pointer("pointerup",80,100); expect(move).not.toHaveBeenCalled(); expect(place).not.toHaveBeenCalled();
  });
  it("rejects an adjustment outside the crop rather than clamping or accepting it", async () => {
    await adjustable(); await pointer("pointerdown",70,90); await pointer("pointermove",230,100); await pointer("pointerup",230,100);
    expect(move).not.toHaveBeenCalled(); expect(host.textContent).toContain("Point not moved");
  });
  it("a source revision change cancels an in-flight adjustment instead of rebasing it", async () => {
    await adjustable(); await pointer("pointerdown",70,90); await pointer("pointermove",80,100);
    const job = { ...gridJob(), geometry_revision:"another-working-frame" }, draft = initialGridDraft(job);
    await act(async () => root.render(<GridReferenceViewport job={job} draft={draft} target={{ index:0, side:"left" }} placing={false} disabled={false} onPlace={place} onCancelPlace={cancel} onMoveReference={move} />));
    await pointer("pointerup",80,100); expect(move).not.toHaveBeenCalled(); expect(place).not.toHaveBeenCalled();
  });
  it("an explicit Set reference click returns full working-raster coordinates", async () => {
    await render({ placing: true }); expect(host.textContent).toContain("click printed LEFT");
    await pointer("pointerdown", 70, 90); await pointer("pointerup", 70, 90);
    expect(place).toHaveBeenCalledWith({ x: 70, y: 90 });
  });
  it("a drag in placement mode cannot accidentally place a reference", async () => {
    await render({ placing: true }); await pointer("pointerdown"); await pointer("pointermove", 100, 100); await pointer("pointerup", 100, 100);
    expect(place).not.toHaveBeenCalled();
  });
  it.each(["middle", "space"])("%s navigation overrides Set reference without placing", async (mode) => {
    await render({ placing: true });
    if (mode === "space") { await act(async () => canvas().focus()); await act(async () => canvas().dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }))); }
    const button = mode === "middle" ? 1 : 0;
    await pointer("pointerdown", 100, 100, button); await pointer("pointermove", 100, 50, button); await pointer("pointerup", 100, 50, button);
    expect(place).not.toHaveBeenCalled(); expect(observed.view.ty).toBe(-50);
  });
  it.each(["pointercancel", "lostpointercapture", "escape"])("cancels an explicit placement gesture on %s", async (type) => {
    await render({ placing: true }); await pointer("pointerdown");
    if (type === "escape") await act(async () => canvas().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    else await pointer(type);
    await pointer("pointerup"); expect(place).not.toHaveBeenCalled(); if (type === "escape") expect(cancel).toHaveBeenCalled();
  });
  it("disabling or changing selected reference during a gesture prevents late placement", async () => {
    await render({ placing: true }); await pointer("pointerdown"); await render({ placing: true, disabled: true }); await pointer("pointerup"); expect(place).not.toHaveBeenCalled();
    await render({ placing: true }); await pointer("pointerdown"); await render({ placing: true, side: "right" }); await pointer("pointerup"); expect(place).not.toHaveBeenCalled();
  });
  it("focus-layout and field renders preserve the mounted canvas and zoom", async () => {
    await render(); const node = canvas();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click()); await tick(); const scale = observed.view.scale;
    await render({ focused: true }); expect(canvas()).toBe(node); expect(observed.view.scale).toBe(scale); expect(place).not.toHaveBeenCalled();
  });
  it("provides top/middle/bottom and selected-reference travel without placing", async () => {
    await render(); const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Bottom line")!;
    await act(async () => button.click()); await tick(); expect(observed.view.ty).toBeLessThan(0); expect(place).not.toHaveBeenCalled();
  });
});
