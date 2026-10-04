import { describe, expect, it } from "vitest";

import {
  MAX_SCALE,
  MIN_SCALE,
  centerOnRow,
  clampView,
  fitHeightScale,
  fitWidthScale,
  focusRegionStart,
  imageToScreen,
  initialView,
  panBy,
  screenToImage,
  visibleImageRect,
  zoomAt,
  zoomToAt,
} from "./viewport-transform";

/** A realistic historical log: ~1:20, far too tall to fit on a screen. */
const IMAGE = { width: 2705, height: 55150 };
const VIEWPORT = { width: 900, height: 600 };

describe("coordinate round-trip", () => {
  it("returns the same image point at every zoom level", () => {
    const point = { x: 1487.25, y: 30219.5 };
    for (const scale of [1 / 256, 1 / 8, 0.5, 1, 4, 16]) {
      const view = { scale, tx: -123.5, ty: -4567.25 };
      const back = screenToImage(imageToScreen(point, view), view);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });
});

describe("zoomAt", () => {
  it("holds the image point under the cursor fixed", () => {
    const view = { scale: 0.25, tx: -100, ty: -2000 };
    const cursor = { x: 640, y: 420 };
    const before = screenToImage(cursor, view);

    const zoomed = zoomAt(view, cursor, 2.5);
    const after = screenToImage(cursor, zoomed);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomed.scale).toBeCloseTo(0.625, 10);
  });

  it("still holds the anchor when the zoom is clamped at the maximum", () => {
    // The naive implementation multiplies scale, clamps, and solves the
    // translation against the *unclamped* scale — the image then lurches at the
    // zoom limit even though the zoom itself stopped.
    const view = { scale: MAX_SCALE, tx: -50, ty: -80 };
    const cursor = { x: 300, y: 200 };
    const before = screenToImage(cursor, view);

    const zoomed = zoomAt(view, cursor, 4);

    expect(zoomed.scale).toBe(MAX_SCALE);
    const after = screenToImage(cursor, zoomed);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("reaches an absolute scale with zoomToAt", () => {
    const view = { scale: 0.1, tx: 0, ty: 0 };
    expect(zoomToAt(view, { x: 10, y: 10 }, 1).scale).toBeCloseTo(1, 10);
  });
});

describe("clampView", () => {
  it("never lets background appear on an axis the image can cover", () => {
    const view = { scale: 1, tx: 5000, ty: 9000 };
    const clamped = clampView(view, IMAGE, VIEWPORT);

    expect(clamped.tx).toBeLessThanOrEqual(0);
    expect(clamped.ty).toBeLessThanOrEqual(0);
    expect(clamped.tx + IMAGE.width * view.scale).toBeGreaterThanOrEqual(
      VIEWPORT.width
    );
    expect(clamped.ty + IMAGE.height * view.scale).toBeGreaterThanOrEqual(
      VIEWPORT.height
    );
  });

  it("centres an axis the image is too small to cover", () => {
    // A 1:20 log zoomed out to show its whole depth range is narrower than the
    // viewport by construction. Letterboxing is the honest outcome.
    const scale = fitHeightScale(IMAGE, VIEWPORT);
    const clamped = clampView({ scale, tx: 0, ty: 0 }, IMAGE, VIEWPORT);
    expect(clamped.tx).toBeCloseTo((VIEWPORT.width - IMAGE.width * scale) / 2, 6);
  });

  it("is idempotent", () => {
    const once = clampView({ scale: 0.5, tx: 400, ty: -12 }, IMAGE, VIEWPORT);
    expect(clampView(once, IMAGE, VIEWPORT)).toEqual(once);
  });
});

describe("initialView", () => {
  it("fits the width and starts at the top of the log", () => {
    const view = initialView(IMAGE, VIEWPORT);
    expect(view.scale).toBeCloseTo(fitWidthScale(IMAGE, VIEWPORT), 10);
    expect(view.tx).toBeCloseTo(0, 6);
    expect(view.ty).toBeCloseTo(0, 6);
  });
});

describe("panBy", () => {
  it("stops at the image boundary instead of running off", () => {
    const view = initialView(IMAGE, VIEWPORT);
    const panned = panBy(view, { x: 0, y: 5000 }, IMAGE, VIEWPORT);
    expect(panned.ty).toBe(0);
  });

  it("moves freely away from the boundary", () => {
    const view = initialView(IMAGE, VIEWPORT);
    const panned = panBy(view, { x: 0, y: -300 }, IMAGE, VIEWPORT);
    expect(panned.ty).toBeCloseTo(-300, 6);
  });
});

describe("centerOnRow", () => {
  it("puts the requested row at the vertical centre", () => {
    const view = initialView(IMAGE, VIEWPORT);
    const centred = centerOnRow(view, 30000, IMAGE, VIEWPORT);
    const middle = screenToImage({ x: 0, y: VIEWPORT.height / 2 }, centred);
    expect(middle.y).toBeCloseTo(30000, 4);
  });
});

describe("visibleImageRect", () => {
  it("clips to the raster rather than reporting rows that do not exist", () => {
    const view = initialView(IMAGE, VIEWPORT);
    const rect = visibleImageRect(view, IMAGE, VIEWPORT);
    expect(rect.x0).toBe(0);
    expect(rect.y0).toBe(0);
    expect(rect.x1).toBeLessThanOrEqual(IMAGE.width);
    expect(rect.y1).toBeLessThanOrEqual(IMAGE.height);
  });
});

describe("focusRegionStart — readable selected segment, not whole-track fit", () => {
  const image = { width: 2705, height: 40000 };
  const viewport = { width: 564, height: 520 };
  const repeat = { x_left: 25, x_right: 528, y_top: 14662, y_bottom: 16692 };

  it("focuses the saved start and includes the depth labels outside the GR crop", () => {
    const view = focusRegionStart(repeat, image, viewport);
    expect(view.scale).toBeCloseTo((viewport.width - 48) / 648, 10);
    const top = imageToScreen({ x: repeat.x_left, y: repeat.y_top }, view);
    expect(top.y).toBeCloseTo(24 + 60 * view.scale, 10);
    const depthLabel = imageToScreen({ x: 600, y: repeat.y_top }, view);
    expect(depthLabel.x).toBeGreaterThan(0);
    expect(depthLabel.x).toBeLessThan(viewport.width - 24);
    expect(visibleImageRect(view, image, viewport).y0).toBeGreaterThan(14000);
  });

  it("uses the same legible width zoom for 2k, 10k and 20k-row crops", () => {
    const scales = [2030, 10000, 20000].map((height) => focusRegionStart({ ...repeat, y_bottom: repeat.y_top + height }, image, viewport).scale);
    expect(new Set(scales).size).toBe(1);
    expect(scales[0] * (repeat.x_right - repeat.x_left)).toBeGreaterThan(400);
    expect(10000 * scales[0]).toBeGreaterThan(viewport.height * 10);
  });

  it("provides 120 source pixels on both sides and top alignment away from boundaries", () => {
    const region = { x_left: 1400, x_right: 1903, y_top: 4000, y_bottom: 14000 };
    const view = focusRegionStart(region, image, VIEWPORT);
    expect(imageToScreen({ x: 1280, y: 3940 }, view)).toEqual(expect.objectContaining({ x: expect.closeTo(24, 6), y: expect.closeTo(24, 6) }));
    expect(imageToScreen({ x: 2023, y: 4000 }, view).x).toBeCloseTo(VIEWPORT.width - 24, 6);
    expect(imageToScreen({ x: 1400, y: 4000 }, view).y).toBeCloseTo(24 + 60 * view.scale, 6);
  });

  it("clamps near the raster bottom without changing the width-derived zoom", () => {
    const region = { ...repeat, y_top: 39880, y_bottom: 40000 };
    const view = focusRegionStart(region, image, viewport);
    expect(view.scale).toBe(focusRegionStart(repeat, image, viewport).scale);
    expect(view.ty).toBeCloseTo(viewport.height - image.height * view.scale, 6);
    expect(imageToScreen({ x: 25, y: region.y_top }, view).y).toBeLessThan(viewport.height);
    expect(imageToScreen({ x: 25, y: image.height }, view).y).toBeCloseTo(viewport.height, 6);
    expect(clampView(view, image, viewport)).toEqual(view);
  });

  it("clamps top/left/right image boundaries and letterboxes a short raster", () => {
    const smallImage = { width: 200, height: 50 };
    const view = focusRegionStart({ x_left: 0, x_right: 200, y_top: 0, y_bottom: 50 }, smallImage, VIEWPORT);
    expect(view.scale).toBeCloseTo((VIEWPORT.width - 48) / smallImage.width, 10);
    expect(view.tx).toBeCloseTo(24, 10);
    expect(view.ty).toBeCloseTo((VIEWPORT.height - smallImage.height * view.scale) / 2, 10);
  });

  it("honours MIN/MAX_SCALE, and clampView preserves that scale", () => {
    const maximum = focusRegionStart({ x_left: 100, x_right: 101, y_top: 100, y_bottom: 200 }, image, VIEWPORT, { horizontalContext: 0 });
    const hugeImage = { width: 100000000, height: 100000000 };
    const minimum = focusRegionStart({ x_left: 0, x_right: hugeImage.width, y_top: 0, y_bottom: 10000 }, hugeImage, VIEWPORT);
    expect(maximum.scale).toBe(MAX_SCALE); expect(minimum.scale).toBe(MIN_SCALE);
    expect(clampView(maximum, image, VIEWPORT).scale).toBe(MAX_SCALE);
    expect(clampView(minimum, hugeImage, VIEWPORT).scale).toBe(MIN_SCALE);
  });

  it("returns a finite fallback before the first viewport measurement", () => {
    const view = focusRegionStart(repeat, image, { width: 0, height: 0 });
    expect(Object.values(view).every(Number.isFinite)).toBe(true);
    expect(view).toEqual(initialView(image, { width: 0, height: 0 }));
  });

  it("does not mutate crop, raster dimensions or viewport inputs", () => {
    const crop = Object.freeze({ ...repeat });
    const raster = Object.freeze({ ...image });
    const size = Object.freeze({ ...viewport });
    focusRegionStart(crop, raster, size);
    expect(crop).toEqual(repeat); expect(raster).toEqual(image); expect(size).toEqual(viewport);
  });
});
