/**
 * Renewing the credential that raster tile URLs carry.
 *
 * The media token expires at a quarter of the access token's life, and tiles
 * are loaded with `new Image()` — which never touches `http-client`, so a tile
 * 401 cannot trigger the ordinary refresh. Without this, every tile in the app
 * silently stopped loading fifteen minutes into a session and stayed broken
 * until something else happened to refresh the whole thing.
 *
 * Renewal is not a session refresh: it presents the access token and mints only
 * the weaker credential, rotating no refresh token and writing no session row.
 */

import { apiRequest } from "./http-client";
import { getAccessToken, getMediaToken, setMediaToken } from "./token-store";

type MediaTokenResponse = {
  media_token: string;
  expires_in: number;
};

/**
 * At most one renewal in flight.
 *
 * A viewport holds a dozen tiles. When the token lapses they all fail within a
 * few milliseconds of each other, and without this every one of them would
 * mint its own token — twelve requests where one will do, and eleven tokens
 * immediately thrown away.
 */
let inFlight: Promise<boolean> | null = null;

async function renew(): Promise<boolean> {
  if (!getAccessToken()) return false;
  try {
    const response = await apiRequest<MediaTokenResponse>("/api/auth/media-token", {
      method: "POST",
    });
    setMediaToken(response.media_token);
    return true;
  } catch {
    // The access token is gone too, or the account is disabled. `http-client`
    // has already tried to refresh and cleared the session if it could not, so
    // the route guard will take it from here.
    return false;
  }
}

/** Renew the media token, sharing one request between concurrent callers. */
export function renewMediaToken(): Promise<boolean> {
  inFlight ??= renew().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Swap the `t` parameter of a tile URL for the current media token.
 *
 * The URL was built before the renewal, so it still carries the expired token.
 * Rebuilding it from scratch would mean threading the tile's window and scale
 * parameters through the retry path; replacing one query parameter is the same
 * result with none of that.
 */
export function withCurrentMediaToken(url: string): string {
  const token = getMediaToken();
  if (!token) return url;

  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("t", token);
  return parsed.toString();
}
