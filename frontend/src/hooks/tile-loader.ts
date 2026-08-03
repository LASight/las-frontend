/**
 * Loading a tile PNG into something drawable.
 *
 * Shared by the review canvas (`use-raster-viewport`) and the crop editor
 * (`use-lod-tiles`). Only the loader is shared: the two differ in how they index
 * tiles — one walks a single depth axis, the other a 2-D grid across zoom levels
 * — and forcing one indexer to serve both would be more contortion than reuse.
 */

/**
 * Fetch a tile URL as an image element.
 *
 * An `Image` rather than `fetch` + `createImageBitmap` so the browser's HTTP
 * cache does the caching for us, which is what makes revisiting the same window
 * of a 127,000-px log free.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
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
