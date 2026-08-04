import { useEffect, useMemo, useRef, useState } from "react";

import type { TileLayer } from "../../../models/digitization-models";
import { loadImage } from "../../../hooks/tile-loader";
import { digitizationGateway } from "../../../services/digitization-service";
import type { LodTileSpec } from "./lod-grid";
import { levelForScale, lodGridRange, lodTilesForRange } from "./lod-grid";
import type { Size, ViewTransform } from "./viewport-transform";
import { visibleImageRect } from "./viewport-transform";

/**
 * A 2-D pyramid of tiles over a raster far too large to hold in the browser.
 *
 * Both the crop editor and the review canvas pan in two axes and zoom from the
 * whole 55,000-row log down to individual pixels — a range of about 10,000x.
 * Serving that from a single resolution means either downloading the full
 * raster when zoomed out or a blurry mess when zoomed in.
 *
 * So tiles come from **levels**. Level `k` serves the raster reduced by `2^k`,
 * and every tile at every level is the same square on screen — bounded decode
 * cost and a bounded request count no matter where the user is. The grid is
 * anchored in image coordinates, so the same tile URL is requested every time
 * that region is revisited and the browser's HTTP cache serves it for free.
 *
 * Coarser levels are kept in the cache rather than evicted on a zoom, and
 * `tiles` returns them ordered coarse-first. Drawing them as an underlay means a
 * zoom shows a low-resolution version of the right thing immediately instead of
 * flashing blank while the sharp tiles arrive.
 *
 * The grid arithmetic lives in `lod-grid`, pure and tested; this is the React
 * and network wrapper around it.
 */

/** Decoded tiles to keep. ~1 MB each once decoded, so this is a ~50 MB budget. */
const MAX_CACHED_TILES = 48;

export type LodTile = LodTileSpec & { bitmap: HTMLImageElement };

interface Options {
  jobId: string | undefined;
  /** Size of the region being viewed — the crop's, when a crop is in force. */
  image: Size;
  view: ViewTransform;
  viewport: Size;
  /**
   * Absolute raster pixel that region-local (0, 0) maps to.
   *
   * The crop editor views the whole raster and leaves this at the origin. The
   * review canvas views only the cropped track, so it passes the crop's
   * top-left — the tile endpoint always speaks absolute raster coordinates,
   * while every overlay drawn on top is crop-local.
   */
  origin?: { x: number; y: number };
  layer?: TileLayer;
}

export function useLodTiles({
  jobId,
  image,
  view,
  viewport,
  origin,
  layer = "raster",
}: Options) {
  const cacheRef = useRef(new Map<string, LodTile>());
  const pendingRef = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const level = levelForScale(view.scale);
  const originX = origin?.x ?? 0;
  const originY = origin?.y ?? 0;

  const range = useMemo(
    () => (jobId ? lodGridRange(image, view, viewport, level) : null),
    [jobId, image, view, viewport, level]
  );

  // Destructured to primitives before the tile list is built: `view` is a fresh
  // object on every animation frame of a pan, so memoising the list on `range`
  // itself would hand the fetch effect a new array sixty times a second.
  const { firstCol = 0, lastCol = -1, firstRow = 0, lastRow = -1, span = 0 } =
    range ?? {};

  const needed = useMemo(
    () =>
      lodTilesForRange({
        range: span > 0 ? { span, firstCol, lastCol, firstRow, lastRow } : null,
        level,
        image,
        origin: { x: originX, y: originY },
        layer,
      }),
    [
      firstCol,
      lastCol,
      firstRow,
      lastRow,
      span,
      level,
      layer,
      originX,
      originY,
      image,
    ]
  );

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
            // Request in absolute raster coordinates; the tile keeps its
            // region-local rect, which is the space the canvas draws in.
            const url = digitizationGateway.tileUrl(jobId as string, {
              x0: tile.sourceX0,
              x1: tile.sourceX1,
              y0: tile.sourceY0,
              y1: tile.sourceY1,
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
  }, [jobId, needed, layer, originX, originY]);

  // A different job or layer invalidates the whole pyramid.
  useEffect(() => {
    cacheRef.current = new Map();
    pendingRef.current = new Set();
    setError(null);
    setVersion((n) => n + 1);
  }, [jobId, layer, originX, originY]);

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
