import type { Layout } from "plotly.js";

export const PLOT_LAYOUT_BASE: Partial<Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "#f8f9fa",
  font: { color: "#1e2533", family: "Space Grotesk, sans-serif" },
  margin: { l: 55, r: 25, t: 38, b: 45 },
};

/** Shared Plotly config — no logo, responsive resize. */
export const PLOT_CONFIG = { displaylogo: false, responsive: true } as const;

/** Grid line color used across every axis for light-background legibility. */
export const GRID_COLOR = "rgba(30,37,51,0.11)";

export const RAW_CURVE_ORDER = ["GR", "DT", "RESD", "SP", "RHOB", "NPHI"];

// Colors follow loose industry conventions: GR=dark-green, NPHI=blue, RHOB=warm-orange,
// RESD=sienna, DT=purple, SP=olive. All chosen for light-background legibility.
export const RAW_CURVE_COLOR: Record<string, string> = {
  GR:   "#2d6a4f", // deep forest green  — GR is conventionally dark; green is standard in many platforms
  DT:   "#6b3fa0", // medium purple       — sonic, distinct from NPHI blue and resistivity
  RESD: "#9e3a1a", // brick sienna        — resistivity brown-red per Techlog/IP convention
  SP:   "#5c6e22", // olive               — SP is GR-track companion; earthy tone
  RHOB: "#b8510c", // burnt orange        — density warm-orange per universal Archie convention
  NPHI: "#1a5ea8", // steel blue          — neutron porosity blue is a universal well-log standard
};

// Traffic-light convention: green=best, amber=caution, gray=low, red=risk
export const QUADRANT_COLORS: Record<string, string> = {
  "Prime Target":              "#1a9850", // forest green
  "Balanced Opportunity":      "#f39c12", // amber
  "Low Upside / Low Risk":     "#7f8c8d", // slate gray
  "High-Risk / Needs Review":  "#c0392b", // muted red
};

export const SEQ_TRACT_COLOR: Record<string, string> = {
  // Opacity raised to 0.34 — fills at 0.20 on a light background are near-invisible
  "Progradation - Regression":     "rgba(185, 78,  62, 0.34)", // muted warm red  — regressive / falling
  "Retrogradation - Transgression":"rgba( 52,107, 186, 0.34)", // steel blue      — transgressive / rising
  "Steady Aggradation":            "rgba( 72,155,  86, 0.34)", // forest green     — aggradation / equilibrium
  UNDEF:                           "rgba(130,130, 130, 0.12)", // neutral gray     — unclassified, deliberately subtle
};

export function hasNumericData(values: Array<number | null | undefined>): boolean {
  return values.some((value) => typeof value === "number" && Number.isFinite(value));
}

export function numericValues(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function axisRangeFromSeries(
  series: Array<number | null | undefined>,
  lowerQ = 0.02,
  upperQ = 0.98
): [number, number] | null {
  const values = numericValues(series);
  if (!values.length) return null;
  const low = quantile(values, lowerQ);
  const high = quantile(values, upperQ);
  if (low === null || high === null) return null;
  if (high <= low) return [low - 1, high + 1];
  const pad = (high - low) * 0.04;
  return [low - pad, high + pad];
}

export function normalizeSeries(values: Array<number | null | undefined>): Array<number | null> {
  const filtered = numericValues(values);
  if (!filtered.length) return values.map(() => null);
  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  const den = max - min || 1;
  return values.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? (value - min) / den : null
  );
}
