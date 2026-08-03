import { useEffect, useMemo, useRef, useState } from "react";

import type { TileLayer } from "../../../models/digitization-models";
import { loadImage } from "../../../hooks/tile-loader";
import { digitizationGateway } from "../../../services/digitization-service";
import type { Size, ViewTransform } from "./viewport-transform";
import { visibleImageRect } from "./viewport-transform";

/**
 * A 2-D pyramid of tiles over a raster far too large to hold in the browser.
 *
 * `use-raster-viewport` answers "which rows am I looking at" for the review
 * canvas, where the width is fixed and the zoom range is small. The crop editor
 * needs more: it pans in both axes and zooms from the whole 55,000-row log down
 * to individual pixels, a range of about 10,000x. Fetching at a single
 * resolution across that range means either downloading the full raster when
 * zoomed out or a blurry mess when zoomed in.
 *
 * So tiles come from **levels**. Level `k` serves the raster reduced by `2^k`,
 * and every tile at every level is the same {@link TILE_OUTPUT_PX} square on
 * screen — bounded decode cost and a bounded request count no matter where the
 * user is. The grid is anchored in image coordinates, so the same tile URL is
 * requested every time that region is revisited and the browser's HTTP cache
 * serves it for free.
 *
 * Coarser levels are kept in the cache rather than evicted on a zoom, and
 * `tiles` returns them ordered coarse-first. Drawing them as an underlay means a
 * zoom shows a low-resolution version of the right thing immediately instead of
 * flashing blank while the sharp tiles arrive.
 */

/** Every tile is this many pixels square on screen, at any level. */
export const TILE_OUTPUT_PX = 512;

/** Decoded tiles to keep. ~1 MB each once decoded, so this is a ~50 MB budget. */
const MAX_CACHED_TILES = 48;

/**
 * Extra ring of tiles fetched around the viewport.
 *
 * One tile is enough: it covers a flick of the pointer without turning every
 * small pan into a burst of speculative requests.
 */
const PREFETCH_RING = 1;

export interface LodTile {
  key: string;
  level: number;
  /** Image-space rectangle this tile covers. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bitmap: HTMLImageElement;
}

interface Options {
  jobId: string | undefined;
  image: Size;
  view: ViewTransform;
  viewport: Size;
  layer?: TileLayer;
}

/**
 * The level whose resolution is at or just above what the screen shows.
 *
 * Rounded so the tile is never *coarser* than the display — an upscaled tile is
 * visibly soft, and softness on a well log reads as a bad scan rather than as a
 * rendering choice. The cost is at most 2x oversampling.
 */
export function levelForScale(scale: number): number {
  if (!(scale > 0)) return 0;
  return Math.max(0, Math.floor(Math.log2(1 / Math.min(scale, 1))));
}

/** Image pixels covered by one tile at a level. */
export function tileSpanAtLevel(level: number): number {
  return TILE_OUTPUT_PX * 2 ** level;
}

export function useLodTiles({ jobId, image, view, viewport, layer = "raster" }: Options) {
  const cacheRef = useRef(new Map<string, LodTile>());
  const pendingRef = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const level = levelForScale(view.scale);

  /**
   * The grid range covering the viewport plus the prefetch ring.
   *
   * Deliberately reduced to four integers before the tile list is built. `view`
   * is a fresh object on every animation frame of a pan, so memoising the list
   * on `view` directly would hand the fetch effect a new array 60 times a
   * second. Anchored to the grid, the range only changes when a tile boundary
   * is actually crossed.
   */
  const range = useMemo(() => {
    if (!jobId || image.width <= 0 || image.height <= 0) return null;
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
  }, [jobId, image, view, viewport, level]);

  const { firstCol = 0, lastCol = -1, firstRow = 0, lastRow = -1, span = 0 } =
    range ?? {};

  /** Which tiles at the current level cover the viewport. */
  const needed = useMemo(() => {
    const out: Array<Omit<LodTile, "bitmap">> = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        out.push({
          key: `${layer}:${level}:${col}:${row}`,
          level,
          x0: col * span,
          y0: row * span,
          x1: Math.min(image.width, (col + 1) * span),
          y1: Math.min(image.height, (row + 1) * span),
        });
      }
    }
    return out;
  }, [
    firstCol,
    lastCol,
    firstRow,
    lastRow,
    span,
    level,
    layer,
    image.width,
    image.height,
  ]);

  useEffect(() => {
    if (!jobId || needed.length === 0) return;
    let cancelled = false;

    async function fetchMissing() {
      const cache = cacheRef.current;
      const pending = pendingRef.current;
      const missing = needed.filter(
        (tile) => !cache.has(tile.key) && !pending.has(tile.key)
      );
      if (missing.length === 0) return;

      await Promise.all(
        missing.map(async (tile) => {
          pending.add(tile.key);
          try {
            const url = digitizationGateway.tileUrl(jobId as string, {
              x0: tile.x0,
              x1: tile.x1,
              y0: tile.y0,
              y1: tile.y1,
              scale: 1 / 2 ** tile.level,
              layer,
            });
            if (!url) return;
            const bitmap = await loadImage(url);
            if (!cancelled) cache.set(tile.key, { ...tile, bitmap });
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : "Tile failed to load.");
            }
          } finally {
            pending.delete(tile.key);
          }
        })
      );

      if (cancelled) return;

      // Evict oldest-first, but never something the viewport currently needs.
      // Map preserves insertion order, which is close enough to LRU here.
      const keep = new Set(needed.map((tile) => tile.key));
      while (cache.size > MAX_CACHED_TILES) {
        const evictable = [...cache.keys()].find((key) => !keep.has(key));
        if (evictable === undefined) break;
        cache.delete(evictable);
      }

      setVersion((n) => n + 1);
    }

    void fetchMissing();
    return () => {
      cancelled = true;
    };
  }, [jobId, needed, layer]);

  // A different job or layer invalidates the whole pyramid.
  useEffect(() => {
    cacheRef.current = new Map();
    pendingRef.current = new Set();
    setError(null);
    setVersion((n) => n + 1);
  }, [jobId, layer]);

  /**
   * Everything drawable that overlaps the view, coarsest level first.
   *
   * The caller draws them in order, so a sharp tile lands on top of the blurry
   * stand-in it replaces and a partially loaded level never shows through as
   * empty background.
   */
  const tiles = useMemo(() => {
    const rect = visibleImageRect(view, image, viewport);
    const out: LodTile[] = [];
    for (const tile of cacheRef.current.values()) {
      if (tile.x1 <= rect.x0 || tile.x0 >= rect.x1) continue;
      if (tile.y1 <= rect.y0 || tile.y0 >= rect.y1) continue;
      out.push(tile);
    }
    return out.sort((a, b) => b.level - a.level);
    // `version` is what makes a newly arrived tile show up.
  }, [version, view, image, viewport]);

  const ready = tiles.some((tile) => tile.level === level);

  return { tiles, level, error, isLoading: !ready && needed.length > 0 };
}
