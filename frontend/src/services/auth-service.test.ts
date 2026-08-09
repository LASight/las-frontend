import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "./http-client";
import { clearSession, getAccessToken, getMediaToken, setSession } from "./token-store";

/**
 * The transparent-refresh path in `http-client`.
 *
 * Worth its own tests because it is invisible when it works and catastrophic
 * when it does not: a broken refresh signs everyone out an hour into a session,
 * and a refresh that fires more than once signs them out immediately — the
 * backend rotates refresh tokens, so the second request presents one the first
 * has already revoked.
 */

const API_BASE = "http://127.0.0.1:8000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokens(suffix: string) {
  return {
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    media_token: `media-${suffix}`,
    token_type: "bearer",
    expires_in: 3600,
  };
}

describe("http-client session handling", () => {
  beforeEach(() => {
    localStorage.clear();
    clearSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
    localStorage.clear();
  });

  it("attaches the access token to every request", async () => {
    setSession(tokens("1"));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/auth/me");

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer access-1");
  });

  it("sends no Authorization header when nobody is signed in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/health");

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("refreshes and retries once on a 401", async () => {
    setSession(tokens("1"));

    const fetchMock = vi
      .fn()
      // The original request, with the expired token.
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      // The refresh.
      .mockResolvedValueOnce(jsonResponse(tokens("2")))
      // The retry.
      .mockResolvedValueOnce(jsonResponse({ wells: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/api/analyses/abc")).resolves.toEqual({ wells: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE}/api/auth/refresh`);
    // The retry carries the *new* token, not the one that just failed.
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get("Authorization")).toBe(
      "Bearer access-2"
    );
    expect(getAccessToken()).toBe("access-2");
    expect(getMediaToken()).toBe("media-2");
  });

  it("refreshes only once when several requests 401 together", async () => {
    setSession(tokens("1"));

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/api/auth/refresh")) {
        return Promise.resolve(jsonResponse(tokens("2")));
      }
      const auth = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(
        auth === "Bearer access-2"
          ? jsonResponse({ ok: true })
          : jsonResponse({ detail: "expired" }, 401)
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // A page load fires several at once. Without single-flight, the second
    // refresh presents a token the first already revoked and the user is signed
    // out by their own concurrency.
    await Promise.all([
      apiRequest("/api/analyses/a"),
      apiRequest("/api/analyses/b"),
      apiRequest("/api/analyses/c"),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/auth/refresh")
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("clears the session and surfaces the 401 when the refresh fails", async () => {
    setSession(tokens("1"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "revoked" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/api/analyses/abc")).rejects.toBeInstanceOf(ApiError);

    // Cleared, so `AuthProvider` hears about it and the guard redirects rather
    // than the app rendering a signed-in shell whose every request fails.
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("wellsight.refresh_token")).toBeNull();
  });

  it("does not try to refresh the auth endpoints themselves", async () => {
    setSession(tokens("1"));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "bad" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest("/api/auth/login", { method: "POST" })
    ).rejects.toBeInstanceOf(ApiError);

    // A wrong password must surface as a wrong password, not send the client
    // round a refresh loop.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh token across a reload but not the access token", () => {
    setSession(tokens("1"));

    expect(localStorage.getItem("wellsight.refresh_token")).toBe("refresh-1");
    // The access token is the credential that can do everything; it stays in
    // memory so no script can read it out of storage.
    expect(localStorage.getItem("wellsight.access_token")).toBeNull();
  });
});
