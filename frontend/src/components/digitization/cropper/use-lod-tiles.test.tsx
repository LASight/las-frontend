import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadImage } from "../../../hooks/tile-loader";
import { useLodTiles } from "./use-lod-tiles";

vi.mock("../../../hooks/tile-loader", () => ({ loadImage: vi.fn() }));
vi.mock("../../../services/digitization-service", () => ({
  digitizationGateway: { tileUrl: (id: string, tile: { y0: number }) => `${id}:${tile.y0}` },
  tileCredentialKey: () => "test",
}));

let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useLodTiles>;
const image = { width: 400, height: 4000 };
const viewport = { width: 400, height: 400 };
function Probe({ ty = 0, jobId = "job", height = image.height }: { ty?: number; jobId?: string; height?: number }) {
  result = useLodTiles({ jobId, image: { ...image, height }, viewport, view: { tx: 0, ty, scale: 1 } });
  return null;
}
const deferred = () => {
  let resolve!: (image: HTMLImageElement) => void;
  const promise = new Promise<HTMLImageElement>((yes) => { resolve = yes; });
  return { promise, resolve };
};

describe("LOD request lifetime", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("retains in-flight shared tiles across viewport cancellation, without needing zoom", async () => {
    const requests: ReturnType<typeof deferred>[] = [];
    vi.mocked(loadImage).mockImplementation(() => {
      const request = deferred(); requests.push(request); return request.promise;
    });
    await act(async () => root.render(<Probe />));
    await act(async () => root.render(<Probe ty={-600} />));
    await act(async () => root.render(<Probe />));
    expect(new Set(vi.mocked(loadImage).mock.calls.map(([url]) => url)).size).toBe(requests.length);
    await act(async () => requests.forEach((request) => request.resolve(new Image())));
    expect(result.tiles.length).toBeGreaterThan(0);
    expect(result.isLoading).toBe(false);
    expect(result.error).toBeNull();
  });

  it("does not erase initial requests under StrictMode", async () => {
    const request = deferred();
    vi.mocked(loadImage).mockReturnValue(request.promise);
    await act(async () => root.render(<StrictMode><Probe height={400} /></StrictMode>));
    await act(async () => request.resolve(new Image()));
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(result.tiles).toHaveLength(1);
    expect(result.isLoading).toBe(false);
  });

  it("ignores late results from a different job", async () => {
    const old = deferred(); const current = deferred();
    vi.mocked(loadImage).mockImplementation((url) => url.startsWith("old") ? old.promise : current.promise);
    await act(async () => root.render(<Probe jobId="old" height={400} />));
    await act(async () => root.render(<Probe jobId="new" height={400} />));
    await act(async () => old.resolve(new Image()));
    expect(result.tiles).toHaveLength(0);
    await act(async () => current.resolve(new Image()));
    expect(result.tiles).toHaveLength(1);
  });

  it("retries failures with bounded backoff and offers manual retry after exhaustion", async () => {
    vi.useFakeTimers();
    vi.mocked(loadImage).mockRejectedValue(new Error("network"));
    await act(async () => root.render(<Probe height={400} />));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(loadImage).toHaveBeenCalledTimes(3);
    expect(result.isLoading).toBe(false);
    expect(result.error).toBe("network");
    vi.mocked(loadImage).mockResolvedValue(new Image());
    await act(async () => result.retry());
    expect(loadImage).toHaveBeenCalledTimes(4);
    expect(result.isLoading).toBe(false);
    expect(result.error).toBeNull();
    expect(result.tiles).toHaveLength(1);
  });
});
