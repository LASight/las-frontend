import type { WellReport } from "../models/analyze-models";

export function curveUnit(well: WellReport, curve: string): string {
  const actual = well.curve_map?.[curve] || curve;
  return Object.entries(well.curve_units ?? {}).find(([key]) => key.toUpperCase() === actual.toUpperCase())?.[1]?.trim() ?? "";
}

/** Label aliases only. No numerical conversions or inferred depth datums. */
export function depthUnit(well: WellReport): string {
  const unit = curveUnit(well, "DEPT").toUpperCase();
  if (["FT", "F", "FEET", "FOOT"].includes(unit)) return "FT";
  if (["M", "METRE", "METRES", "METER", "METERS"].includes(unit)) return "M";
  return unit;
}

export function compatibleUnits(units: string[]): boolean {
  const normalized = units.map((unit) => unit.trim().toUpperCase());
  return normalized.length > 0 && normalized.every((unit) => !!unit && unit === normalized[0]);
}

export function canLinkDepth(wells: WellReport[]): boolean {
  return wells.length > 0 && wells.every((well) => ["FT", "M"].includes(depthUnit(well))) && compatibleUnits(wells.map(depthUnit));
}

export function comparisonSeries(well: WellReport, curve: string, logarithmic = false) {
  const depth = well.tracks?.depth ?? [];
  const values = well.tracks?.raw?.[curve] ?? [];
  const x: Array<number | null> = [];
  const y: Array<number | null> = [];
  let previous: number | null = null;
  let previousDepth: number | null = null;
  let hiddenNonPositive = 0;
  let nonIncreasing = false;
  for (let row = 0; row < depth.length; row++) {
    const d = depth[row], v = values[row];
    if (typeof d === "number" && Number.isFinite(d)) {
      if (previousDepth !== null && d <= previousDepth) nonIncreasing = true;
      previousDepth = d;
    }
    if (typeof d !== "number" || !Number.isFinite(d) || typeof v !== "number" || !Number.isFinite(v)) {
      x.push(null); y.push(null); previous = null; continue;
    }
    if (logarithmic && v <= 0) {
      hiddenNonPositive++; x.push(null); y.push(null); previous = null; continue;
    }
    if (previous !== null && d <= previous) {
      nonIncreasing = true; x.push(null); y.push(null);
    }
    x.push(v); y.push(d); previous = d;
  }
  return { x, y, hiddenNonPositive, nonIncreasing, hasData: x.some((value) => value !== null) };
}

export function fullRange(series: Array<Array<number | null>>): [number, number] | undefined {
  let min = Infinity, max = -Infinity;
  for (const values of series) for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  if (!Number.isFinite(min)) return undefined;
  if (min === max) return [min - .5, max + .5];
  return [min, max];
}

export function comparisonCurves(wells: WellReport[]): string[] {
  const keys = new Set<string>();
  for (const well of wells) for (const [key, values] of Object.entries(well.tracks?.raw ?? {})) {
    if (values.some((value) => typeof value === "number" && Number.isFinite(value))) keys.add(key);
  }
  const preferred = ["GR", "RHOB", "NPHI", "DT", "RESD", "SP", "CALI"];
  return [...keys].sort((a, b) => (preferred.indexOf(a) < 0 ? 99 : preferred.indexOf(a)) - (preferred.indexOf(b) < 0 ? 99 : preferred.indexOf(b)) || a.localeCompare(b));
}
