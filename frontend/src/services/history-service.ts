import type { HistoryKind, HistoryPage } from "../models/auth-models";
import { apiRequest, apiRequestVoid } from "./http-client";

/**
 * The "my files" feed — every raster and LAS file this user has worked on.
 *
 * A gateway interface like the other two, though the surface is small: what it
 * buys is a seam the history workspace can be tested against without a server.
 */
export interface HistoryGateway {
  list(options?: {
    kind?: HistoryKind;
    limit?: number;
    offset?: number;
  }): Promise<HistoryPage>;

  remove(kind: HistoryKind, itemId: string): Promise<void>;
}

const BASE = "/api/history";

export class HttpHistoryGateway implements HistoryGateway {
  list(
    options: { kind?: HistoryKind; limit?: number; offset?: number } = {}
  ): Promise<HistoryPage> {
    const params = new URLSearchParams();
    if (options.kind) params.set("kind", options.kind);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const query = params.toString();
    return apiRequest<HistoryPage>(`${BASE}${query ? `?${query}` : ""}`);
  }

  remove(kind: HistoryKind, itemId: string): Promise<void> {
    return apiRequestVoid(`${BASE}/${kind}/${itemId}`, { method: "DELETE" });
  }
}

export const historyGateway: HistoryGateway = new HttpHistoryGateway();
