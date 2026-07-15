import { fmt } from "../../controllers/format-controller";
import { GRID_COLOR, PLOT_LAYOUT_BASE, QUADRANT_COLORS } from "../../controllers/plot-controller";
import type { PortfolioAnalytics } from "../../models/analyze-models";
import layout from "../layout.module.css";
import { PlotCard } from "../plot-card";
import { PlotFigure } from "../plot-figure";
import { SectionPanel } from "../section-panel";

type Props = {
  analytics: PortfolioAnalytics;
};

export function CrossWellAnalytics({ analytics }: Props) {
  const { well_ranking, facies_similarity, pay_risk_matrix, geophysics_crossplot, som_quality } = analytics;

  return (
    <SectionPanel title="Cross-Well Analytics">
      <div className={layout.gridTwo}>
        <PlotCard title="Well Ranking">
          <PlotFigure
            height={350}
            hasData={well_ranking.length > 0}
            emptyMessage="No ranking data available."
            data={[
              {
                type: "bar",
                orientation: "h",
                y: well_ranking.map((row) => `${row.rank}. ${row.well_name}`),
                x: well_ranking.map((row) => row.composite_score),
                marker: {
                  color: well_ranking.map((row) => row.composite_score),
                  // Traffic-light: low=red, mid=amber, high=green — universal quality convention
                  colorscale: [
                    [0.0, "#d73027"],
                    [0.5, "#fee08b"],
                    [1.0, "#1a9850"],
                  ],
                },
                text: well_ranking.map((row) => fmt(row.composite_score, 2)),
                textposition: "inside",
                hovertemplate: "%{y}<br>Composite score: %{x:.2f}<extra></extra>",
              },
            ]}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 140, r: 24, t: 24, b: 35 },
              xaxis: { title: "Composite Score", gridcolor: GRID_COLOR },
              yaxis: { autorange: "reversed" },
            }}
          />
        </PlotCard>

        <PlotCard
          title="Facies Similarity"
          meta={
            facies_similarity.value_interpretation
              ? `${facies_similarity.method || "Similarity"} | ${facies_similarity.value_interpretation}`
              : ""
          }
        >
          <PlotFigure
            height={360}
            hasData={facies_similarity.labels.length > 0 && facies_similarity.matrix.length > 0}
            emptyMessage="No facies similarity data available."
            data={[
              {
                type: "heatmap",
                z: facies_similarity.matrix,
                x: facies_similarity.labels,
                y: facies_similarity.labels,
                zmid: 0,
                zmin: -1,
                zmax: 1,
                // Diverging RdBu: light midpoint = zero correlation; works on white bg
                colorscale: [
                  [0.0, "#b2182b"],
                  [0.5, "#f7f7f7"],
                  [1.0, "#2166ac"],
                ],
                hovertemplate: "<b>%{x}</b> vs <b>%{y}</b><br>Similarity: %{z:.3f}<extra></extra>",
              },
            ]}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 80, r: 24, t: 26, b: 72 },
              xaxis: { tickangle: -30 },
            }}
          />
        </PlotCard>

        <PlotCard title="Pay-Risk Matrix">
          <PlotFigure
            height={360}
            hasData={pay_risk_matrix.length > 0}
            emptyMessage="No pay-risk data available."
            data={[
              {
                type: "scatter",
                mode: "markers+text",
                x: pay_risk_matrix.map((row) => row.risk_index),
                y: pay_risk_matrix.map((row) => row.pay_index),
                text: pay_risk_matrix.map((row) => row.well_name),
                textposition: "top center",
                marker: {
                  size: pay_risk_matrix.map((row) => Math.max(12, 18 + (row.net_reservoir_fraction || 0) * 35)),
                  color: pay_risk_matrix.map((row) => QUADRANT_COLORS[row.quadrant || ""] || "#2fa7c8"),
                  line: { color: "rgba(30,37,51,0.2)", width: 0.8 },
                  opacity: 0.92,
                },
                customdata: pay_risk_matrix.map((row) => [row.qc_score, row.anomaly_pct, row.quadrant]),
                hovertemplate:
                  "%{text}<br>Pay index: %{y:.2f}<br>Risk index: %{x:.2f}<br>QC score: %{customdata[0]:.1f}<br>Anomaly %: %{customdata[1]:.2f}<br>Category: %{customdata[2]}<extra></extra>",
              },
            ]}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 55, r: 24, t: 24, b: 42 },
              xaxis: { title: "Risk Index", range: [0, 100], gridcolor: GRID_COLOR },
              yaxis: { title: "Pay Index", range: [0, 100], gridcolor: GRID_COLOR },
              shapes: [
                {
                  type: "line",
                  x0: 40,
                  x1: 40,
                  y0: 0,
                  y1: 100,
                  line: { color: "rgba(30,37,51,0.2)", dash: "dot" },
                },
                {
                  type: "line",
                  x0: 0,
                  x1: 100,
                  y0: 60,
                  y1: 60,
                  line: { color: "rgba(30,37,51,0.2)", dash: "dot" },
                },
              ],
            }}
          />
        </PlotCard>

        <PlotCard title="Geophysics Crossplot">
          <PlotFigure
            height={360}
            hasData={geophysics_crossplot.length > 0}
            emptyMessage="Geophysics crossplot requires DT curve data."
            data={[
              {
                type: "scatter",
                mode: "markers+text",
                x: geophysics_crossplot.map((row) => row.avg_velocity_ft_s),
                y: geophysics_crossplot.map((row) => row.reflectivity_energy),
                text: geophysics_crossplot.map((row) => row.well_name),
                textposition: "top center",
                marker: {
                  size: geophysics_crossplot.map((row) => Math.max(14, (row.pay_index || 0) * 0.35)),
                  color: geophysics_crossplot.map((row) => row.risk_index),
                  colorscale: "Turbo",
                  cmin: 0,
                  cmax: 100,
                  line: { color: "rgba(30,37,51,0.2)", width: 0.8 },
                  opacity: 0.9,
                  colorbar: { title: "Risk" },
                },
                hovertemplate:
                  "%{text}<br>Avg velocity: %{x:.1f} ft/s<br>Reflectivity energy: %{y:.5f}<br>Pay index drives bubble size<extra></extra>",
              },
            ]}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 60, r: 24, t: 24, b: 45 },
              xaxis: { title: "Average Velocity (ft/s)", gridcolor: GRID_COLOR },
              yaxis: { title: "Reflectivity Energy", gridcolor: GRID_COLOR },
            }}
          />
        </PlotCard>

        <PlotCard title="SOM Quality">
          <PlotFigure
            height={360}
            hasData={som_quality.length > 0}
            emptyMessage="SOM quality metrics unavailable."
            data={[
              {
                type: "bar",
                x: som_quality.map((row) => row.well_name),
                y: som_quality.map((row) => row.quantization_error),
                name: "Quantization Error",
                marker: { color: "#f2bf58" },
                hovertemplate: "%{x}<br>QE: %{y:.4f}<extra></extra>",
              },
              {
                type: "scatter",
                x: som_quality.map((row) => row.well_name),
                y: som_quality.map((row) => row.topological_error),
                mode: "lines+markers",
                yaxis: "y2",
                name: "Topological Error",
                line: { color: "#58d1b2", width: 2 },
                marker: { size: 7 },
                hovertemplate: "%{x}<br>TE: %{y:.4f}<extra></extra>",
              },
            ]}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 55, r: 55, t: 24, b: 64 },
              xaxis: { tickangle: -25 },
              yaxis: { title: "Quantization Error", gridcolor: GRID_COLOR },
              yaxis2: { title: "Topological Error", overlaying: "y", side: "right", showgrid: false },
              legend: { orientation: "h" },
            }}
          />
        </PlotCard>
      </div>
    </SectionPanel>
  );
}
