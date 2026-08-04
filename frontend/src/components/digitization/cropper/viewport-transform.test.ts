import { describe, expect, it } from "vitest";

import {
  MAX_SCALE,
  centerOnRow,
  clampView,
  fitHeightScale,
  fitWidthScale,
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
