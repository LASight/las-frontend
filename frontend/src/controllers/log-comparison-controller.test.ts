import { describe, expect, it } from "vitest";
import type { WellReport } from "../models/analyze-models";
import { canLinkDepth, comparisonCurves, comparisonSeries, compatibleUnits, curveUnit, depthUnit, fullRange } from "./log-comparison-controller";

const well = (unit = "FT", values: Array<number | null> = [10, null, 30]) => ({
  well_name: "Fixture", file_name: "fixture.las", curve_map: { DEPT: "DEPTH", GR: "GAM" },
  curve_units: { DEPTH: unit, GAM: "GAPI" }, tracks: { depth: [100, 101, 102], raw: { GR: values } },
}) as unknown as WellReport;

describe("reported-depth log comparison; not geological correlation", () => {
  it("resolves source units through the saved mnemonic mapping", () => {
    expect(curveUnit(well(), "GR")).toBe("GAPI"); expect(depthUnit(well("feet"))).toBe("FT");
  });
  it("links only known matching depth units, without converting feet/metres", () => {
    expect(canLinkDepth([well(), well("F")])).toBe(true);
    expect(canLinkDepth([well(), well("M")])).toBe(false);
    expect(canLinkDepth([well(""), well("")])).toBe(false);
    expect(canLinkDepth([well("SECONDS"), well("SECONDS")])).toBe(false);
  });
  it("does not guess equivalence between unknown value units", () => {
    expect(compatibleUnits(["", ""])).toBe(false); expect(compatibleUnits(["GAPI", "API"])).toBe(false);
    expect(compatibleUnits([" gapi ", "GAPI"])).toBe(true);
  });
  it("keeps NULL breaks and every paired source row", () => {
    expect(comparisonSeries(well(), "GR")).toMatchObject({ x: [10, null, 30], y: [100, null, 102] });
  });
  it("does not connect values through missing depths or unequal array lengths", () => {
    const w = well(); w.tracks.depth = [100, null, 102, 103];
    expect(comparisonSeries(w, "GR").x).toEqual([10, null, 30, null]);
  });
  it("hides nonpositive values only in log display without modifying the source", () => {
    const w = well("FT", [0, -1, 20]);
    expect(comparisonSeries(w, "GR", true)).toMatchObject({ x: [null, null, 20], hiddenNonPositive: 2 });
    expect(w.tracks.raw?.GR).toEqual([0, -1, 20]); expect(comparisonSeries(w, "GR").x).toEqual([0, -1, 20]);
  });
  it("breaks rather than sorts or silently connects non-increasing depths", () => {
    const w = well("FT", [10, 20, 30]); w.tracks.depth = [100, 99, 101];
    expect(comparisonSeries(w, "GR")).toMatchObject({ x: [10, null, 20, 30], nonIncreasing: true });
  });
  it("uses the full finite extent, not percentiles that clip anomalies", () => {
    expect(fullRange([[0, 1, null, 10000], [-20]])).toEqual([-20, 10000]); expect(fullRange([[null]])).toBeUndefined();
  });
  it("offers actual curves, never absent or all-NULL families", () => {
    const w = well(); w.tracks.raw = { GR: [10], DT: [null], CUSTOM: [2] };
    expect(comparisonCurves([w])).toEqual(["GR", "CUSTOM"]);
  });
  it("warns about non-increasing source depth even where curve values are missing or hidden", () => {
    const w = well("FT", [null, 0, 30]); w.tracks.depth = [100, 99, 101];
    expect(comparisonSeries(w, "GR").nonIncreasing).toBe(true);
    expect(comparisonSeries(w, "GR", true).nonIncreasing).toBe(true);
  });
});
