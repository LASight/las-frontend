/**
 * Shared HTTP plumbing for every API service.
 *
 * Extracted from `api-service.ts`, where `apiRequest` was private and would
 * otherwise have been copied into the digitization service — two request
 * helpers drifting apart on error handling being exactly the kind of
 * duplication that bites later.
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

/** An API call that came back with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 503 — an optional backend dependency or the model checkpoint is missing. */
  get isUnavailable(): boolean {
    return this.status === 503;
  }

  /** 409 — the request is fine, the job is in the wrong phase for it. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Read FastAPI's `{"detail": ...}` out of an error response.
 *
 * The backend is careful to explain *what* is missing — which package to
 * install, which step to go back to — and surfacing "Request failed (503)"
 * instead would throw all of that away.
 */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    // Pydantic validation errors arrive as a list of {loc, msg}.
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => {
          const field = Array.isArray(item?.loc) ? item.loc.at(-1) : undefined;
          return field ? `${field}: ${item.msg}` : item.msg;
        })
        .join("; ");
    }
  } catch {
    // Not JSON — fall through to the status-only message.
  }
  return `Request failed (${response.status})`;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  return response;
}

/** Perform a request and parse the JSON body. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

/** Perform a request expecting no body, e.g. a 204. */
export async function apiRequestVoid(path: string, init: RequestInit = {}): Promise<void> {
  await send(path, init);
}

/** Perform a request and return the raw body — used for PNG tiles and LAS text. */
export async function apiRequestBlob(
  path: string,
  init: RequestInit = {}
): Promise<Blob> {
  return (await send(path, init)).blob();
}

/** POST a JSON body. */
export function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
