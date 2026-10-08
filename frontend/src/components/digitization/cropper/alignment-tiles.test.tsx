import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadImage } from "../../../hooks/tile-loader";
import { digitizationGateway } from "../../../services/digitization-service";
import { useLodTiles } from "./use-lod-tiles";

vi.mock("../../../hooks/tile-loader", () => ({ loadImage: vi.fn() }));
vi.mock("../../../services/digitization-service", () => ({ digitizationGateway: { tileUrl: vi.fn((id: string, options: { revision?: string; cacheRevision?: number; layer?: string }) => `${id}:${options.layer}:${options.revision}:${options.cacheRevision}`) }, tileCredentialKey: () => "credential" }));
let root: Root, result: ReturnType<typeof useLodTiles>;
function Probe({ revision, publication, layer = "aligned" }: { revision?: string; publication?: number; layer?: "aligned" | "mask" }) {
  result = useLodTiles({ jobId: "grid", image: { width: 100, height: 200 }, view: { tx: 0, ty: 0, scale: 1 }, viewport: { width: 100, height: 200 }, layer, revision, cacheRevision: publication }); return null;
}
function deferred() { let resolve!: (value: HTMLImageElement) => void; const promise = new Promise<HTMLImageElement>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function render(props = {}) { await act(async () => root.render(<Probe {...props} />)); }
describe("tile frame/revision isolation", () => {
  beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); root = createRoot(document.createElement("div")); });
  afterEach(async () => { await act(async () => root.unmount()); });
  it("sends canonical bounds, aligned layer and the geometry guard through the shared loader", async () => {
    vi.mocked(loadImage).mockResolvedValue(new Image()); await render({ revision: "canonical-v2" });
    expect(digitizationGateway.tileUrl).toHaveBeenCalledWith("grid", expect.objectContaining({ x0: 0, x1: 100, y0: 0, y1: 200, layer: "aligned", revision: "canonical-v2" })); expect(result.tiles).toHaveLength(1);
  });
  it("does not draw deferred previous-geometry tiles even when dimensions are unchanged", async () => {
    const old = deferred(), current = deferred(); vi.mocked(loadImage).mockImplementation((url) => url.includes(":old:") ? old.promise : current.promise);
    await render({ revision: "old" }); await render({ revision: "current" }); await act(async () => old.resolve(new Image())); expect(result.tiles).toHaveLength(0);
    await act(async () => current.resolve(new Image())); expect(result.tiles).toHaveLength(1); expect(result.tiles[0].key).toContain("revision:current");
  });
  it("invalidates mask publication cache without treating an edits counter as geometry revision", async () => {
    const old = deferred(), current = deferred(); vi.mocked(loadImage).mockImplementation((url) => url.endsWith(":1") ? old.promise : current.promise);
    await render({ revision: "same-geometry", publication: 1, layer: "mask" }); await render({ revision: "same-geometry", publication: 2, layer: "mask" });
    await act(async () => old.resolve(new Image())); expect(result.tiles).toHaveLength(0); await act(async () => current.resolve(new Image())); expect(result.tiles).toHaveLength(1);
    expect(digitizationGateway.tileUrl).toHaveBeenLastCalledWith("grid", expect.objectContaining({ revision: "same-geometry", cacheRevision: 2 }));
  });
});
