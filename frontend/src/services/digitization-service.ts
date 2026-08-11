import type {
  CurveEdit,
  CurveWindow,
  DigitizationHealth,
  ExportRequest,
  JobSummary,
  PreprocessSettings,
  SegmentationSettings,
  SendToAnalysisResponse,
  TileLayer,
  TrackCalibration,
  TrackCrop,
} from "../models/digitization-models";
import { API_BASE, apiRequest, apiRequestVoid, postJson } from "./http-client";
import { MockDigitizationGateway } from "./digitization-mock-gateway";
import { getAccessToken, getMediaToken } from "./token-store";

/**
 * Everything the digitization workspace needs from a backend.
 *
 * An interface rather than a module of functions so the UI depends on the
 * capability, not on `fetch`. That buys two concrete things:
 *
 * - The whole workflow is buildable and demoable before the model is served.
 *   Segmentation needs a 65 MB checkpoint and a torch install; the review
 *   canvas — the graded deliverable — does not, and should not have to wait.
 * - A defense or a demo on a machine with no backend still works.
 *
 * `tileUrl` returns a URL rather than a Blob on purpose: the review canvas
 * loads tiles through `Image`/`createImageBitmap` so the browser's HTTP cache
 * does the caching, which matters when scrolling a 127,000-px log revisits the
 * same windows constantly. That is also why the tile URL carries a `t`
 * credential in its query string — an `Image` cannot send an `Authorization`
 * header, so this one endpoint accepts a short-lived, read-only media token
 * instead.
 */
export interface DigitizationGateway {
  health(): Promise<DigitizationHealth>;

  createJob(file: File): Promise<JobSummary>;
  getJob(jobId: string): Promise<JobSummary>;
  deleteJob(jobId: string): Promise<void>;

  preprocess(jobId: string, settings: PreprocessSettings): Promise<JobSummary>;
  setCrop(jobId: string, crop: TrackCrop): Promise<JobSummary>;
  setCalibration(jobId: string, calibration: TrackCalibration): Promise<JobSummary>;

  startSegmentation(jobId: string, settings: SegmentationSettings): Promise<JobSummary>;

  getCurve(
    jobId: string,
    options?: { y0?: number; y1?: number; stride?: number }
  ): Promise<CurveWindow>;

  exportLas(jobId: string, request: ExportRequest): Promise<{ text: string; fileName: string }>;
  sendToAnalysis(jobId: string, request: ExportRequest): Promise<SendToAnalysisResponse>;

  tileUrl(
    jobId: string,
    options: {
      y0: number;
      y1: number;
      x0?: number;
      x1?: number;
      scale?: number;
      scaleX?: number;
      scaleY?: number;
      layer?: TileLayer;
    }
  ): string;
}

const BASE = "/api/digitization";

/** Talks to the FastAPI digitization router. */
export class HttpDigitizationGateway implements DigitizationGateway {
  health(): Promise<DigitizationHealth> {
    return apiRequest<DigitizationHealth>(`${BASE}/health`);
  }

  createJob(file: File): Promise<JobSummary> {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<JobSummary>(`${BASE}/jobs`, { method: "POST", body: form });
  }

  getJob(jobId: string): Promise<JobSummary> {
    return apiRequest<JobSummary>(`${BASE}/jobs/${jobId}`);
  }

  deleteJob(jobId: string): Promise<void> {
    return apiRequestVoid(`${BASE}/jobs/${jobId}`, { method: "DELETE" });
  }

  preprocess(jobId: string, settings: PreprocessSettings): Promise<JobSummary> {
    return postJson<JobSummary>(`${BASE}/jobs/${jobId}/preprocess`, settings);
  }

  setCrop(jobId: string, crop: TrackCrop): Promise<JobSummary> {
    return postJson<JobSummary>(`${BASE}/jobs/${jobId}/crop`, crop);
  }

  setCalibration(jobId: string, calibration: TrackCalibration): Promise<JobSummary> {
    return postJson<JobSummary>(`${BASE}/jobs/${jobId}/calibration`, calibration);
  }

