import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanZoom } from "./use-pan-zoom";
import { useSavedCropFocus } from "./use-saved-crop-focus";
import { focusRegionStart, type FocusRegion, type Size } from "./viewport-transform";

const IMAGE = { width: 2705, height: 40000 };
const MEASURED = { width: 564, height: 520 };
const CROP = { x_left: 25, x_right: 528, y_top: 14662, y_bottom: 16692 };
let host: HTMLDivElement, root: Root;
let pan: ReturnType<typeof usePanZoom>;
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
const focusCalls = vi.fn();

function Harness({ enabled = true, jobId = "repeat", savedCrop = CROP, viewport = MEASURED, draft = CROP }: {
  enabled?: boolean; jobId?: string; savedCrop?: FocusRegion | null; viewport?: Size; draft?: FocusRegion;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  pan = usePanZoom({ image: IMAGE, viewport, targetRef });
  useSavedCropFocus({ enabled, jobId, savedCrop, viewport, focus: (crop) => { focusCalls(crop); pan.focusRegionStart(crop); } });
  return <div ref={targetRef}><output>{JSON.stringify(pan.view)}</output><span>{draft.x_left}</span></div>;
}
async function render(options: Parameters<typeof Harness>[0] = {}) { await act(async () => root.render(<Harness {...options} />)); }
async function flushFrame() {
  await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); });
}

describe("saved-crop autofocus with real usePanZoom initialization", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); root = createRoot(host); frames = new Map(); frameId = 0; focusCalls.mockClear();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

  it("waits for width AND height, then overrides the initial header view exactly once", async () => {
    await render({ viewport: { width: 0, height: 0 } }); expect(focusCalls).not.toHaveBeenCalled();
    await render({ viewport: { width: MEASURED.width, height: 0 } }); expect(focusCalls).not.toHaveBeenCalled();
    await render(); await flushFrame();
    expect(focusCalls).toHaveBeenCalledTimes(1);
    expect(pan.view).toEqual(focusRegionStart(CROP, IMAGE, MEASURED));
    await render({ savedCrop: { ...CROP } }); await flushFrame(); expect(focusCalls).toHaveBeenCalledTimes(1);
  });

  it("does not refocus on draft keystrokes, fresh polling objects or user pan/zoom", async () => {
    await render(); await flushFrame();
    await act(async () => { pan.beginPan({ x: 0, y: 0 }); pan.panTo({ x: -30, y: -200 }); pan.endPan(); }); await flushFrame();
    await act(async () => pan.zoomBy(1.6)); await flushFrame();
    const userView = { ...pan.view };
    await render({ savedCrop: { ...CROP }, draft: { ...CROP, x_left: 50 } }); await flushFrame();
    expect(pan.view).toEqual(userView); expect(focusCalls).toHaveBeenCalledTimes(1);
    // A resize re-clamps in usePanZoom without discarding the user's zoom.
    await render({ viewport: { width: 600, height: 550 }, draft: { ...CROP, x_left: 60 } }); await flushFrame();
    expect(pan.view.scale).toBe(userView.scale); expect(focusCalls).toHaveBeenCalledTimes(1);
  });

  it("refocuses once when a new crop is saved and once when selecting another job", async () => {
    await render(); await flushFrame();
    const saved = { ...CROP, y_top: 18000, y_bottom: 28000 };
    await render({ savedCrop: saved }); await flushFrame(); expect(focusCalls).toHaveBeenCalledTimes(2);
    expect(pan.view).toEqual(focusRegionStart(saved, IMAGE, MEASURED));
    await render({ savedCrop: { ...saved } }); await flushFrame(); expect(focusCalls).toHaveBeenCalledTimes(2);
    await render({ savedCrop: { ...saved }, jobId: "main" }); await flushFrame(); expect(focusCalls).toHaveBeenCalledTimes(3);
  });

  it("never auto-focuses an unsaved draft or changes legacy opt-out initialization", async () => {
    await render({ savedCrop: null, draft: CROP }); await flushFrame();
    expect(focusCalls).not.toHaveBeenCalled(); expect(pan.view.ty).toBe(0);
    await render({ enabled: false, savedCrop: CROP }); await flushFrame();
    expect(focusCalls).not.toHaveBeenCalled(); expect(pan.view.ty).toBe(0);
  });
});
