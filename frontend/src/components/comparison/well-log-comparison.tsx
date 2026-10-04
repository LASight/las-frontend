import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ChartNoAxesCombined, Link2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { Layout, PlotHoverEvent, PlotRelayoutEvent } from "plotly.js";
import Plot from "react-plotly.js";

import { canLinkDepth, comparisonCurves, comparisonSeries, compatibleUnits, curveUnit, depthUnit, fullRange } from "../../controllers/log-comparison-controller";
import { GRID_COLOR, PLOT_CONFIG, PLOT_LAYOUT_BASE, RAW_CURVE_COLOR } from "../../controllers/plot-controller";
import type { WellReport } from "../../models/analyze-models";
import styles from "./well-log-comparison.module.css";

type Range = [number, number]; // top, bottom in reported depth; no datum conversion
type Props = { analysisId: string; wells: WellReport[] };
const HEIGHT = 700;
const TOP = 60;
const BOTTOM = 40;
const showNumber = (value: number) => Number(value.toPrecision(7)).toString();

export function WellLogComparison({ analysisId, wells }: Props) {
  const [selected, setSelected] = useState(() => wells.slice(0, 4).map((_, index) => index));
  const curves = useMemo(() => comparisonCurves(wells), [wells]);
  const [curve, setCurve] = useState(() => curves.includes("GR") ? "GR" : curves[0] ?? "");
  const [logarithmic, setLogarithmic] = useState(false);
  const [linkRequested, setLinkRequested] = useState(true);
  const [shareValues, setShareValues] = useState(true);
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeError, setRangeError] = useState("");
  const cursor = useRef<HTMLDivElement>(null);
  const cursorLabel = useRef<HTMLSpanElement>(null);
  const selectedWells = useMemo(() => selected.map(index => wells[index]), [wells, selected]);
  const depthCompatible = canLinkDepth(selectedWells);
  const linked = depthCompatible && linkRequested;
  const valueCompatible = compatibleUnits(selectedWells.map(well => curveUnit(well, curve)));
  const sharedValues = shareValues && valueCompatible;
  const series = useMemo(() => selectedWells.map(well => comparisonSeries(well, curve, logarithmic)), [selectedWells, curve, logarithmic]);
  const depthExtent = useMemo(() => fullRange(selectedWells.map(well => well.tracks?.depth ?? [])), [selectedWells]);
  const sharedRange = ranges.shared ?? depthExtent;
  const currentRange = useRef<Range | undefined>(sharedRange);
  currentRange.current = sharedRange;
  const hideCursor = () => { if (cursor.current) cursor.current.style.display = "none"; };

  useEffect(() => {
    hideCursor();
    setRanges({}); setFrom(""); setTo(""); setRangeError("");
  }, [analysisId, selected, curve, logarithmic, linked]);

  const layout = useMemo(() => {
    const result: Partial<Layout> & Record<string, unknown> = {
      ...PLOT_LAYOUT_BASE,
      height: HEIGHT,
      margin: { l: 62, r: 22, t: TOP, b: BOTTOM },
      showlegend: false, dragmode: "pan", hovermode: "closest",
      uirevision: `${analysisId}:${selected.join(",")}:${curve}:${logarithmic}:${linked}`,
      annotations: [],
    };
    const axisExtent = (items: Array<Array<number | null>>) => fullRange(logarithmic
      ? items.map(values => values.map(value => value !== null && value > 0 ? Math.log10(value) : null))
      : items);
    const rawValues = selectedWells.map(well => well.tracks?.raw?.[curve] ?? []);
    const valueExtent = axisExtent(rawValues);
    const annotations: Array<Record<string, unknown>> = [];
    selectedWells.forEach((well, column) => {
      const suffix = column === 0 ? "" : String(column + 1);
      const x = `x${suffix}`, y = `y${suffix}`;
      const gap = selected.length > 1 ? .045 : 0;
      const domain = [column / selected.length + (column ? gap / 2 : 0), (column + 1) / selected.length - (column < selected.length - 1 ? gap / 2 : 0)];
      const valueRange = sharedValues ? valueExtent : axisExtent([rawValues[column]]);
      const depthRange = linked ? sharedRange : ranges[String(selected[column])] ?? fullRange([well.tracks?.depth ?? []]);
      result[`xaxis${suffix}`] = {
        domain, anchor: y, side: "top", type: logarithmic ? "log" : "linear", fixedrange: true,
        range: valueRange, autorange: !valueRange, gridcolor: GRID_COLOR, zeroline: false,
        title: { text: `${well.curve_map?.[curve] || curve} · ${curveUnit(well, curve) || "unit unknown"}`, font: { size: 11 } },
        tickfont: { size: 10 }, showline: true, linecolor: GRID_COLOR,
      };
      result[`yaxis${suffix}`] = {
        domain: [0, 1], anchor: x, matches: linked && column > 0 ? "y" : undefined,
        range: depthRange ? [depthRange[1], depthRange[0]] : undefined,
        autorange: depthRange ? false : "reversed", gridcolor: GRID_COLOR, zeroline: false,
        title: { text: `Depth · ${depthUnit(well) || "unit unknown"}`, font: { size: 11 } },
        tickfont: { size: 10 }, showline: true, linecolor: GRID_COLOR,
      };
      if (!series[column].hasData) annotations.push({
        text: `No plottable ${curve} data`, x: (domain[0] + domain[1]) / 2, y: .5,
        xref: "paper", yref: "paper", showarrow: false, font: { color: "#c0c9d1", size: 12 },
      });
    });
    result.annotations = annotations as never;
    return result;
  }, [analysisId, selected, selectedWells, series, curve, logarithmic, linked, sharedValues, sharedRange, ranges]);

  const data = useMemo(() => series.map((item, column) => {
    const suffix = column === 0 ? "" : String(column + 1);
    const well = selectedWells[column];
    return {
      type: "scatter", mode: "lines", x: item.x, y: item.y,
      xaxis: `x${suffix}`, yaxis: `y${suffix}`, connectgaps: false,
      line: { color: RAW_CURVE_COLOR[curve] || "#89bfd1", width: 1, simplify: false },
      name: well.file_name || well.well_name,
      hovertemplate: `${well.curve_map?.[curve] || curve}: %{x} ${curveUnit(well, curve) || "unit unknown"}<br>Reported depth: %{y} ${depthUnit(well) || "unit unknown"}<extra></extra>`,
    };
  }), [series, selectedWells, curve]);

  function onRelayout(event: PlotRelayoutEvent) {
    const changes = event as unknown as Record<string, unknown>;
    const next: Record<string, Range> = {};
    selected.forEach((index, column) => {
      const axis = `yaxis${column === 0 ? "" : column + 1}`;
      const pair = changes[`${axis}.range`] as number[] | undefined;
      const a = pair?.[0] ?? changes[`${axis}.range[0]`];
      const b = pair?.[1] ?? changes[`${axis}.range[1]`];
      if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && a !== b) {
        const key = linked ? "shared" : String(index);
        next[key] = [Math.min(a, b), Math.max(a, b)];
      }
    });
    if (!Object.keys(next).length) return;
    hideCursor();
    setRanges(previous => Object.entries(next).every(([key, range]) => previous[key]?.[0] === range[0] && previous[key]?.[1] === range[1]) ? previous : { ...previous, ...next });
    if (next.shared) { setFrom(showNumber(next.shared[0])); setTo(showNumber(next.shared[1])); }
  }

  function onHover(event: PlotHoverEvent) {
    const depth = event.points[0]?.y, range = currentRange.current;
    if (!linked || !range || typeof depth !== "number" || !Number.isFinite(depth) || !cursor.current) return;
    const fraction = (depth - range[0]) / (range[1] - range[0]);
    if (fraction < 0 || fraction > 1) return hideCursor();
    cursor.current.style.display = "block";
    cursor.current.style.top = `${TOP + fraction * (HEIGHT - TOP - BOTTOM)}px`;
    if (cursorLabel.current) cursorLabel.current.textContent = `${showNumber(depth)} ${depthUnit(selectedWells[0])}`;
  }

  function applyRange() {
    const a = Number(from), b = Number(to);
    if (!from.trim() || !to.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a >= b) {
      setRangeError("Enter finite depths with From less than To."); return;
    }
    setRangeError(""); setRanges(previous => ({ ...previous, shared: [a, b] })); hideCursor();
  }

  function zoom(factor: number) {
    if (!sharedRange) return;
    const middle = (sharedRange[0] + sharedRange[1]) / 2;
    const half = (sharedRange[1] - sharedRange[0]) * factor / 2;
    const range: Range = [middle - half, middle + half];
    setRanges(previous => ({ ...previous, shared: range }));
    setFrom(showNumber(range[0])); setTo(showNumber(range[1])); hideCursor();
  }

  function valueRangeLabel(column: number) {
    const axis = layout[`xaxis${column === 0 ? "" : column + 1}`] as { range?: Range } | undefined;
    const range = axis?.range;
    if (!range) return "Value range · no finite values";
    return `Value range · ${range.map(value => showNumber(logarithmic ? 10 ** value : value)).join(" – ")}`;
  }

  return (
    <section className={styles.comparison} aria-label="Well log comparison">
      <div className={styles.heading}>
        <h2>Side-by-side well logs</h2>
        <span>{selected.length} of {wells.length} files displayed</span>
      </div>
      <p className={styles.disclaimer}>Reported-depth comparison, not stratigraphic correlation. No depth-datum alignment or formation matching is applied.</p>
      {wells.length < 2 && <p className={styles.notice}>This saved analysis contains one file, not multiple wells. Choose at least two LAS files to compare separate sources.</p>}
      <fieldset className={styles.wells}>
        <legend>Available wells · select up to 4 files</legend>
        {wells.map((well, index) => <label key={`${analysisId}:${index}`} title={well.file_name}>
          <input type="checkbox" checked={selected.includes(index)} disabled={!selected.includes(index) && selected.length >= 4}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, index].sort((a, b) => a - b) : previous.filter(id => id !== index))} />
          <span>{well.well_name || "Unnamed well"}<small>{well.file_name || `Source file ${index + 1}`}</small></span>
        </label>)}
      </fieldset>
      <div className={styles.toolbar}>
        <label><ChartNoAxesCombined size={15} /> Curve
          <select aria-label="Comparison curve" value={curve} disabled={!curves.length} onChange={event => setCurve(event.target.value)}>
            {!curves.length && <option value="">No raw curves available</option>}
            {curves.map(key => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <label>Value scale <select aria-label="Value scale" value={logarithmic ? "log" : "linear"} onChange={event => setLogarithmic(event.target.value === "log")}>
          <option value="linear">Linear</option><option value="log">Logarithmic</option>
        </select></label>
        <label><input type="checkbox" checked={linked} disabled={!depthCompatible} onChange={event => setLinkRequested(event.target.checked)} /><Link2 size={15} /> Link depth</label>
        <label><input type="checkbox" checked={sharedValues} disabled={!valueCompatible} onChange={event => setShareValues(event.target.checked)} /><ArrowDownUp size={15} /> Share value scale</label>
      </div>
      {!depthCompatible && selected.length > 0 && <p className={styles.notice}>Depth axes are independent: recorded depth units are unknown or incompatible. No unit conversion is applied.</p>}
      {!valueCompatible && selected.length > 0 && <p className={styles.note}>Value scales are independent: curve units are unknown or different (API and GAPI are not assumed equivalent).</p>}
      <div className={styles.toolbar}>
        <label>From <input aria-label="Depth from" type="number" step="any" value={from} placeholder={sharedRange ? showNumber(sharedRange[0]) : "Depth"} disabled={!linked} onChange={event => setFrom(event.target.value)} /></label>
        <label>To <input aria-label="Depth to" type="number" step="any" value={to} placeholder={sharedRange ? showNumber(sharedRange[1]) : "Depth"} disabled={!linked} onChange={event => setTo(event.target.value)} /></label>
        <button type="button" disabled={!linked} onClick={applyRange}><ArrowDownUp size={15} /> Apply depth range</button>
        <button type="button" disabled={!linked || !sharedRange} onClick={() => zoom(.5)}><ZoomIn size={15} /> Zoom in</button>
        <button type="button" disabled={!linked || !sharedRange} onClick={() => zoom(2)}><ZoomOut size={15} /> Zoom out</button>
        <button type="button" onClick={() => { setRanges({}); setFrom(""); setTo(""); setRangeError(""); hideCursor(); }}><RotateCcw size={15} /> Reset depth</button>
      </div>
      {rangeError && <p role="alert" className={styles.notice}>{rangeError}</p>}
      <p className={styles.note}>Drag vertically to pan {linked ? "all linked tracks" : "each track independently"}; use the Plotly toolbar to box-zoom. Wheel zoom is disabled so the page can scroll. Source values are not normalized.</p>
      {selected.length === 0 ? <p className={styles.notice}>Select a source file above to display its log.</p> : <div className={styles.scroll}>
        <div className={styles.trackArea} style={{ minWidth: `${selected.length * 270}px` }}>
          <div className={styles.headers} style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(0, 1fr))` }}>
            {selectedWells.map((well, column) => <div className={styles.wellHeader} key={selected[column]}>
              <strong>{well.well_name || "Unnamed well"}</strong><span>{well.file_name || `Source file ${selected[column] + 1}`}</span>
              <span>{curve} → {well.curve_map?.[curve] || curve} · {curveUnit(well, curve) || "unit unknown"} · {logarithmic ? "log" : "linear"}</span>
              <span>{valueRangeLabel(column)}</span>
              <span>Reported depth · {depthUnit(well) || "unit unknown"}</span>
              {series[column].nonIncreasing && <small>Non-increasing depth: line breaks inserted; source order retained.</small>}
              {series[column].hiddenNonPositive > 0 && <small>{series[column].hiddenNonPositive} nonpositive values hidden in log display only.</small>}
              {!series[column].hasData && <small>No plottable {curve} data in this file.</small>}
            </div>)}
          </div>
          <div className={styles.plotWrap}>
            <Plot data={data as never} layout={layout} config={{ ...PLOT_CONFIG, scrollZoom: false }}
              style={{ width: "100%", height: `${HEIGHT}px` }} useResizeHandler
              onRelayout={onRelayout} onHover={onHover} onUnhover={hideCursor} />
            <div ref={cursor} className={styles.cursor} aria-hidden="true"><span ref={cursorLabel} /></div>
          </div>
        </div>
      </div>}
    </section>
  );
}
