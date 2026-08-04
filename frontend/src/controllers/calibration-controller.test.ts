import { describe, expect, it } from "vitest";

import {
  buildValueTicks,
  depthPerRow,
  depthToRow,
  pixelToValue,
  rowToDepth,
  validateCalibration,
  valueToPixel,
} from "./calibration-controller";
import type { TrackCalibration } from "../models/digitization-models";

/**
 * These pin the arithmetic the review canvas shows the operator.
 *
 * The numbers here deliberately match `ORION/tests/test_calibration.py`: the
 * browser previews a value and the backend writes a LAS, and if the two ever
 * disagree the reviewer approves one curve and ships a different one. Same
 * inputs, same expected outputs, both sides.
 */

const TRACK_WIDTH = 500;

function linear(overrides: Partial<TrackCalibration> = {}): TrackCalibration {
  return {
    value_min: 0,
    value_max: 150,
    depth_top: 1000,
    depth_bottom: 2000,
    scale: "linear",
    depth_unit: "FT",
    value_unit: "GAPI",
    mnemonic: "GR",
    ...overrides,
  };
}

function logarithmic(overrides: Partial<TrackCalibration> = {}): TrackCalibration {
  return linear({
    value_min: 0.2,
    value_max: 2000,
    scale: "log",
    value_unit: "OHMM",
    mnemonic: "RT",
    ...overrides,
  });
}

describe("linear value mapping", () => {
  it("maps the track edges to the printed scale endpoints", () => {
    const cal = linear();
    expect(pixelToValue(0, cal, TRACK_WIDTH)).toBeCloseTo(0, 10);
    expect(pixelToValue(250, cal, TRACK_WIDTH)).toBeCloseTo(75, 10);
    expect(pixelToValue(TRACK_WIDTH, cal, TRACK_WIDTH)).toBeCloseTo(150, 10);
  });

  it("inverts exactly", () => {
    const cal = linear();
    for (let x = 0; x <= TRACK_WIDTH; x += 17) {
      const value = pixelToValue(x, cal, TRACK_WIDTH);
      expect(valueToPixel(value as number, cal, TRACK_WIDTH)).toBeCloseTo(x, 9);
    }
  });

  it("supports a reversed scale", () => {
    const cal = linear({ value_min: 150, value_max: 0 });
    expect(pixelToValue(0, cal, TRACK_WIDTH)).toBeCloseTo(150, 10);
    expect(pixelToValue(TRACK_WIDTH, cal, TRACK_WIDTH)).toBeCloseTo(0, 10);
  });
});

describe("logarithmic value mapping", () => {
  it("maps the track edges to the printed scale endpoints", () => {
    const cal = logarithmic();
    expect(pixelToValue(0, cal, TRACK_WIDTH)).toBeCloseTo(0.2, 10);
    expect(pixelToValue(TRACK_WIDTH, cal, TRACK_WIDTH)).toBeCloseTo(2000, 6);
  });

  it("puts the geometric mean at the midpoint", () => {
    const cal = logarithmic();
    expect(pixelToValue(250, cal, TRACK_WIDTH)).toBeCloseTo(Math.sqrt(0.2 * 2000), 9);
  });

  it("inverts exactly", () => {
    const cal = logarithmic();
    for (let x = 0; x <= TRACK_WIDTH; x += 17) {
      const value = pixelToValue(x, cal, TRACK_WIDTH);
      expect(valueToPixel(value as number, cal, TRACK_WIDTH)).toBeCloseTo(x, 8);
    }
  });
});

describe("out-of-track positions", () => {
  it("clamps ink that bleeds past the scale edge", () => {
    // The stroke is centred on the sample, so a value sitting on the edge puts
    // ink a few columns outside the track. That means "at the edge", not
    // "beyond the scale".
    const cal = linear();
    expect(pixelToValue(-3, cal, TRACK_WIDTH)).toBeCloseTo(0, 10);
    expect(pixelToValue(TRACK_WIDTH + 3, cal, TRACK_WIDTH)).toBeCloseTo(150, 10);
  });

  it("extrapolates when clamping is off, for unwrapped over-scale positions", () => {
    const cal = linear();
    expect(pixelToValue(TRACK_WIDTH * 2, cal, TRACK_WIDTH, false)).toBeCloseTo(300, 10);
  });

  it("passes unrecovered rows through as null", () => {
    expect(pixelToValue(null, linear(), TRACK_WIDTH)).toBeNull();
  });

  it("returns null rather than Infinity for a zero-width track", () => {
    expect(pixelToValue(10, linear(), 0)).toBeNull();
  });
});

