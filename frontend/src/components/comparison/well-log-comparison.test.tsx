import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WellReport } from "../../models/analyze-models";
import { WellLogComparison } from "./well-log-comparison";

type PlotProps = {
  data: Array<{ x: Array<number | null>; y: Array<number | null>; connectgaps: boolean }>;
  layout: Record<string, unknown>;
  config: Record<string, unknown>;
  onRelayout: (event: Record<string, unknown>) => void;
  onHover: (event: { points: Array<{ y: number }> }) => void;
  onUnhover: () => void;
};
const plot = vi.hoisted(() => ({ props: null as PlotProps | null, renders: 0 }));
vi.mock("react-plotly.js", () => ({ default: (props: PlotProps) => { plot.props = props; plot.renders++; return <div data-testid="plot" />; } }));

function well(file = "one.las", depth = "FT", unit = "GAPI", values: Array<number | null> = [10, null, 10000]): WellReport {
  return { well_name: "Duplicate name", file_name: file, api: "", n_rows: 3, las_version: "2.0", curve_map: { DEPT: "DEPTH", GR: "GAM" },
    curve_units: { DEPTH: depth, GAM: unit }, tracks: { depth: [100, 101, 102], raw: { GR: values } },
  } as WellReport;
}

describe("manual side-by-side logs", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); plot.props = null; plot.renders = 0;
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const props = () => plot.props!;
  const axis = (name: string) => props().layout[name] as Record<string, unknown>;
  async function render(wells = [well(), well("two.las")]) { await act(async () => root.render(<WellLogComparison analysisId="fixture" wells={wells} />)); }
  async function click(text: string) {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
    expect(button).toBeDefined(); await act(async () => button.click());
  }
  async function checkbox(text: string) {
    const input = [...host.querySelectorAll("label")].find(item => item.textContent?.includes(text))!.querySelector("input")!;
    await act(async () => input.click());
  }
  async function choose(label: string, value: string) {
    const select = host.querySelector(`select[aria-label="${label}"]`)! as HTMLSelectElement;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  async function number(label: string, value: string) {
    const input = host.querySelector(`input[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("keeps full raw series, NULL breaks and real mnemonic/units without clipping spikes", async () => {
    const wells = [well(), well("two.las")], original = JSON.stringify(wells);
    await render(wells);
    expect(props().data[0]).toMatchObject({ x: [10, null, 10000], y: [100, null, 102], connectgaps: false });
    expect(axis("xaxis").range).toEqual([10, 10000]);
    expect(host.textContent).toContain("GR → GAM · GAPI"); expect(host.textContent).toContain("Reported depth · FT");
    expect(props().config.scrollZoom).toBe(false); expect(JSON.stringify(wells)).toBe(original);
  });

  it("caps initial selection at four files and identifies duplicate names by filename", async () => {
    await render(Array.from({ length: 5 }, (_, index) => well(`${index}.las`)));
    expect(props().data).toHaveLength(4);
    const inputs = host.querySelectorAll("fieldset input") as NodeListOf<HTMLInputElement>;
    expect(inputs[4].disabled).toBe(true); expect(host.textContent).toContain("4 of 5 files displayed");
    await act(async () => inputs[0].click()); expect(inputs[4].disabled).toBe(false);
    await act(async () => inputs[4].click()); expect(props().data).toHaveLength(4);
    expect(host.textContent).toContain("4.las");
  });

  it("links known compatible reported-depth units, and supports unlinking", async () => {
    await render([well(), well("two.las", "feet")]);
    expect(axis("yaxis2").matches).toBe("y");
    await checkbox("Link depth"); expect(axis("yaxis2").matches).toBeUndefined();
    expect((host.querySelector('[aria-label="Depth from"]') as HTMLInputElement).disabled).toBe(true);
    await checkbox("Link depth"); expect(axis("yaxis2").matches).toBe("y");
  });

  it.each(["M", "", "SECONDS"])("keeps depth axes independent for incompatible/unknown %s units", async unit => {
    const second = well("two.las", unit); second.tracks.depth = [30, 31, 32];
    await render([well(), second]);
    expect(axis("yaxis2").matches).toBeUndefined();
    expect(axis("yaxis").range).toEqual([102, 100]); expect(axis("yaxis2").range).toEqual([32, 30]);
    expect(host.textContent).toContain("Depth axes are independent");
    const input = [...host.querySelectorAll("label")].find(item => item.textContent?.includes("Link depth"))!.querySelector("input")!;
    expect(input.disabled).toBe(true); expect(input.checked).toBe(false);
    await act(async () => props().onHover({ points: [{ y: 100 }] }));
    expect(host.querySelector('div[aria-hidden="true"]')?.getAttribute("style") || "").not.toContain("display: block");
    await act(async () => props().onRelayout({ "yaxis2.range[0]": 31.5, "yaxis2.range[1]": 30.5 }));
    expect(axis("yaxis2").range).toEqual([31.5, 30.5]); expect(axis("yaxis").range).toEqual([102, 100]);
  });

  it("does not equate API and GAPI or share unknown value scales", async () => {
    await render([well(), well("two.las", "FT", "API", [2, 3, 4])]);
    expect(axis("xaxis").range).toEqual([10, 10000]); expect(axis("xaxis2").range).toEqual([2, 4]);
    expect(host.textContent).toContain("API and GAPI are not assumed equivalent");
    const input = [...host.querySelectorAll("label")].find(item => item.textContent?.includes("Share value scale"))!.querySelector("input")!;
    expect(input.disabled).toBe(true);
  });

  it("lets matching recorded curve units share or independently display full source extents", async () => {
    await render([well(), well("two.las", "FT", "GAPI", [2, 3, 4])]);
    expect(axis("xaxis").range).toEqual([2, 10000]); expect(axis("xaxis2").range).toEqual([2, 10000]);
    await checkbox("Share value scale");
    expect(axis("xaxis").range).toEqual([10, 10000]); expect(axis("xaxis2").range).toEqual([2, 4]);
    expect(host.textContent).toContain("Value range · 10 – 10000");
  });

  it("uses the first real family without fabricating GR and includes finite unpaired source spikes in the axis extent", async () => {
    const source = well(); source.tracks.depth = [100, null, 102]; source.tracks.raw = { CUSTOM: [1, 9999, 3] };
    await render([source]);
    expect((host.querySelector('[aria-label="Comparison curve"]') as HTMLSelectElement).value).toBe("CUSTOM");
    expect(props().data[0].x).toEqual([1, null, 3]); expect(axis("xaxis").range).toEqual([1, 9999]);
    expect(host.textContent).toContain("Value range · 1 – 9999");
  });

  it("offers custom raw curves and leaves a column empty when that curve is missing", async () => {
    const first = well(); first.tracks.raw!.CUSTOM = [7, 8, 9]; first.curve_units!.CUSTOM = "mV";
    await render([first, well("two.las")]);
    await choose("Comparison curve", "CUSTOM");
    expect(props().data[0].x).toEqual([7, 8, 9]); expect(props().data[1].x).toEqual([null, null, null]);
    expect(host.textContent).toContain("No plottable CUSTOM data in this file.");
    expect(host.textContent).toContain("CUSTOM → CUSTOM · mV"); expect(host.textContent).toContain("unit unknown");
  });

  it("hides nonpositive values only in logarithmic display and restores untouched linear values", async () => {
    const source = well("one.las", "FT", "GAPI", [0, -1, .1]);
    await render([source, well("two.las", "FT", "GAPI", [.1, .1, .1])]);
    await choose("Value scale", "log");
    expect(props().data[0].x).toEqual([null, null, .1]);
    expect(axis("xaxis").range).toEqual([-1.5, -.5]);
    expect(host.textContent).toContain("2 nonpositive values hidden in log display only");
    expect(source.tracks.raw!.GR).toEqual([0, -1, .1]);
    await choose("Value scale", "linear"); expect(props().data[0].x).toEqual([0, -1, .1]);
  });

  it("breaks at non-increasing depth without reordering source rows", async () => {
    const source = well("one.las", "FT", "GAPI", [10, 20, 30]); source.tracks.depth = [100, 99, 101];
    await render([source, well("two.las")]);
    expect(props().data[0].x).toEqual([10, null, 20, 30]);
    expect(host.textContent).toContain("Non-increasing depth"); expect(source.tracks.depth).toEqual([100, 99, 101]);
  });

  it("validates range controls, captures panning, zooms and resets the full reported-depth extent", async () => {
    await render(); await click("Apply depth range"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("finite depths");
    await number("Depth from", "100.25"); await number("Depth to", "101.75"); await click("Apply depth range");
    expect(axis("yaxis").range).toEqual([101.75, 100.25]); expect(axis("yaxis2").range).toEqual([101.75, 100.25]);
    await click("Zoom in"); expect(axis("yaxis").range).toEqual([101.375, 100.625]);
    await act(async () => props().onRelayout({ "yaxis.range[0]": 101.5, "yaxis.range[1]": 100.5 }));
    expect(axis("yaxis2").range).toEqual([101.5, 100.5]);
    await act(async () => props().onRelayout({ "yaxis.range[0]": Infinity, "yaxis.range[1]": NaN }));
    expect(axis("yaxis2").range).toEqual([101.5, 100.5]);
    await click("Reset depth"); expect(axis("yaxis").range).toEqual([102, 100]);
  });

  it("draws a linked horizontal depth cursor without rerendering the Plotly layout", async () => {
    await render(); const layout = props().layout, count = plot.renders;
    await act(async () => props().onHover({ points: [{ y: 101 }] }));
    expect(plot.renders).toBe(count); expect(props().layout).toBe(layout);
    expect(host.textContent).toContain("101 FT");
    const cursor = host.querySelector('div[aria-hidden="true"]') as HTMLDivElement;
    expect(cursor.style.display).toBe("block"); expect(cursor.style.top).toBe("360px");
    await act(async () => props().onUnhover()); expect(cursor.style.display).toBe("none");
  });

  it("does not duplicate a single saved file as multiple wells and allows zero selection", async () => {
    await render([well()]); expect(props().data).toHaveLength(1); expect(host.textContent).toContain("one file, not multiple wells");
    await act(async () => (host.querySelector("fieldset input") as HTMLInputElement).click());
    expect(host.querySelector('[data-testid="plot"]')).toBeNull(); expect(host.textContent).toContain("Select a source file");
  });
});
