import {
  GRID_COLOR,
  hasNumericData,
  normalizeSeries,
  PLOT_LAYOUT_BASE,
} from "../../controllers/plot-controller";
import type { WellReport } from "../../models/analyze-models";
import layout from "../layout.module.css";
import { PlotCard } from "../plot-card";
import { PlotFigure } from "../plot-figure";

type Props = {
  well: WellReport;
};

export function DerivedPlots({ well }: Props) {
  const depth = well.tracks?.depth || [];
  const derived = well.tracks?.derived || {};
  const geophysics = well.tracks?.geophysics || {};
  const geoDepth = geophysics.depth || depth;
  const velocity = geophysics.velocity_ft_s || [];
  const density = geophysics.density_g_cc || [];
  const aiProxy = geophysics.ai_proxy || [];
  const reflectivity = geophysics.reflectivity || [];
  const somBmu = well.tracks?.som_bmu || [];

  const derivedTraces: Array<Record<string, unknown>> = [];
  if (hasNumericData((derived.vsh || []) as Array<number | null | undefined>)) {
    derivedTraces.push({
      x: derived.vsh,
      y: depth,
      type: "scatter",
      mode: "lines",
      name: "Vsh",
      line: { color: "#8b6914", width: 2 },        // dark amber-brown = shale/clay earthy tone
      fill: "tozerox",
      fillcolor: "rgba(139,105,20,0.22)",
    });
  }
  if (hasNumericData((derived.phi || []) as Array<number | null | undefined>)) {
    derivedTraces.push({
      x: derived.phi,
      y: depth,
      type: "scatter",
      mode: "lines",
      name: "Phi",
      line: { color: "#1e7a4a", width: 2 },        // deep green = reservoir quality
      fill: "tozerox",
      fillcolor: "rgba(30,122,74,0.20)",
    });
  }
  if (hasNumericData((derived.sw || []) as Array<number | null | undefined>)) {
    derivedTraces.push({
      x: derived.sw,
      y: depth,
      type: "scatter",
      mode: "lines",
      name: "Sw",
      line: { color: "#1557a0", width: 2 },        // deep blue = water saturation (universal convention)
      fill: "tozerox",
      fillcolor: "rgba(21,87,160,0.18)",
    });
  }

  const geoTraces: Array<Record<string, unknown>> = [];
  if (hasNumericData(velocity as Array<number | null | undefined>)) {
    geoTraces.push({
      x: normalizeSeries(velocity),
      y: geoDepth,
      type: "scatter",
      mode: "lines",
      name: "Velocity (norm)",
      line: { color: "#1a5ea8", width: 1.9 },      // steel blue — acoustic/velocity convention
    });
  }
  if (hasNumericData(density as Array<number | null | undefined>)) {
    geoTraces.push({
      x: normalizeSeries(density),
      y: geoDepth,
      type: "scatter",
      mode: "lines",
      name: "Density (norm)",
      line: { color: "#b8510c", width: 1.8 },      // burnt orange — aligns with RHOB convention
    });
  }
  if (hasNumericData(aiProxy as Array<number | null | undefined>)) {
    geoTraces.push({
      x: normalizeSeries(aiProxy),
      y: geoDepth,
      type: "scatter",
      mode: "lines",
      name: "AI proxy (norm)",
      line: { color: "#6b3fa0", width: 1.8 },      // purple — computed/ML-derived; breaks gold collision
    });
  }
  if (hasNumericData(reflectivity as Array<number | null | undefined>)) {
    geoTraces.push({
      x: reflectivity,
      y: geoDepth,
      type: "scatter",
      mode: "lines",
      name: "Reflectivity",
      xaxis: "x2",
      line: { color: "#b03060", width: 1.5 },      // dark rose — distinct; deeper for light-bg visibility
    });
  }

  const som = well.ml?.som || {};
  const hasSomMatrix = som.status === "ok" && Array.isArray(som.u_matrix) && som.u_matrix.length > 0;
  const hasSomBmu = hasNumericData(somBmu as Array<number | null | undefined>) && depth.length > 0;

  return (
    <div className={layout.gridTwo}>
      <PlotCard title="Derived Petrophysical Response">
        <PlotFigure
          data={derivedTraces}
          height={420}
          hasData={derivedTraces.length > 0}
          emptyMessage="No derived petrophysical curves available."
          layout={{
            ...PLOT_LAYOUT_BASE,
            margin: { l: 60, r: 28, t: 38, b: 35 },
            xaxis: { title: "Value", range: [0, 1], gridcolor: GRID_COLOR },
            yaxis: { title: "Depth", autorange: "reversed", gridcolor: GRID_COLOR },
            legend: { orientation: "h" },
          }}
        />
      </PlotCard>

      <PlotCard title="Geophysics Quicklook: Velocity / Density / AI / Reflectivity">
        <PlotFigure
          data={geoTraces}
          height={420}
          hasData={geoTraces.length > 0}
          emptyMessage="Geophysics quicklook requires DT data."
          layout={{
            ...PLOT_LAYOUT_BASE,
            margin: { l: 60, r: 50, t: 38, b: 35 },
            xaxis: {
              title: "Normalized Velocity / Density / AI",
              range: [0, 1],
              gridcolor: GRID_COLOR,
            },
            xaxis2: {
              title: "Reflectivity",
              overlaying: "x",
              side: "top",
              range: [-0.25, 0.25],
              showgrid: false,
              tickfont: { color: "#b03060" },
            },
            yaxis: { title: "Depth", autorange: "reversed", gridcolor: GRID_COLOR },
            legend: { orientation: "h" },
          }}
        />
      </PlotCard>

      <PlotCard title="SOM U-Matrix + Node Hits">
        <PlotFigure
          height={420}
          hasData={hasSomMatrix}
          emptyMessage="SOM map unavailable."
          data={[
            {
              type: "heatmap",
              z: som.u_matrix,
              colorscale: "Cividis",
              colorbar: { title: "U-Matrix" },
              hovertemplate: "Row %{y}, Col %{x}<br>U: %{z:.4f}<extra></extra>",
            },
            {
              type: "scatter",
              mode: "markers",
              x: (som.node_hits || []).flatMap((row) => row.map((_hit, colIdx) => colIdx)),
              y: (som.node_hits || []).flatMap((row, rowIdx) => row.map(() => rowIdx)),
              marker: {
                size: (som.node_hits || []).flatMap((row) => row.map((hit) => Math.max(8, 8 + (hit || 0) * 0.7))),
                color: "rgba(255,255,255,0.25)",
                line: { color: "rgba(30,37,51,0.25)", width: 0.6 },
              },
              text: (som.node_hits || []).flatMap((row, rowIdx) =>
                row.map((hit, colIdx) => `Node (${rowIdx},${colIdx}) hits: ${hit || 0}`)
              ),
              hovertemplate: "%{text}<extra></extra>",
              showlegend: false,
            },
          ]}
          layout={{
            ...PLOT_LAYOUT_BASE,
            margin: { l: 55, r: 24, t: 38, b: 45 },
            xaxis: { title: "SOM Col", dtick: 1 },
            yaxis: { title: "SOM Row", dtick: 1, autorange: "reversed" },
          }}
        />
      </PlotCard>

      <PlotCard title="SOM Facies Track (Depth vs BMU)">
        <PlotFigure
          height={420}
          hasData={hasSomBmu}
          emptyMessage="SOM facies track unavailable."
          data={[
            {
              type: "scatter",
              mode: "markers",
              x: somBmu,
              y: depth,
              marker: {
                size: 6,
                color: somBmu,
                colorscale: "Viridis",
                showscale: true,
                colorbar: { title: "BMU" },
              },
              hovertemplate: "Depth %{y}<br>SOM BMU %{x}<extra></extra>",
              name: "SOM BMU",
            },
          ]}
          layout={{
            ...PLOT_LAYOUT_BASE,
            margin: { l: 60, r: 54, t: 38, b: 35 },
            xaxis: { title: "BMU Node Index", gridcolor: GRID_COLOR },
            yaxis: { title: "Depth", autorange: "reversed", gridcolor: GRID_COLOR },
          }}
        />
      </PlotCard>
    </div>
  );
}