describe("depth mapping", () => {
  it("puts row 0 exactly at the top depth", () => {
    expect(rowToDepth(0, linear(), 1000)).toBeCloseTo(1000, 10);
  });

  it("uses the top-edge convention, so the last row is one step short", () => {
    const cal = linear();
    const step = depthPerRow(cal, 1000);
    expect(step).toBeCloseTo(1, 10);
    expect(rowToDepth(999, cal, 1000)).toBeCloseTo(cal.depth_bottom - step, 10);
  });

  it("inverts exactly", () => {
    const cal = linear();
    for (const row of [0, 1, 137, 999]) {
      expect(depthToRow(rowToDepth(row, cal, 1000), cal, 1000)).toBeCloseTo(row, 9);
    }
  });

  it("is strictly increasing downward", () => {
    const cal = linear();
    expect(rowToDepth(1, cal, 1000)).toBeGreaterThan(rowToDepth(0, cal, 1000));
  });
});

describe("validation", () => {
  it("accepts a well-formed calibration", () => {
    expect(validateCalibration(linear(), TRACK_WIDTH).isValid).toBe(true);
  });

  it("rejects a depth range that does not increase downward", () => {
    // The rule an interpretation suite enforces by refusing the whole file.
    const result = validateCalibration(
      linear({ depth_top: 2000, depth_bottom: 1000 }),
      TRACK_WIDTH
    );
    expect(result.isValid).toBe(false);
    expect(result.errors.depth_bottom).toMatch(/greater than top/i);
  });

  it("rejects a degenerate value range", () => {
    const result = validateCalibration(
      linear({ value_min: 50, value_max: 50 }),
      TRACK_WIDTH
    );
    expect(result.errors.value_max).toBeDefined();
  });

  it("rejects a log scale with a non-positive endpoint", () => {
    const result = validateCalibration(logarithmic({ value_min: 0 }), TRACK_WIDTH);
    expect(result.errors.value_min).toMatch(/strictly positive/i);
  });

  it("rejects a mnemonic containing a space", () => {
    const result = validateCalibration(linear({ mnemonic: "gamma ray" }), TRACK_WIDTH);
    expect(result.errors.mnemonic).toMatch(/spaces/i);
  });

  it("requires an explicit unit", () => {
    const result = validateCalibration(linear({ value_unit: "  " }), TRACK_WIDTH);
    expect(result.errors.value_unit).toBeDefined();
  });

  it("rejects a calibration with no track selected", () => {
    expect(validateCalibration(linear(), 0).isValid).toBe(false);
  });
});

describe("value axis ticks", () => {
  it("spans the track from the first tick to the last", () => {
    const ticks = buildValueTicks(linear(), TRACK_WIDTH, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0].x).toBeCloseTo(0, 10);
    expect(ticks[4].x).toBeCloseTo(TRACK_WIDTH, 10);
    expect(ticks[4].value).toBeCloseTo(150, 10);
  });

  it("spaces log ticks evenly in pixels, not in value", () => {
    // Evenly spaced *values* on a log axis bunch every tick against the left
    // edge, which is useless as an axis.
    const ticks = buildValueTicks(logarithmic(), TRACK_WIDTH, 5);
    const gaps = ticks.slice(1).map((tick, i) => tick.x - ticks[i].x);
    for (const gap of gaps) expect(gap).toBeCloseTo(TRACK_WIDTH / 4, 8);
    expect(ticks[1].value).toBeLessThan(ticks[2].value);
  });

  it("returns nothing for a zero-width track", () => {
    expect(buildValueTicks(linear(), 0)).toEqual([]);
  });
});
