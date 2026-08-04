import { describe, expect, it } from "vitest";

import {
  PREFETCH_RING,
  TILE_OUTPUT_PX,
  levelForScale,
  lodGridRange,
  lodTilesForRange,
  tileSpanAtLevel,
} from "./lod-grid";
import { fitWidthScale, initialView } from "./viewport-transform";

/** A realistic scan, and a crop that excludes a 3,000-row header. */
const RASTER = { width: 2705, height: 55150 };
const CROP = { x: 513, y: 3000, width: 1537, height: 52150 };
const REGION = { width: CROP.width, height: CROP.height };
const VIEWPORT = { width: 900, height: 600 };

function tilesFor(view: Parameters<typeof lodGridRange>[1], origin?: { x: number; y: number }) {
  const level = levelForScale(view.scale);
  return lodTilesForRange({
    range: lodGridRange(REGION, view, VIEWPORT, level),
    level,
    image: REGION,
    origin,
  });
}

describe("levelForScale", () => {
  it("never picks a level coarser than the display", () => {
    for (const scale of [1, 0.9, 0.5, 0.4, 0.25, 0.1, 1 / 64]) {
      const tileScale = 1 / 2 ** levelForScale(scale);
      expect(tileScale).toBeGreaterThanOrEqual(scale - 1e-12);
      // ...and no more than 2x finer, or we would be downloading detail that
      // cannot be seen.
      expect(tileScale).toBeLessThan(scale * 2 + 1e-12);
    }
  });

  it("clamps to level 0 past 1:1 rather than asking for upscaling", () => {
    expect(levelForScale(1)).toBe(0);
    expect(levelForScale(8)).toBe(0);
  });

  it("survives a degenerate scale instead of returning NaN", () => {
    expect(levelForScale(0)).toBe(0);
    expect(levelForScale(Number.NaN)).toBe(0);
  });
});

describe("origin offset", () => {
  it("requests absolute raster pixels while keeping region-local rects", () => {
    // The bug this exists to prevent: the review canvas requested from raster
    // (0, 0) while drawing in crop-local space, so the cropped-off header came
    // back anyway *and* every overlay sat 3,000 rows from the trace it tracked.
    // Neither symptom throws — it renders a plausible, wrong picture.
    const view = initialView(REGION, VIEWPORT);
    const [first] = tilesFor(view, { x: CROP.x, y: CROP.y });

    expect(first.x0).toBe(0);
    expect(first.y0).toBe(0);
    expect(first.sourceX0).toBe(CROP.x);
    expect(first.sourceY0).toBe(CROP.y);
  });

  it("keeps the offset constant across every tile", () => {
    const view = { scale: 1, tx: -400, ty: -30000 };
    for (const tile of tilesFor(view, { x: CROP.x, y: CROP.y })) {
      expect(tile.sourceX0 - tile.x0).toBe(CROP.x);
      expect(tile.sourceY0 - tile.y0).toBe(CROP.y);
      expect(tile.sourceX1 - tile.x1).toBe(CROP.x);
      expect(tile.sourceY1 - tile.y1).toBe(CROP.y);
    }
  });

  it("leaves the mask layer alone, which is already crop-local", () => {
    const [first] = tilesFor(initialView(REGION, VIEWPORT));
    expect(first.sourceX0).toBe(first.x0);
    expect(first.sourceY0).toBe(first.y0);
  });

  it("puts the origin in the cache key, so a re-crop cannot reuse tiles", () => {
    const view = initialView(REGION, VIEWPORT);
    const a = tilesFor(view, { x: 513, y: 3000 })[0];
    const b = tilesFor(view, { x: 600, y: 3000 })[0];
    expect(a.key).not.toBe(b.key);
  });
});

describe("lodGridRange", () => {
  it("covers the visible region with no gaps and no duplicates", () => {
    const view = initialView(REGION, VIEWPORT);
    const tiles = tilesFor(view);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);

    const level = levelForScale(view.scale);
    const span = tileSpanAtLevel(level);
    for (const tile of tiles) {
      expect(tile.x0 % span).toBe(0);
      expect(tile.y0 % span).toBe(0);
    }
  });

  it("never runs past the region, so no tile asks for rows outside the crop", () => {
    const view = { scale: 1, tx: 0, ty: -(CROP.height - 100) };
    for (const tile of tilesFor(view, { x: CROP.x, y: CROP.y })) {
      expect(tile.x1).toBeLessThanOrEqual(REGION.width);
      expect(tile.y1).toBeLessThanOrEqual(REGION.height);
      expect(tile.sourceY1).toBeLessThanOrEqual(CROP.y + CROP.height);
      expect(tile.sourceX1).toBeLessThanOrEqual(CROP.x + CROP.width);
    }
  });

  it("keeps the request count bounded when zoomed all the way out", () => {
    // The point of the pyramid. At a fixed resolution this view would need
    // hundreds of full-size tiles; levels keep it to a screenful either way.
    const view = { scale: VIEWPORT.height / REGION.height, tx: 0, ty: 0 };
    expect(tilesFor(view).length).toBeLessThan(40);
  });

  it("asks for a comparable number of tiles at 1:1", () => {
    const view = { scale: 1, tx: -200, ty: -20000 };
    const tiles = tilesFor(view);
    const across = Math.ceil(VIEWPORT.width / TILE_OUTPUT_PX) + 2 * PREFETCH_RING + 1;
    const down = Math.ceil(VIEWPORT.height / TILE_OUTPUT_PX) + 2 * PREFETCH_RING + 1;
    expect(tiles.length).toBeLessThanOrEqual(across * down);
  });

  it("returns nothing for a degenerate region rather than a bogus tile", () => {
    expect(lodGridRange({ width: 0, height: 0 }, { scale: 1, tx: 0, ty: 0 }, VIEWPORT, 0))
      .toBeNull();
    expect(lodTilesForRange({ range: null, level: 0, image: REGION })).toEqual([]);
  });

  it("fits the region's width at the default view", () => {
    const view = initialView(REGION, VIEWPORT);
    expect(view.scale).toBeCloseTo(fitWidthScale(REGION, VIEWPORT), 10);
  });
});
