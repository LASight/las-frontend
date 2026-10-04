import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { segmentJob } from "../../../test-fixtures/collection-fixtures";
import { TrackCropper } from "./track-cropper";

const focus = vi.hoisted(() => vi.fn());
vi.mock("./use-pan-zoom", () => {
  const pan = { view: { scale: 1, tx: 0, ty: 0 }, isPanning: false, focusRegionStart: focus };
  return { ZOOM_STEP: 1.6, usePanZoom: () => pan };
});
vi.mock("./use-lod-tiles", () => ({ useLodTiles: () => ({ tiles: [], error: null, isLoading: false, retry: vi.fn() }) }));
vi.mock("../scan-minimap", () => ({ ScanMinimap: () => null }));
let root: Root, host: HTMLDivElement;
const saved = { x_left: 25, x_right: 528, y_top: 14662, y_bottom: 16692 };
const draft = { ...saved, y_top: 14700 };
const onChange = vi.fn();

describe("unified cropper focus toolbar", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    focus.mockClear(); onChange.mockClear(); host = document.createElement("div"); root = createRoot(host);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { this.callback([{ target, contentRect: { width: 564, height: 520 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
  });
  afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("autofocuses saved bounds, but manual Segment start can recover the visible draft without changing it", async () => {
    const job = { ...segmentJob("repeat"), crop: saved, raster: { ...segmentJob("repeat").raster, width: 2705, height: 40000 } };
    const snapshot = structuredClone(job);
    await act(async () => root.render(<TrackCropper job={job} crop={draft} compact focusSavedCropStart onChange={onChange} />));
    expect(focus).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenLastCalledWith(saved);
    const button = host.querySelector("#focus-segment-start") as HTMLButtonElement;
    expect(button.textContent).toBe("Segment start"); expect(button.disabled).toBe(false);
    await act(async () => button.click()); expect(focus).toHaveBeenLastCalledWith(draft);
    expect(onChange).not.toHaveBeenCalled(); expect(job).toEqual(snapshot); expect(draft.y_top).toBe(14700);
  });

  it("leaves the legacy wizard opt-out unchanged, without autofocus or new toolbar action", async () => {
    await act(async () => root.render(<TrackCropper job={segmentJob("standalone")} crop={saved} onChange={onChange} />));
    expect(focus).not.toHaveBeenCalled(); expect(host.querySelector("#focus-segment-start")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
