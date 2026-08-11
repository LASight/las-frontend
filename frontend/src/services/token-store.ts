/**
 * Where the session's credentials live.
 *
 * A plain module rather than React state, because `http-client.ts` has to read
 * the access token on every request and it is not a component. Keeping this
 * outside React also means the token survives a re-render, a route change and
 * StrictMode's double-mount, none of which should be able to sign a user out.
 *
 * **The access token is deliberately in memory only.** It is the credential
 * that can do everything, and anything in `localStorage` is readable by any
 * script that gets onto the page. Losing it on a refresh is not a problem: the
 * refresh token is persisted, and `AuthProvider` trades it for a new access
 * token during the first paint.
 *
 * The refresh token *is* persisted, because "stay signed in after closing the
 * tab" is the entire feature. It is a weaker credential in one respect that
 * matters here — it is revocable, and `POST /api/auth/refresh` rotates it, so a
 * stolen copy stops working the moment the real client refreshes.
 */

const REFRESH_KEY = "wellsight.refresh_token";

let accessToken: string | null = null;
let mediaToken: string | null = null;

/** Fires whenever the session is established or cleared. */
type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to session changes; returns the unsubscribe function. */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * The token appended to raster tile URLs.
 *
 * Read synchronously by `tileUrl()`, which has to return a string rather than a
 * promise so the review canvas can hand it straight to `new Image()`.
 */
export function getMediaToken(): string | null {
  return mediaToken;
}

/**
 * Replace just the media token, leaving the session otherwise untouched.
 *
 * It expires four times faster than the access token, and nothing an `<img>`
 * does can trigger the ordinary refresh — so it is renewed on its own via
 * `POST /api/auth/media-token` when a tile fails.
 */
export function setMediaToken(token: string): void {
  mediaToken = token;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    // Private browsing, or storage disabled. A session that lasts until the tab
    // closes is a much better outcome than a page that will not load.
    return null;
  }
}

/** Record a freshly issued set of credentials. */
export function setSession(tokens: {
  access_token: string;
  refresh_token: string;
  media_token: string;
}): void {
  accessToken = tokens.access_token;
  mediaToken = tokens.media_token;
  try {
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  } catch {
    // See getRefreshToken.
  }
  notify();
}

/** Forget everything. Called on sign-out and on a refresh that fails. */
export function clearSession(): void {
  accessToken = null;
  mediaToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    // See getRefreshToken.
  }
  notify();
}

/** Whether there is anything worth trying to restore a session from. */
export function hasStoredSession(): boolean {
  return accessToken !== null || getRefreshToken() !== null;
}
