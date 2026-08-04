/**
 * Which tiles a view needs, at which level, and what to ask the server for.
 *
 * Pulled out of `use-lod-tiles` and made pure because two coordinate spaces meet
 * here and conflating them does not throw. Everything drawn on the canvas is
 * **region-local** — for the review viewport that means crop-local, since
 * segmentation runs on `image[y_top:y_bottom, x_left:x_right]` and the mask and
 * curve both index from the crop's corner. The tile endpoint, meanwhile, only
 * ever speaks **absolute raster** coordinates. Dropping the offset between them
 * renders the wrong part of the scan under a correctly placed curve: it looks
 * entirely plausible and quietly invites the reviewer to correct the trace at
 * the wrong depth.
 */

import type { Size, ViewTransform } from "./viewport-transform";
import { visibleImageRect } from "./viewport-transform";

/** Every tile is this many pixels square on screen, at any level. */
export const TILE_OUTPUT_PX = 512;

/**
 * Extra ring of tiles fetched around the viewport.
 *
 * One is enough: it covers a flick of the pointer without turning every small
 * pan into a burst of speculative requests.
 */
export const PREFETCH_RING = 1;

export interface TileGridRange {
  span: number;
  firstCol: number;
  lastCol: number;
  firstRow: number;
  lastRow: number;
}

export interface LodTileSpec {
  key: string;
  level: number;
  /** Region-local rectangle — the space the canvas draws in. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Absolute raster rectangle — the space the tile endpoint expects. */
  sourceX0: number;
  sourceY0: number;
  sourceX1: number;
  sourceY1: number;
}

/**
 * The level whose resolution is at or just above what the screen shows.
 *
 * Floored so the tile is never *coarser* than the display: an upscaled tile is
 * visibly soft, and softness on a well log reads as a bad scan rather than as a
 * rendering choice. The cost is at most 2x oversampling.
 */
export function levelForScale(scale: number): number {
  if (!(scale > 0)) return 0;
  return Math.max(0, Math.floor(Math.log2(1 / Math.min(scale, 1))));
}

/** Region pixels covered by one tile at a level. */
export function tileSpanAtLevel(level: number): number {
  return TILE_OUTPUT_PX * 2 ** level;
}

/**
 * The grid cells covering the viewport, plus the prefetch ring.
 *
 * Returned as five integers rather than a tile list on purpose: `view` is a
 * fresh object on every animation frame of a pan, so memoising a list on it
 * directly would hand the fetch effect a new array sixty times a second.
 * Anchored to the grid, this only changes when a boundary is actually crossed.
 */
export function lodGridRange(
  image: Size,
  view: ViewTransform,
  viewport: Size,
  level: number
): TileGridRange | null {
  if (image.width <= 0 || image.height <= 0) return null;
  const span = tileSpanAtLevel(level);
  const rect = visibleImageRect(view, image, viewport);
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return null;

  return {
    span,
    firstCol: Math.max(0, Math.floor(rect.x0 / span) - PREFETCH_RING),
    lastCol: Math.min(
      Math.ceil(image.width / span) - 1,
      Math.floor((rect.x1 - 1) / span) + PREFETCH_RING
    ),
    firstRow: Math.max(0, Math.floor(rect.y0 / span) - PREFETCH_RING),
    lastRow: Math.min(
      Math.ceil(image.height / span) - 1,
      Math.floor((rect.y1 - 1) / span) + PREFETCH_RING
    ),
  };
}

/** Expand a grid range into tile specs, resolving both coordinate spaces. */
export function lodTilesForRange(options: {
  range: TileGridRange | null;
  level: number;
  image: Size;
  origin?: { x: number; y: number };
  layer?: string;
}): LodTileSpec[] {
  const { range, level, image, origin, layer = "raster" } = options;
  if (!range) return [];

  const originX = origin?.x ?? 0;
  const originY = origin?.y ?? 0;
  const { span, firstCol, lastCol, firstRow, lastRow } = range;

  const tiles: LodTileSpec[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      const x0 = col * span;
      const y0 = row * span;
      const x1 = Math.min(image.width, (col + 1) * span);
      const y1 = Math.min(image.height, (row + 1) * span);
      tiles.push({
        // The origin is part of the identity: the same grid cell means
        // different raster pixels after a re-crop.
        key: `${layer}:${originX},${originY}:${level}:${col}:${row}`,
        level,
        x0,
        y0,
        x1,
        y1,
        sourceX0: x0 + originX,
        sourceY0: y0 + originY,
        sourceX1: x1 + originX,
        sourceY1: y1 + originY,
      });
    }
  }
  return tiles;
}
