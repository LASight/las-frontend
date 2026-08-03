import { describe, expect, it } from "vitest";

import {
  MIN_CROP_WIDTH_PX,
  cropToScreen,
  defaultCrop,
  hitTestHandle,
  moveCrop,
  normalizeCrop,
  resizeCrop,
} from "./crop-rect";
import { initialView, screenToImage, zoomToAt } from "./viewport-transform";

const IMAGE = { width: 2705, height: 55150 };
const VIEWPORT = { width: 900, height: 600 };
const CROP = { x_left: 513, x_right: 2050, y_top: 0, y_bottom: 55150 };

describe("hitTestHandle", () => {
  const view = { scale: 0.25, tx: 0, ty: 0 };
  const crop = { x_left: 400, x_right: 2000, y_top: 400, y_bottom: 2000 };
  const box = cropToScreen(crop, view);

  it("prefers a corner over the edges that meet there", () => {
    expect(hitTestHandle(crop, { x: box.left, y: box.top }, view)).toBe("top-left");
    expect(hitTestHandle(crop, { x: box.right, y: box.bottom }, view)).toBe(
      "bottom-right"
    );
  });

  it("finds an edge away from the corners", () => {
    const midY = (box.top + box.bottom) / 2;
    expect(hitTestHandle(crop, { x: box.left, y: midY }, view)).toBe("left");
    expect(hitTestHandle(crop, { x: box.right, y: midY }, view)).toBe("right");
  });

  it("reports move inside and nothing outside", () => {
    expect(
      hitTestHandle(
        crop,
        { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
        view
      )
    ).toBe("move");
    expect(hitTestHandle(crop, { x: box.left - 60, y: box.top - 60 }, view)).toBeNull();
  });

  it("keeps the same screen-space target size at any zoom", () => {
    // Hit-testing in image space would make handles unclickable when zoomed out
    // and absurdly large when zoomed in.
    for (const scale of [1 / 64, 1, 8]) {
      const zoomed = { scale, tx: 0, ty: 0 };
      const at = cropToScreen(crop, zoomed);
      expect(hitTestHandle(crop, { x: at.left + 6, y: at.top + 6 }, zoomed)).toBe(
        "top-left"
      );
    }
  });
});

describe("resizeCrop", () => {
  it("lands on the exact source column when dragged at high zoom", () => {
    // The precision promise: at 8x, one screen pixel is an eighth of a source
    // pixel, so a handle drag must resolve to a specific column.
    const view = zoomToAt(initialView(IMAGE, VIEWPORT), { x: 0, y: 0 }, 8);
    const target = { x: 1487, y: 100 };
    const screenPoint = {
      x: target.x * view.scale + view.tx,
      y: target.y * view.scale + view.ty,
    };
    const resized = resizeCrop(CROP, "left", screenToImage(screenPoint, view), IMAGE);
    expect(resized.x_left).toBe(1487);
  });

  it("refuses to let an edge cross its opposite", () => {
    const resized = resizeCrop(CROP, "left", { x: 9999, y: 0 }, IMAGE);
    expect(resized.x_left).toBe(CROP.x_right - MIN_CROP_WIDTH_PX);
    expect(resized.x_left).toBeLessThan(resized.x_right);
  });

  it("clamps to the raster bounds so no background enters the crop", () => {
    expect(resizeCrop(CROP, "left", { x: -500, y: 0 }, IMAGE).x_left).toBe(0);
    expect(resizeCrop(CROP, "right", { x: 99999, y: 0 }, IMAGE).x_right).toBe(
      IMAGE.width
    );
    expect(resizeCrop(CROP, "top", { x: 0, y: -20 }, IMAGE).y_top).toBe(0);
    expect(resizeCrop(CROP, "bottom", { x: 0, y: 1e9 }, IMAGE).y_bottom).toBe(
      IMAGE.height
    );
  });

  it("moves both edges of a corner and leaves the others alone", () => {
    const resized = resizeCrop(CROP, "top-left", { x: 700, y: 900 }, IMAGE);
    expect(resized).toEqual({
      x_left: 700,
      y_top: 900,
      x_right: CROP.x_right,
      y_bottom: CROP.y_bottom,
    });
  });
});

describe("moveCrop", () => {
  it("preserves the selection size when it hits an edge", () => {
    // Clamping each edge independently would squash the rectangle, silently
    // changing the selection width when the user only asked to move it.
    const crop = { x_left: 100, x_right: 600, y_top: 100, y_bottom: 600 };
    const moved = moveCrop(crop, { x: -9999, y: 0 }, IMAGE);
    expect(moved.x_left).toBe(0);
    expect(moved.x_right - moved.x_left).toBe(500);
  });
});

describe("normalizeCrop", () => {
  it("repairs a typed value that inverts the rectangle", () => {
    // HTML min/max on a number input are advisory; a keyboard ignores them.
    const fixed = normalizeCrop(
      { x_left: 2600, x_right: 300, y_top: 500, y_bottom: 100 },
      IMAGE
    );
    expect(fixed.x_right - fixed.x_left).toBeGreaterThanOrEqual(MIN_CROP_WIDTH_PX);
    expect(fixed.y_bottom).toBeGreaterThan(fixed.y_top);
  });

  it("survives a cleared input becoming NaN", () => {
    const fixed = normalizeCrop(
      { x_left: Number.NaN, x_right: 800, y_top: 0, y_bottom: 900 },
      IMAGE
    );
    expect(Number.isFinite(fixed.x_left)).toBe(true);
    expect(fixed.x_left).toBe(0);
  });

  it("leaves a valid crop untouched", () => {
    expect(normalizeCrop(CROP, IMAGE)).toEqual(CROP);
  });
});

describe("defaultCrop", () => {
  it("selects the middle 60% of the width and the full height", () => {
    const crop = defaultCrop(IMAGE);
    expect(crop.x_left).toBe(541);
    expect(crop.x_right).toBe(2164);
    expect(crop.y_top).toBe(0);
    expect(crop.y_bottom).toBe(IMAGE.height);
  });
});
