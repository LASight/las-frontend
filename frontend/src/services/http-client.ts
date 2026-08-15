/**
 * Shared HTTP plumbing for every API service.
 *
 * Extracted from `api-service.ts`, where `apiRequest` was private and would
 * otherwise have been copied into the digitization service — two request
 * helpers drifting apart on error handling being exactly the kind of
 * duplication that bites later.
 *
 * It now also carries the session. Every request picks up the access token and
 * a 401 transparently refreshes and retries once, so no caller had to change
 * when authentication arrived: `analyzeSamples()` still reads as one line, and
 * there is no `if (token)` scattered through fifteen service functions.
 */

import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
} from "./token-store";

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

  /** 401 — no session, or one that could not be refreshed. */
  get isUnauthorized(): boolean {
    return this.status === 401;
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

/** Attach the bearer token without disturbing headers the caller set. */
function withAuth(init: RequestInit): RequestInit {
  const token = getAccessToken();
  if (!token) return init;

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * The in-flight refresh, if there is one.
 *
 * A page load fires several requests at once — the analysis payload, the job,
 * the digitization health probe. When the access token has expired they all
 * 401 together, and without this each would refresh independently. That is not
 * merely wasteful: the backend *rotates* refresh tokens, so the second refresh
 * would present one the first had already revoked and the user would be signed
 * out by their own concurrency.
 */
let refreshInFlight: Promise<boolean> | null = null;

const NON_REFRESHABLE_AUTH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/refresh",
  "/api/auth/logout",
]);

function canRefresh(path: string): boolean {
  return !NON_REFRESHABLE_AUTH_PATHS.has(path);
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  // Deliberately a bare `fetch`, not `apiRequest`: routing the refresh through
  // the same helper that triggers refreshes is how you write an infinite loop.
  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  setSession(await response.json());
  return true;
}

/** Refresh at most once concurrently, and let every waiter share the result. */
function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= refreshSession()
    .catch(() => {
      clearSession();
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let response = await fetch(`${API_BASE}${path}`, withAuth(init));

  // One retry, and only for 401. A second 401 after a successful refresh means
  // the account genuinely cannot do this, and retrying again would just be a
  // slower way to show the same error.
  if (response.status === 401 && canRefresh(path)) {
    if (await refreshOnce()) {
      response = await fetch(`${API_BASE}${path}`, withAuth(init));
    }
  }

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

/**
 * Perform an authenticated request and expose its response metadata.
 *
 * Downloads need headers such as `Content-Disposition`, so parsing their body
 * inside the shared client would discard information the caller needs.
 */
export function apiRequestResponse(path: string, init: RequestInit = {}): Promise<Response> {
  return send(path, init);
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

/** PATCH a JSON body. */
export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
