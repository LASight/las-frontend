import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpDigitizationGateway } from "./digitization-service";
import { apiRequest, apiRequestResponse } from "./http-client";
import { EMPTY_LAS_HEADER, type ExportRequest } from "../models/digitization-models";

vi.mock("./http-client", () => ({
  API_BASE: "http://test.invalid", apiRequest: vi.fn(), apiRequestResponse: vi.fn(),
  apiRequestVoid: vi.fn(), postJson: vi.fn(),
}));

describe("durable edits wire contract", () => {
  beforeEach(() => vi.clearAllMocks());
  const gateway = new HttpDigitizationGateway();

  it("PUTs the complete list with its expected revision and reads JobSummary", async () => {
    const edits = [{ kind: "discard" as const, y0: 10, y1: 20 }];
    const summary = { job_id: "job", edits, edits_revision: 4 };
    vi.mocked(apiRequest).mockResolvedValue(summary);
    expect(await gateway.setEdits("job", edits, 3)).toEqual(summary);
    expect(apiRequest).toHaveBeenCalledWith("/api/digitization/jobs/job/edits", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits, edits_revision: 3 }),
    });
  });

  it("carries an explicit reset and revision guard through LAS export", async () => {
    vi.mocked(apiRequestResponse).mockResolvedValue(new Response("~Version", {
      headers: { "Content-Disposition": "attachment; filename=reviewed.las" },
    }));
    const request: ExportRequest = { edits: [], edits_revision: 5, header: EMPTY_LAS_HEADER, step: 0.5 };
    await gateway.exportLas("job", request);
    expect(apiRequestResponse).toHaveBeenCalledWith("/api/digitization/jobs/job/export-las", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
  });
});
