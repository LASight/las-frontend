import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TileLayer } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { loadImage } from "./tile-loader";

/**
 * A scrollable window onto a raster far too large to hold in the browser.
 *
 * Real logs run 30,000 to 127,000 pixels tall. Decoded, the largest is around
 * 190 MB — it cannot be an `<img>`, it cannot be a Plotly image trace, and it
 * cannot be held as one bitmap. So the viewport keeps a *depth window* in image
 * pixel coordinates, fetches only the tiles covering it, and evicts the rest.
 *
 * Three things make it usable rather than merely possible:
 *
 * - **Fixed tile boundaries.** Tiles are aligned to multiples of `TILE_HEIGHT`,
 *   so scrolling reuses tiles instead of requesting a new arbitrary window
 *   every frame — and the browser's own HTTP cache hits too.
 * - **Prefetch in the scroll direction.** One tile ahead, so continuous
 *   scrolling does not stutter on every boundary.
 * - **LRU eviction.** Decoded bitmaps are large; an unbounded cache would
 *   simply move the memory problem rather than solve it.
 */

/** Rows per tile. Large enough to keep request counts sane, small enough to decode fast. */
const TILE_HEIGHT = 1024;

/** Decoded tiles to keep. ~40 MB at full width, which is a fair budget. */
const MAX_CACHED_TILES = 24;

export interface Tile {
  /** Tile index; covers rows `[index * TILE_HEIGHT, (index + 1) * TILE_HEIGHT)`. */
  index: number;
  y0: number;
  y1: number;
  bitmap: ImageBitmap | HTMLImageElement;
}

interface Options {
  jobId: string | undefined;
  /** Full image height in pixels. */
  imageHeight: number;
  /** Column range to render; defaults to the whole width. */
  x0?: number;
  x1?: number;
  layer?: TileLayer;
  /** Visible height of the canvas in CSS pixels. */
  viewportHeight: number;
  /** Vertical zoom: canvas pixels per image row. */
  zoom: number;
}

export function useRasterViewport({
  jobId,
  imageHeight,
  x0 = 0,
  x1,
  layer = "raster",
  viewportHeight,
  zoom,
}: Options) {
  /** Topmost visible image row. */
  const [scrollRow, setScrollRow] = useState(0);
  const [tiles, setTiles] = useState<Map<number, Tile>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef(new Map<number, Tile>());
  const pendingRef = useRef(new Set<number>());
  const lastScrollRef = useRef(0);

  /** How many image rows fit in the canvas at the current zoom. */
  const rowsVisible = useMemo(
    () => Math.max(1, Math.ceil(viewportHeight / Math.max(zoom, 0.0001))),
    [viewportHeight, zoom]
  );

  const maxScrollRow = Math.max(0, imageHeight - rowsVisible);

  const scrollTo = useCallback(
    (row: number) => {
      setScrollRow(Math.max(0, Math.min(Math.round(row), maxScrollRow)));
    },
    [maxScrollRow]
  );

  const scrollBy = useCallback(
    (deltaRows: number) => scrollTo(lastScrollRef.current + deltaRows),
    [scrollTo]
  );

  useEffect(() => {
    lastScrollRef.current = scrollRow;
  }, [scrollRow]);

  /** Tile indices covering the window, plus one ahead in the scroll direction. */
  const neededIndices = useMemo(() => {
    if (!jobId || imageHeight <= 0) return [];

    const first = Math.floor(scrollRow / TILE_HEIGHT);
    const last = Math.floor((scrollRow + rowsVisible) / TILE_HEIGHT);
    const lastTile = Math.floor((imageHeight - 1) / TILE_HEIGHT);

    const indices: number[] = [];
    for (let i = Math.max(0, first - 1); i <= Math.min(lastTile, last + 1); i += 1) {
      indices.push(i);
    }
    return indices;
  }, [jobId, imageHeight, scrollRow, rowsVisible]);

  // Fetch whatever is missing, then evict least-recently-needed tiles.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function fetchMissing() {
      const cache = cacheRef.current;
      const pending = pendingRef.current;

      const missing = neededIndices.filter(
        (index) => !cache.has(index) && !pending.has(index)
      );
      if (missing.length === 0) return;

      await Promise.all(
        missing.map(async (index) => {
          pending.add(index);
          const y0 = index * TILE_HEIGHT;
          const y1 = Math.min(imageHeight, y0 + TILE_HEIGHT);
          try {
            const url = digitizationGateway.tileUrl(jobId as string, {
              y0,
              y1,
              x0,
              x1,
              layer,
            });
            if (!url) return;
            const bitmap = await loadImage(url);
            if (cancelled) return;
            cache.set(index, { index, y0, y1, bitmap });
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : "Tile failed to load.");
            }
          } finally {
            pending.delete(index);
          }
        })
      );

      if (cancelled) return;

      // Evict anything outside the needed range, oldest first. Map preserves
      // insertion order, which is close enough to LRU for a scrolling viewport.
      const keep = new Set(neededIndices);
      while (cache.size > MAX_CACHED_TILES) {
        const evictable = [...cache.keys()].find((index) => !keep.has(index));
        if (evictable === undefined) break;
        cache.delete(evictable);
      }

      setTiles(new Map(cache));
    }

    void fetchMissing();
    return () => {
      cancelled = true;
    };
  }, [jobId, neededIndices, imageHeight, x0, x1, layer]);

  // A different job or layer invalidates every tile.
  useEffect(() => {
    cacheRef.current = new Map();
    pendingRef.current = new Set();
    setTiles(new Map());
    setError(null);
  }, [jobId, layer, x0, x1]);

  /** Tiles overlapping the window, ready to draw. */
  const visibleTiles = useMemo(
    () =>
      neededIndices
        .map((index) => tiles.get(index))
        .filter((tile): tile is Tile => tile !== undefined),
    [neededIndices, tiles]
  );

  return {
    scrollRow,
    rowsVisible,
    maxScrollRow,
    scrollTo,
    scrollBy,
    visibleTiles,
    /** True until at least one tile covering the window has arrived. */
    isLoading: visibleTiles.length === 0 && neededIndices.length > 0,
    error,
    tileHeight: TILE_HEIGHT,
  };
}
