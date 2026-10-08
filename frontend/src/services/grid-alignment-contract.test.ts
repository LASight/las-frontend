import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpDigitizationGateway } from "./digitization-service";
import { setSession } from "./token-store";
import { ApiError } from "./http-client";
import { gridAlignment, gridJob, gridPreview } from "../test-fixtures/grid-alignment-fixtures";
import { lodTilesForRange } from "../components/digitization/cropper/lod-grid";

const gateway = new HttpDigitizationGateway();
const spec = { anchors: gridAlignment.anchors, depth_unit: gridAlignment.depth_unit };
const guard = { expected_geometry_revision: "source-revision", expected_edits_revision: 7, acknowledge_reset: true };
describe("revision-aware alignment wire contract", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); setSession({ access_token: "operator-token", refresh_token: "refresh-token", media_token: "media-token" }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("previews via POST without edits/reset or durable PUT", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(gridPreview), { status: 200 }));
    expect(await gateway.previewAlignment("job", { ...spec, expected_geometry_revision: guard.expected_geometry_revision })).toEqual(gridPreview);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/jobs\/job\/alignment\/preview$/); expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ ...spec, expected_geometry_revision: "source-revision" });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer operator-token");
  });
  it("saves with both geometry and edits revisions and explicit acknowledgement", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(gridJob(true))));
    await gateway.saveAlignment("job", { ...spec, ...guard });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/jobs\/job\/alignment$/); expect(init?.method).toBe("POST"); expect(JSON.parse(init!.body as string)).toEqual({ ...spec, ...guard });
  });
  it("deletes with a JSON body, not a revision-free DELETE", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(gridJob())));
    await gateway.deleteAlignment("job", guard);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/jobs\/job\/alignment$/); expect(init?.method).toBe("DELETE"); expect(JSON.parse(init!.body as string)).toEqual(guard);
  });
  it("surfaces structured stale-geometry 409 messages clearly", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: { message: "Geometry revision conflict; reload the job before aligning.", geometry_revision: "new" } }), { status: 409 }));
    try { await gateway.previewAlignment("job", { ...spec, expected_geometry_revision: "old" }); throw new Error("Expected conflict"); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).status).toBe(409); expect((error as Error).message).toContain("reload the job"); }
  });
  it("uses aligned layer and geometry revision, leaving legacy URLs unchanged", () => {
    const old = new URL(gateway.tileUrl("job", { y0: 0, y1: 200 }), window.location.origin);
    expect(old.searchParams.has("revision")).toBe(false); expect(old.searchParams.has("cache_revision")).toBe(false);
    const query = new URL(gateway.tileUrl("job", { y0: 0, y1: 200, layer: "aligned", revision: "canonical-v2" }), window.location.origin).searchParams;
    expect(query.get("layer")).toBe("aligned"); expect(query.get("revision")).toBe("canonical-v2");
    expect(query.get("t")).toBe("media-token");
  });
  it("separates mask publications without confusing the geometry guard", () => {
    const query = new URL(gateway.tileUrl("job", { y0: 0, y1: 200, layer: "mask", revision: "canonical-v2", cacheRevision: 12 }), window.location.origin).searchParams;
    expect(query.get("revision")).toBe("canonical-v2"); expect(query.get("cache_revision")).toBe("12");
    const args = { range: { span: 512, firstCol: 0, lastCol: 0, firstRow: 0, lastRow: 0 }, level: 0, image: { width: 100, height: 200 }, layer: "mask" };
    expect(lodTilesForRange(args)[0].key).toBe("mask:0,0:0:0:0");
    expect(lodTilesForRange({ ...args, revision: "new" })[0].key).not.toBe(lodTilesForRange({ ...args, revision: "old" })[0].key);
    expect(lodTilesForRange({ ...args, revision: "new", cacheRevision: 1 })[0].key).not.toBe(lodTilesForRange({ ...args, revision: "new", cacheRevision: 2 })[0].key);
  });
  it("does not send alignment requests without an expected geometry revision", async () => {
    await expect(gateway.previewAlignment("job", { ...spec, expected_geometry_revision: "" })).rejects.toThrow("requires a geometry revision");
    await expect(gateway.saveAlignment("job", { ...spec, ...guard, expected_geometry_revision: "" })).rejects.toThrow("requires a geometry revision");
    await expect(gateway.deleteAlignment("job", { ...guard, expected_geometry_revision: "" })).rejects.toThrow("requires a geometry revision");
    expect(fetch).not.toHaveBeenCalled();
  });
});
