import type { CollectionExportRequest, CollectionSummary, JobSummary, SendToAnalysisResponse } from "../models/digitization-models";
import { apiRequest, apiRequestResponse, patchJson, postJson } from "./http-client";

const BASE = "/api/digitization/collections";
const path = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/** Collections always use the real API. No synthetic joined curve/demo science. */
export const collectionGateway = {
  create(source_job_id: string, title: string): Promise<CollectionSummary> {
    return postJson(`${BASE}/`, { source_job_id, title });
  },
  get(id: string): Promise<CollectionSummary> {
    return apiRequest(path(id));
  },
  addSegment(id: string, label: string): Promise<JobSummary> {
    return postJson(`${path(id)}/segments`, { label });
  },
  renameSegment(id: string, jobId: string, label: string): Promise<CollectionSummary> {
    return patchJson(`${path(id)}/segments/${encodeURIComponent(jobId)}`, { label });
  },
  detachSegment(id: string, jobId: string): Promise<CollectionSummary> {
    return apiRequest(`${path(id)}/segments/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  },
  async exportLas(id: string, request: CollectionExportRequest): Promise<{ text: string; fileName: string }> {
    const response = await apiRequestResponse(`${path(id)}/export-las`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
    return {
      text: await response.text(),
      fileName: response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/i)?.[1] ?? "collection.las",
    };
  },
  sendToAnalysis(id: string, request: CollectionExportRequest): Promise<SendToAnalysisResponse> {
    return postJson(`${path(id)}/send-to-analysis`, request);
  },
};
