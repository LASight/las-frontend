import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_LAS_HEADER, type CollectionExportRequest } from "../models/digitization-models";
import { collectionGateway } from "./collection-service";
import { API_BASE } from "./http-client";
import { clearSession } from "./token-store";

describe("collection API contract (HTTP fixtures only)", () => {
  const fetchMock = vi.fn();
  const request: CollectionExportRequest = {
    header: EMPTY_LAS_HEADER, step: 0.5, overlap_choices: { "conflict-id": "segment-id" }, expected_revision: "fingerprint-string",
  };
  beforeEach(() => {
    clearSession(); vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it("creates from an original source job and manual title", async () => {
    await collectionGateway.create("source", "Manual title");
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/api/digitization/collections/`, expect.objectContaining({ method: "POST", body: JSON.stringify({ source_job_id: "source", title: "Manual title" }) }));
  });
  it("gets a summary and adds a job with a label only, not a raster/crop/edits copy", async () => {
    await collectionGateway.get("c");
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/digitization/collections/c`);
    await collectionGateway.addSegment("c", "Continuation");
    expect(fetchMock.mock.calls[1]).toEqual([`${API_BASE}/api/digitization/collections/c/segments`, expect.objectContaining({ method: "POST", body: '{"label":"Continuation"}' })]);
  });
  it("renames and detaches without deleting the standalone job", async () => {
    await collectionGateway.renameSegment("c", "job", "Label");
    expect(fetchMock.mock.calls[0]).toEqual([`${API_BASE}/api/digitization/collections/c/segments/job`, expect.objectContaining({ method: "PATCH", body: '{"label":"Label"}' })]);
    await collectionGateway.detachSegment("c", "job");
    expect(fetchMock.mock.calls[1]).toEqual([`${API_BASE}/api/digitization/collections/c/segments/job`, expect.objectContaining({ method: "DELETE" })]);
  });
  it("downloads the LAS with a string revision and explicit choices, never individual edits", async () => {
    fetchMock.mockResolvedValueOnce(new Response("~Version", { headers: { "Content-Disposition": 'attachment; filename="joined.las"' } }));
    expect(await collectionGateway.exportLas("c", request)).toEqual({ text: "~Version", fileName: "joined.las" });
    expect(fetchMock.mock.calls[0]).toEqual([`${API_BASE}/api/digitization/collections/c/export-las`, expect.objectContaining({ method: "POST", body: JSON.stringify(request) })]);
  });
  it("sends the same contract to analysis", async () => {
    await collectionGateway.sendToAnalysis("c", request);
    expect(fetchMock.mock.calls[0]).toEqual([`${API_BASE}/api/digitization/collections/c/send-to-analysis`, expect.objectContaining({ method: "POST", body: JSON.stringify(request) })]);
  });
  it("propagates stale revision errors without retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"Stale collection revision"}', { status: 409 }));
    await expect(collectionGateway.exportLas("c", request)).rejects.toThrow("Stale collection revision");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
