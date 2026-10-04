import { describe, expect, it } from "vitest";
import { CURVE_METADATA, curveMetadata, searchMetadata } from "./curve-metadata-controller";
import { validateCalibration } from "./calibration-controller";
import { DEFAULT_CALIBRATION } from "../models/digitization-models";

describe("declared curve metadata suggestions", () => {
  it("searches readable family names and specific mnemonic codes", () => {
    expect(searchMetadata(CURVE_METADATA, "density").map((choice) => choice.value)).toEqual(["RHOB"]);
    expect(searchMetadata(CURVE_METADATA, "lld").map((choice) => choice.value)).toEqual(["LLD"]);
    expect(searchMetadata(CURVE_METADATA, "resistivity").length).toBeGreaterThan(3);
  });
  it("recommends units only, without setting scale, depth or changing source aliases", () => {
    expect(curveMetadata("gr")?.units.map((choice) => choice.value)).toContain("GAPI");
    expect(curveMetadata("GR_ARCHIVE")).toBeUndefined();
    expect(curveMetadata("RHOB")?.units.map((choice) => choice.value)).toContain("G/CC");
    expect(Object.keys(curveMetadata("GR")!)).toEqual(["value", "label", "units"]);
  });
  it("does not impose a closed mnemonic/unit whitelist or weaken existing format validation", () => {
    expect(validateCalibration({ ...DEFAULT_CALIBRATION, mnemonic: "GR_ARCHIVE", value_unit: "OLD_UNIT" }, 500).isValid).toBe(true);
    expect(validateCalibration({ ...DEFAULT_CALIBRATION, mnemonic: "GR ARCHIVE" }, 500).isValid).toBe(false);
  });
});