  startSegmentation(jobId: string, settings: SegmentationSettings): Promise<JobSummary> {
    return postJson<JobSummary>(`${BASE}/jobs/${jobId}/segment`, settings);
  }

  getCurve(
    jobId: string,
    options: { y0?: number; y1?: number; stride?: number } = {}
  ): Promise<CurveWindow> {
    const params = new URLSearchParams();
    if (options.y0 !== undefined) params.set("y0", String(options.y0));
    if (options.y1 !== undefined) params.set("y1", String(options.y1));
    if (options.stride !== undefined) params.set("stride", String(options.stride));
    const query = params.toString();
    return apiRequest<CurveWindow>(
      `${BASE}/jobs/${jobId}/curve${query ? `?${query}` : ""}`
    );
  }

  async exportLas(
    jobId: string,
    request: ExportRequest
  ): Promise<{ text: string; fileName: string }> {
    const response = await fetch(`${API_BASE}${BASE}/jobs/${jobId}/export-las`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail || `Export failed (${response.status})`);
    }
    return {
      text: await response.text(),
      fileName: fileNameFromDisposition(
        response.headers.get("Content-Disposition")
      ),
    };
  }

  sendToAnalysis(jobId: string, request: ExportRequest): Promise<SendToAnalysisResponse> {
    return postJson<SendToAnalysisResponse>(
      `${BASE}/jobs/${jobId}/send-to-analysis`,
      request
    );
  }

  tileUrl(
    jobId: string,
    options: {
      y0: number;
      y1: number;
      x0?: number;
      x1?: number;
      scale?: number;
      scaleX?: number;
      scaleY?: number;
      layer?: TileLayer;
    }
  ): string {
    const params = new URLSearchParams({
      y0: String(Math.max(0, Math.floor(options.y0))),
      y1: String(Math.ceil(options.y1)),
    });
    if (options.x0 !== undefined) params.set("x0", String(Math.floor(options.x0)));
    if (options.x1 !== undefined) params.set("x1", String(Math.ceil(options.x1)));
    if (options.scale !== undefined) params.set("scale", options.scale.toFixed(4));
    if (options.scaleX !== undefined) params.set("scale_x", options.scaleX.toFixed(4));
    if (options.scaleY !== undefined) params.set("scale_y", options.scaleY.toFixed(4));
    if (options.layer) params.set("layer", options.layer);

    // The credential goes last so it does not disturb the readability of a URL
    // that gets read a lot in the network tab while debugging tiling.
    const media = getMediaToken();
    if (media) params.set("t", media);

    return `${API_BASE}${BASE}/jobs/${jobId}/tile?${params.toString()}`;
  }
}

/**
 * A tile URL is only usable while its media token is.
 *
 * The token outlives fifteen minutes of scrolling but not an afternoon with the
 * tab open, and a stale one makes every tile 404 with no visible cause. The
 * viewport hooks key their caches on this so a refreshed session re-mints its
 * URLs rather than redrawing from dead ones.
 */
export function tileCredentialKey(): string {
  return getMediaToken() ?? getAccessToken() ?? "anonymous";
}

/**
 * Pull the server's suggested filename out of `Content-Disposition`.
 *
 * The backend exposes the header through CORS specifically so this works; if it
 * ever stops, the fallback keeps the download usable rather than failing.
 */
function fileNameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "digitized.las";
}

/**
 * The gateway the app uses.
 *
 * Set `VITE_DIGITIZATION_MOCK=true` to run the whole workflow with no backend
 * at all.
 */
export const digitizationGateway: DigitizationGateway =
  import.meta.env.VITE_DIGITIZATION_MOCK === "true"
    ? new MockDigitizationGateway()
    : new HttpDigitizationGateway();

/** True when the app is running against the mock, so the UI can say so. */
export const IS_MOCK_GATEWAY = import.meta.env.VITE_DIGITIZATION_MOCK === "true";

export function isMockGateway(): boolean {
  return IS_MOCK_GATEWAY;
}

export const curveEditKinds: ReadonlyArray<CurveEdit["kind"]> = [
  "redraw",
  "discard",
  "accept",
];
