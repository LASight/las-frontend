import { describe, expect, it } from "vitest";

import type { DetectedTrack, TrackCrop } from "../../../models/digitization-models";
import {
  TRACK_COLORS,
  colorForTrack,
  preferredTrack,
  trackAtPoint,
  trackToCrop,
  tracksToScreen,
} from "./detected-tracks";
import { MIN_CROP_HEIGHT_PX, MIN_CROP_WIDTH_PX } from "./crop-rect";

const IMAGE = { width: 2705, height: 55150 };

function box(x0: number, x1: number, y0 = 0, y1 = 55150): TrackCrop {
  return { x_left: x0, x_right: x1, y_top: y0, y_bottom: y1 };
}

function track(
  index: number,
  bounds: TrackCrop,
  seedBounds: TrackCrop = bounds,
  confidence = 0.9
): DetectedTrack {
  return { index, bounds, seed_bounds: seedBounds, confidence };
}

describe("colorForTrack", () => {
  it("is stable for a given index", () => {
    expect(colorForTrack(2)).toBe(colorForTrack(2));
  });

  it("cycles rather than running out past the palette length", () => {
    expect(colorForTrack(TRACK_COLORS.length)).toBe(colorForTrack(0));
    expect(colorForTrack(TRACK_COLORS.length + 3)).toBe(colorForTrack(3));
  });

  it("assigns distinct colours to the first few tracks", () => {
    const colours = [0, 1, 2].map(colorForTrack);
    expect(new Set(colours).size).toBe(3);
  });
});

describe("trackToCrop", () => {
  it("uses the seed box, not the wobble-inclusive union box", () => {
    // A wide union box (as wobble produces) but a narrower, robust seed box -
    // the crop must come from the seed, or it would carry the neighbour's ink.
    const region = track(0, box(100, 500), box(150, 420));

    const crop = trackToCrop(region, IMAGE);

    expect(crop.x_left).toBe(150);
    expect(crop.x_right).toBe(420);
  });

  it("clamps a degenerate detection to the minimum crop size", () => {
    // A 2 px wide seed box must not survive as a 2 px crop the API would
    // reject with a 422 for falling under MIN_CROP_WIDTH_PX.
    const region = track(0, box(100, 500), box(200, 202));

    const crop = trackToCrop(region, IMAGE);

    expect(crop.x_right - crop.x_left).toBeGreaterThanOrEqual(MIN_CROP_WIDTH_PX);
  });

  it("clamps a seed box that reaches past the raster", () => {
    const region = track(0, box(0, IMAGE.width), box(-50, IMAGE.width + 200));

    const crop = trackToCrop(region, IMAGE);

    expect(crop.x_left).toBeGreaterThanOrEqual(0);
    expect(crop.x_right).toBeLessThanOrEqual(IMAGE.width);
  });

  it("respects the minimum crop height the same way", () => {
    const region = track(0, box(100, 500, 0, 5000), box(100, 500, 2000, 2001));

    const crop = trackToCrop(region, IMAGE);

    expect(crop.y_bottom - crop.y_top).toBeGreaterThanOrEqual(MIN_CROP_HEIGHT_PX);
  });
});

describe("tracksToScreen", () => {
  it("maps each track through the same transform imageToScreen uses", () => {
    const view = { scale: 0.5, tx: 10, ty: -20 };
    const tracks = [track(0, box(100, 300, 0, 400))];

    const [screen] = tracksToScreen(tracks, view);

    expect(screen).toEqual({ index: 0, left: 60, top: -20, right: 160, bottom: 180 });
  });

  it("preserves track order and count", () => {
    const tracks = [track(0, box(0, 10)), track(1, box(20, 30)), track(2, box(40, 50))];
    const view = { scale: 1, tx: 0, ty: 0 };

    expect(tracksToScreen(tracks, view).map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe("trackAtPoint", () => {
  it("finds the track containing a point", () => {
    const tracks = [track(0, box(0, 200)), track(1, box(300, 500))];

    expect(trackAtPoint(tracks, { x: 100, y: 100 })?.index).toBe(0);
    expect(trackAtPoint(tracks, { x: 400, y: 100 })?.index).toBe(1);
  });

  it("returns null outside every track, so the stage can fall through to pan", () => {
    const tracks = [track(0, box(0, 200))];

    expect(trackAtPoint(tracks, { x: 500, y: 100 })).toBeNull();
  });

  it("picks the NARROWEST containing box when two overlap", () => {
    // A page with stacked runs of the same column can produce nested boxes -
    // array order must not decide which one a click means.
    const wide = track(0, box(0, 1000));
    const narrow = track(1, box(400, 600));

    expect(trackAtPoint([wide, narrow], { x: 500, y: 10 })?.index).toBe(1);
    expect(trackAtPoint([narrow, wide], { x: 500, y: 10 })?.index).toBe(1);
  });

  it("respects the y range, not just x", () => {
    const tracks = [track(0, box(0, 200, 1000, 2000))];

    expect(trackAtPoint(tracks, { x: 100, y: 500 })).toBeNull();
    expect(trackAtPoint(tracks, { x: 100, y: 1500 })?.index).toBe(0);
  });
});

describe("preferredTrack", () => {
  // [margin][Track 0: GR/SP][DEPTHS][Track 1][Track 2][margin] - the layout
  // measured across the real corpus.
  const gr = track(0, box(60, 560));
  const resistivityA = track(1, box(620, 980));
  const resistivityB = track(2, box(980, 1340));
  const depthColumn = box(560, 620);

  it("prefers the track immediately left of the depth column", () => {
    const chosen = preferredTrack([resistivityB, gr, resistivityA], depthColumn);
    expect(chosen?.index).toBe(0);
  });

  it("is NOT the widest track", () => {
    // resistivityB is wider than gr - pins the exact mistake this function
    // exists to avoid.
    const wideResistivity = track(2, box(980, 2000));
    const chosen = preferredTrack([gr, resistivityA, wideResistivity], depthColumn);
    expect(chosen?.index).not.toBe(wideResistivity.index);
  });

  it("compares track CENTRES, not edges, against the depth column", () => {
    // A wobbling union box can genuinely overlap the depth column near the
    // page edges (observed on a real detection run) - an edge-adjacency test
    // would wrongly exclude the correct track here.
    const overlapping = track(0, box(560, 700)); // starts INSIDE the depth column
    const resistivity = track(1, box(900, 1200));

    expect(preferredTrack([overlapping, resistivity], depthColumn)?.index).toBe(0);
  });

  it("falls back to the leftmost track when there is no depth column", () => {
    const chosen = preferredTrack([resistivityA, gr, resistivityB], null);
    expect(chosen?.index).toBe(0);
  });

  it("falls back to the leftmost track when nothing sits left of the depth column", () => {
    const chosen = preferredTrack([resistivityA, resistivityB], depthColumn);
    expect(chosen?.index).toBe(resistivityA.index);
  });

  it("returns null for an empty track list", () => {
    expect(preferredTrack([], depthColumn)).toBeNull();
  });
});
