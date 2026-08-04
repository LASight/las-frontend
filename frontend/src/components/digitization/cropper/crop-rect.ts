/**
 * The crop rectangle, in raster pixel coordinates, and nothing else.
 *
 * The rectangle is anchored to the **image**, not to the screen. An iPhone-style
 * fixed rectangle with the photo sliding underneath is the wrong model here: the
 * two column edges of a well log track are set independently, minutes apart, at
 * high zoom. If panning re-selected, setting the right edge would silently move
 * the left one. Storing the crop in image pixels makes "pan and zoom never alter
 * the selection" true by construction rather than by careful bookkeeping.
 *
 * Pure functions, like `viewport-transform` — same reason.
 */

import type { TrackCrop } from "../../../models/digitization-models";
import type { Point, Size, ViewTransform } from "./viewport-transform";
import { imageToScreen } from "./viewport-transform";

/** Which part of the rectangle a pointer grabbed. */
export type CropHandle =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "move";

export const CORNER_HANDLES: readonly CropHandle[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export const EDGE_HANDLES: readonly CropHandle[] = [
  "left",
  "right",
  "top",
  "bottom",
];

/**
 * Smallest crop we will hand to the pipeline.
 *
 * A one-column crop passes every validation and then produces a calibration
 * that is arithmetically fine and physically meaningless. 20 px carries over
 * from the original selector.
 */
export const MIN_CROP_WIDTH_PX = 20;

/** Depth is resampled per row, so a crop shorter than this cannot carry a curve. */
export const MIN_CROP_HEIGHT_PX = 8;

/** How near a handle a pointer must land, in screen pixels. */
export const HANDLE_HIT_RADIUS_PX = 10;

const CURSORS: Record<CropHandle, string> = {
  left: "ew-resize",
  right: "ew-resize",
  top: "ns-resize",
  bottom: "ns-resize",
  "top-left": "nwse-resize",
  "bottom-right": "nwse-resize",
  "top-right": "nesw-resize",
  "bottom-left": "nesw-resize",
  move: "move",
};

export function cursorForHandle(handle: CropHandle | null): string {
  return handle ? CURSORS[handle] : "grab";
}

export function cropWidth(crop: TrackCrop): number {
  return crop.x_right - crop.x_left;
}

export function cropHeight(crop: TrackCrop): number {
  return crop.y_bottom - crop.y_top;
}

/** The crop's four corners in screen coordinates. */
export function cropToScreen(
  crop: TrackCrop,
  view: ViewTransform
): { left: number; top: number; right: number; bottom: number } {
  const topLeft = imageToScreen({ x: crop.x_left, y: crop.y_top }, view);
  const bottomRight = imageToScreen(
    { x: crop.x_right, y: crop.y_bottom },
    view
  );
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

/**
 * Which handle, if any, sits under a screen point.
 *
 * Corners win over edges: they overlap near the ends, and a user aiming at a
 * corner who gets an edge has to undo and retry. Hit-testing happens in screen
 * space so the target stays a comfortable size at every zoom level — testing in
 * image space would make handles unclickable when zoomed out and enormous when
 * zoomed in.
 */
export function hitTestHandle(
  crop: TrackCrop,
  screenPoint: Point,
  view: ViewTransform,
  radius: number = HANDLE_HIT_RADIUS_PX
): CropHandle | null {
  const box = cropToScreen(crop, view);
  const nearLeft = Math.abs(screenPoint.x - box.left) <= radius;
  const nearRight = Math.abs(screenPoint.x - box.right) <= radius;
  const nearTop = Math.abs(screenPoint.y - box.top) <= radius;
  const nearBottom = Math.abs(screenPoint.y - box.bottom) <= radius;

  const insideX =
    screenPoint.x >= box.left - radius && screenPoint.x <= box.right + radius;
  const insideY =
    screenPoint.y >= box.top - radius && screenPoint.y <= box.bottom + radius;

  if (nearLeft && nearTop) return "top-left";
  if (nearRight && nearTop) return "top-right";
  if (nearLeft && nearBottom) return "bottom-left";
  if (nearRight && nearBottom) return "bottom-right";

  if (nearLeft && insideY) return "left";
  if (nearRight && insideY) return "right";
  if (nearTop && insideX) return "top";
  if (nearBottom && insideX) return "bottom";

  if (
    screenPoint.x > box.left &&
    screenPoint.x < box.right &&
    screenPoint.y > box.top &&
    screenPoint.y < box.bottom
  ) {
    return "move";
  }
  return null;
}

/**
 * Drag a handle to an image-space point.
 *
 * The moving edge is clamped so it can neither leave the raster nor cross its
 * opposite edge — that is what keeps a crop from ever containing background,
 * which under image anchoring is purely a bounds question. Coordinates are
 * rounded to whole pixels because the crop is ultimately an array slice; a
 * fractional bound would be rounded somewhere less visible.
 */
export function resizeCrop(
  crop: TrackCrop,
  handle: CropHandle,
  imagePoint: Point,
  image: Size
): TrackCrop {
  const x = Math.round(imagePoint.x);
  const y = Math.round(imagePoint.y);
  const next = { ...crop };

  if (handle === "left" || handle === "top-left" || handle === "bottom-left") {
    next.x_left = clamp(x, 0, crop.x_right - MIN_CROP_WIDTH_PX);
  }
  if (handle === "right" || handle === "top-right" || handle === "bottom-right") {
    next.x_right = clamp(x, crop.x_left + MIN_CROP_WIDTH_PX, image.width);
  }
  if (handle === "top" || handle === "top-left" || handle === "top-right") {
    next.y_top = clamp(y, 0, crop.y_bottom - MIN_CROP_HEIGHT_PX);
  }
  if (
    handle === "bottom" ||
    handle === "bottom-left" ||
    handle === "bottom-right"
  ) {
    next.y_bottom = clamp(y, crop.y_top + MIN_CROP_HEIGHT_PX, image.height);
  }
  return next;
}

/**
 * Translate the whole rectangle by an image-space delta.
 *
 * The delta is trimmed rather than the result clamped: clamping each edge
 * independently at a boundary would squash the rectangle, silently changing the
 * selection size when the user only asked to move it.
 */
export function moveCrop(
  crop: TrackCrop,
  delta: Point,
  image: Size
): TrackCrop {
  const dx = clamp(Math.round(delta.x), -crop.x_left, image.width - crop.x_right);
  const dy = clamp(Math.round(delta.y), -crop.y_top, image.height - crop.y_bottom);
  return {
    x_left: crop.x_left + dx,
    x_right: crop.x_right + dx,
    y_top: crop.y_top + dy,
    y_bottom: crop.y_bottom + dy,
  };
}

/**
 * Force a crop into a valid state.
 *
 * Used on the numeric inputs, where a typed value can be anything: HTML `min`
 * and `max` attributes are advisory and do not stop a keyboard.
 */
export function normalizeCrop(crop: TrackCrop, image: Size): TrackCrop {
  const x_left = clamp(Math.round(crop.x_left), 0, image.width - MIN_CROP_WIDTH_PX);
  const y_top = clamp(Math.round(crop.y_top), 0, image.height - MIN_CROP_HEIGHT_PX);
  return {
    x_left,
    y_top,
    x_right: clamp(Math.round(crop.x_right), x_left + MIN_CROP_WIDTH_PX, image.width),
    y_bottom: clamp(
      Math.round(crop.y_bottom),
      y_top + MIN_CROP_HEIGHT_PX,
      image.height
    ),
  };
}

/**
 * The starting selection: the middle 60% of the width, full height.
 *
 * Historical logs put a depth-number column on the left and a margin on the
 * right, so the track is never the full frame. A place to drag from, not a
 * guess at the answer.
 */
export function defaultCrop(image: Size): TrackCrop {
  return normalizeCrop(
    {
      x_left: Math.round(image.width * 0.2),
      x_right: Math.round(image.width * 0.8),
      y_top: 0,
      y_bottom: image.height,
    },
    image
  );
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}
