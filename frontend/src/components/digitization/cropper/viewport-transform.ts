/**
 * The mapping between raster pixels and the screen, and nothing else.
 *
 * Pure functions over plain objects: no React, no DOM, no canvas. That is
 * deliberate. Every precision claim the cropper makes — "this handle is on
 * column 1,487", "panning did not move the selection" — reduces to this
 * arithmetic, and arithmetic that lives inside a pointer handler cannot be
 * tested. Here it can, and is.
 *
 * The transform is uniform (one `scale` for both axes) so a well log never
 * appears stretched. Screen position is `image * scale + t`.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Screen = image * scale + (tx, ty). */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Zoom bounds.
 *
 * The upper bound is well past 1:1 on purpose — the whole point of the cropper
 * is aligning an edge with a specific source column, which needs a source pixel
 * to be several screen pixels wide.
 */
export const MAX_SCALE = 16;

/** Below one screen pixel per ~4,000 source pixels nothing is legible. */
export const MIN_SCALE = 1 / 4096;

export function imageToScreen(point: Point, view: ViewTransform): Point {
  return { x: point.x * view.scale + view.tx, y: point.y * view.scale + view.ty };
}

export function screenToImage(point: Point, view: ViewTransform): Point {
  return { x: (point.x - view.tx) / view.scale, y: (point.y - view.ty) / view.scale };
}

/**
 * Scale that makes the raster exactly fill the viewport width.
 *
 * The default view, because a historical log is around 1:20 — fitting the whole
 * image would render a 2,700 x 55,000 raster as a one-pixel-wide sliver.
 */
export function fitWidthScale(image: Size, viewport: Size): number {
  if (image.width <= 0 || viewport.width <= 0) return 1;
  return clampScale(viewport.width / image.width);
}

/** Scale that makes the whole raster height fit — the "see everything" view. */
export function fitHeightScale(image: Size, viewport: Size): number {
  if (image.height <= 0 || viewport.height <= 0) return 1;
  return clampScale(viewport.height / image.height);
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom about a fixed screen point.
 *
 * The image point under the cursor stays under the cursor, which is the
 * difference between a zoom that feels like a tool and one that feels like it
 * is fighting you. Centre-anchored zoom would throw the track off screen every
 * time the user tried to inspect an edge.
 *
 * Parameters
 * ----------
 * `factor` multiplies the current scale; clamping happens first, so the
 * translation is solved against the scale actually applied and the anchor never
 * drifts at the zoom limits.
 */
export function zoomAt(
  view: ViewTransform,
  anchor: Point,
  factor: number
): ViewTransform {
  const scale = clampScale(view.scale * factor);
  const imagePoint = screenToImage(anchor, view);
  return {
    scale,
    tx: anchor.x - imagePoint.x * scale,
    ty: anchor.y - imagePoint.y * scale,
  };
}

/** Set an absolute scale while holding `anchor` fixed on screen. */
export function zoomToAt(
  view: ViewTransform,
  anchor: Point,
  scale: number
): ViewTransform {
  return zoomAt(view, anchor, scale / view.scale);
}

/**
 * Stop the image from being dragged away from the viewport.
 *
 * Along an axis where the scaled image is at least as large as the viewport,
 * translation is clamped so no empty background can appear — the constraint the
 * redesign brief asks for.
 *
 * Along an axis where it is *smaller*, that constraint is unsatisfiable, so the
 * image is centred instead. This is not an edge case to be engineered away: a
 * 1:20 log zoomed out far enough to read the whole depth range is narrower than
 * the viewport by construction, and letterboxing it is the honest result.
 */
export function clampView(
  view: ViewTransform,
  image: Size,
  viewport: Size
): ViewTransform {
  const scaledWidth = image.width * view.scale;
  const scaledHeight = image.height * view.scale;

  const tx =
    scaledWidth >= viewport.width
      ? Math.min(0, Math.max(viewport.width - scaledWidth, view.tx))
      : (viewport.width - scaledWidth) / 2;

  const ty =
    scaledHeight >= viewport.height
      ? Math.min(0, Math.max(viewport.height - scaledHeight, view.ty))
      : (viewport.height - scaledHeight) / 2;

  return { scale: view.scale, tx, ty };
}

/**
 * The default view: fit the width, sit at the top of the log.
 *
 * Top rather than centred because depth runs downward and row 0 is where a
 * reader starts.
 */
export function initialView(image: Size, viewport: Size): ViewTransform {
  const scale = fitWidthScale(image, viewport);
  return clampView({ scale, tx: 0, ty: 0 }, image, viewport);
}

/** Translate by a screen-space delta, then re-clamp. */
export function panBy(
  view: ViewTransform,
  delta: Point,
  image: Size,
  viewport: Size
): ViewTransform {
  return clampView(
    { scale: view.scale, tx: view.tx + delta.x, ty: view.ty + delta.y },
    image,
    viewport
  );
}

/** Put an image point at the vertical centre of the viewport — used by the minimap. */
export function centerOnRow(
  view: ViewTransform,
  row: number,
  image: Size,
  viewport: Size
): ViewTransform {
  return clampView(
    { scale: view.scale, tx: view.tx, ty: viewport.height / 2 - row * view.scale },
    image,
    viewport
  );
}

/** The image-space rectangle currently visible, clipped to the raster. */
export function visibleImageRect(
  view: ViewTransform,
  image: Size,
  viewport: Size
): { x0: number; y0: number; x1: number; y1: number } {
  const topLeft = screenToImage({ x: 0, y: 0 }, view);
  const bottomRight = screenToImage(
    { x: viewport.width, y: viewport.height },
    view
  );
  return {
    x0: Math.max(0, topLeft.x),
    y0: Math.max(0, topLeft.y),
    x1: Math.min(image.width, bottomRight.x),
    y1: Math.min(image.height, bottomRight.y),
  };
}
