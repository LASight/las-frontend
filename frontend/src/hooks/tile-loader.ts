/**
 * Loading a tile PNG into something drawable.
 *
 * Shared by the review canvas (`use-raster-viewport`) and the crop editor
 * (`use-lod-tiles`). Only the loader is shared: the two differ in how they index
 * tiles — one walks a single depth axis, the other a 2-D grid across zoom levels
 * — and forcing one indexer to serve both would be more contortion than reuse.
 */

import { renewMediaToken, withCurrentMediaToken } from "../services/media-token";

/**
 * Fetch a tile URL as an image element.
 *
 * An `Image` rather than `fetch` + `createImageBitmap` so the browser's HTTP
 * cache does the caching for us, which is what makes revisiting the same window
 * of a 127,000-px log free.
 */
function attempt(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // The backend may be on a different port in dev; anonymous CORS keeps the
    // canvas untainted so it stays readable.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Tile failed to load: ${url}`));
    image.src = url;
  });
}

/**
 * Load a tile, renewing the media credential once if it fails.
 *
 * The retry is not defensive padding — it is the only way an expired media
 * token can be noticed. Tile URLs carry their credential in the query string
 * because an `Image` cannot send an `Authorization` header, and for the same
 * reason a 401 on a tile never reaches the `fetch` wrapper that refreshes a
 * session. The token lives a quarter as long as the access token, so without
 * this every tile in the app goes dark fifteen minutes into a session and stays
 * dark.
 *
 * `onerror` gives no status code — cross-origin image failures deliberately
 * report nothing — so this cannot distinguish "expired" from "job evicted" and
 * does not try. One renewal, one retry: if the credential was the problem the
 * retry succeeds, and if it was not, the second failure is the real one.
 */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  try {
    return await attempt(url);
  } catch (error) {
    if (!(await renewMediaToken())) throw error;

    const refreshed = withCurrentMediaToken(url);
    // The URL carried no credential to replace, so a retry would be identical
    // and the first failure was about something else.
    if (refreshed === url) throw error;

    return attempt(refreshed);
  }
}
