import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Plot from "react-plotly.js";

import styles from "./app.module.css";
import { AssistantDrawer } from "./components/assistant-drawer";
import { EmptyPlot } from "./components/empty-plot";
import { FileValidationModal } from "./components/FileValidationModal";
import { MetricCard } from "./components/metric-card";
import { PlotCard } from "./components/plot-card";
import { SectionPanel } from "./components/section-panel";
import { Sidebar } from "./components/sidebar";
import { TabBar } from "./components/tab-bar";
import { exportCsvReport, exportPdfReport } from "./controllers/export-controller";
import {
  axisRangeFromSeries,
  hasNumericData,
  normalizeSeries,
  PLOT_LAYOUT_BASE,
  SEQ_TRACT_COLOR,
} from "./controllers/plot-controller";
import { fmt, statusMeta } from "./controllers/format-controller";
import { useAnalysis } from "./hooks/use-analysis";
import { useChat } from "./hooks/use-chat";
import { useSequenceReview } from "./hooks/use-sequence-review";
import type { SequenceCorrelation, WellReport } from "./models/analyze-models";
import { fetchChatAnswer } from "./services/api-service";
import { renderMarkdown } from "./services/markdown-service";

type TabId = "overview" | "sequence";

type BoundaryStatus = "pending" | "accepted" | "rejected";

type SequenceBoundaryRow = {
  id: string;
  depth: number;
  confidence: number;
  from_tract: string;
  to_tract: string;
  status: BoundaryStatus;
  source?: "auto" | "manual";
};

const RAW_CURVE_ORDER = ["GR", "DT", "RESD", "SP", "RHOB", "NPHI"];

// Colors follow loose industry conventions: GR=dark-green, NPHI=blue, RHOB=warm-orange,
// RESD=sienna, DT=purple, SP=olive. All chosen for light-background legibility.
const RAW_CURVE_COLOR: Record<string, string> = {
  GR:   "#2d6a4f", // deep forest green  — GR is conventionally dark; green is standard in many platforms
  DT:   "#6b3fa0", // medium purple       — sonic, distinct from NPHI blue and resistivity
  RESD: "#9e3a1a", // brick sienna        — resistivity brown-red per Techlog/IP convention
  SP:   "#5c6e22", // olive               — SP is GR-track companion; earthy tone
  RHOB: "#b8510c", // burnt orange        — density warm-orange per universal Archie convention
  NPHI: "#1a5ea8", // steel blue          — neutron porosity blue is a universal well-log standard
};

// Traffic-light convention: green=best, amber=caution, gray=low, red=risk
const QUADRANT_COLORS: Record<string, string> = {
  "Prime Target":              "#1a9850", // forest green
  "Balanced Opportunity":      "#f39c12", // amber
  "Low Upside / Low Risk":     "#7f8c8d", // slate gray
  "High-Risk / Needs Review":  "#c0392b", // muted red
};

function MarkdownView({ text }: { text: string }) {
  return <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

function SkeletonText() {
  return (
    <div className={styles.skeletonBox}>
      <div className={styles.line} />
      <div className={`${styles.line} ${styles.lineShort}`} />
      <div className={styles.line} />
    </div>
  );
}

function WellHeader({ well }: { well: WellReport }) {
  const som = well.ml?.som || {};
  const somGrid = som.grid?.rows && som.grid?.cols ? `${som.grid.rows}x${som.grid.cols}` : "N/A";

  return (
    <div className={styles.wellHeader}>
      <div>
        <h3 className={styles.wellTitle}>{well.well_name}</h3>
        <p className={styles.wellSubTitle}>
          API {well.api || "N/A"} | {well.file_name} | LAS {well.las_version || "N/A"}
        </p>
      </div>
      <div className={styles.tagWrap}>
        <span className={styles.tag}>QC {fmt(well.qc?.data_score, 1)}</span>
        <span className={styles.tag}>Rows {well.n_rows ?? "N/A"}</span>
        <span className={styles.tag}>{well.company || "Unknown company"}</span>
        <span className={styles.tag}>SOM {somGrid}</span>
      </div>
    </div>
  );
}

function RawTrackPlots({ well }: { well: WellReport }) {
  const depth = well.tracks?.depth || [];
  const raw = well.tracks?.raw || {};
  const anomalyFlags = well.tracks?.anomaly_flags || [];

  const curveKeys = useMemo(
    () => RAW_CURVE_ORDER.filter((key) => hasNumericData((raw[key] || []) as Array<number | null | undefined>)),
    [raw]
  );

  if (!curveKeys.length) {
    return <EmptyPlot message="No raw log curves available." />;
  }

  return (
    <div className={styles.rawGrid}>
      {curveKeys.map((key) => {
        const curve = raw[key] || [];
        const mappedCurve = (well.curve_map?.[key] || key).toUpperCase();
        const unit = well.curve_units?.[mappedCurve] || "";
        const title = unit ? `${key} (${unit})` : key;
        const range = axisRangeFromSeries(curve);
        const anomalyX: Array<number | null> = [];
        const anomalyDepth: Array<number | null> = [];

        for (let idx = 0; idx < anomalyFlags.length; idx += 1) {
          if (anomalyFlags[idx] === 1) {
            anomalyX.push((curve[idx] as number | null | undefined) ?? null);
            anomalyDepth.push((depth[idx] as number | null | undefined) ?? null);
          }
        }

        const traces: Array<Record<string, unknown>> = [
          {
            x: curve,
            y: depth,
            type: "scatter",
            mode: "lines",
            line: { width: 1.8, color: RAW_CURVE_COLOR[key] || "#5c6e82" },
            hovertemplate: `Depth %{y}<br>${title}: %{x:.3f}<extra></extra>`,
            showlegend: false,
            name: key,
          },
        ];

        if (anomalyDepth.length) {
          traces.push({
            x: anomalyX,
            y: anomalyDepth,
            type: "scatter",
            mode: "markers",
            marker: { size: 7, color: "#c0392b", symbol: "diamond" },
            hovertemplate: `Depth %{y}<br>${title}: %{x:.3f}<br>ML anomaly<extra></extra>`,
            showlegend: false,
            name: "Anomaly",
          });
        }

        return (
          <PlotCard key={`${well.well_name}-${key}`} title={title}>
            <Plot
              data={traces as never}
              layout={{
                ...PLOT_LAYOUT_BASE,
                margin: { l: 62, r: 16, t: 30, b: 42 },
                xaxis: {
                  title,
                  gridcolor: "rgba(30,37,51,0.11)",
                  ...(range ? { range } : {}),
                },
                yaxis: { title: "Depth", autorange: "reversed", gridcolor: "rgba(30,37,51,0.11)" },
                showlegend: false,
              }}
              style={{ width: "100%", height: "520px" }}
              config={{ displaylogo: false, responsive: true }}
            />
          </PlotCard>
        );
      })}
    </div>
  );
}

function DerivedPlots({ well }: { well: WellReport }) {
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

  return (
    <div className={styles.gridTwo}>
      <PlotCard title="Derived Petrophysical Response">
        {derivedTraces.length ? (
          <Plot
            data={derivedTraces as never}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 60, r: 28, t: 38, b: 35 },
              xaxis: { title: "Value", range: [0, 1], gridcolor: "rgba(30,37,51,0.11)" },
              yaxis: { title: "Depth", autorange: "reversed", gridcolor: "rgba(30,37,51,0.11)" },
              legend: { orientation: "h" },
            }}
            style={{ width: "100%", height: "420px" }}
            config={{ displaylogo: false, responsive: true }}
          />
        ) : (
          <EmptyPlot message="No derived petrophysical curves available." />
        )}
      </PlotCard>

      <PlotCard title="Geophysics Quicklook: Velocity / Density / AI / Reflectivity">
        {geoTraces.length ? (
          <Plot
            data={geoTraces as never}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 60, r: 50, t: 38, b: 35 },
              xaxis: {
                title: "Normalized Velocity / Density / AI",
                range: [0, 1],
                gridcolor: "rgba(30,37,51,0.11)",
              },
              xaxis2: {
                title: "Reflectivity",
                overlaying: "x",
                side: "top",
                range: [-0.25, 0.25],
                showgrid: false,
                tickfont: { color: "#b03060" },
              },
              yaxis: { title: "Depth", autorange: "reversed", gridcolor: "rgba(30,37,51,0.11)" },
              legend: { orientation: "h" },
            }}
            style={{ width: "100%", height: "420px" }}
            config={{ displaylogo: false, responsive: true }}
          />
        ) : (
          <EmptyPlot message="Geophysics quicklook requires DT data." />
        )}
      </PlotCard>

      <PlotCard title="SOM U-Matrix + Node Hits">
        {som.status === "ok" && Array.isArray(som.u_matrix) && som.u_matrix.length ? (
          <Plot
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
                x: (som.node_hits || []).flatMap((row, rowIdx) => row.map((_hit, colIdx) => colIdx)),
                y: (som.node_hits || []).flatMap((row, rowIdx) => row.map(() => rowIdx)),
                marker: {
                  size: (som.node_hits || []).flatMap((row) => row.map((hit) => Math.max(8, 8 + (hit || 0) * 0.7))),
                  color: "rgba(255,255,255,0.25)",
                  line: { color: "rgba(30,37,51,0.25)", width: 0.6 },
                },
                text: (som.node_hits || []).flatMap((row, rowIdx) => row.map((hit, colIdx) => `Node (${rowIdx},${colIdx}) hits: ${hit || 0}`)),
                hovertemplate: "%{text}<extra></extra>",
                showlegend: false,
              },
            ] as never}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 55, r: 24, t: 38, b: 45 },
              xaxis: { title: "SOM Col", dtick: 1 },
              yaxis: { title: "SOM Row", dtick: 1, autorange: "reversed" },
            }}
            style={{ width: "100%", height: "420px" }}
            config={{ displaylogo: false, responsive: true }}
          />
        ) : (
          <EmptyPlot message="SOM map unavailable." />
        )}
      </PlotCard>

      <PlotCard title="SOM Facies Track (Depth vs BMU)">
        {hasNumericData(somBmu as Array<number | null | undefined>) && depth.length ? (
          <Plot
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
            ] as never}
            layout={{
              ...PLOT_LAYOUT_BASE,
              margin: { l: 60, r: 54, t: 38, b: 35 },
              xaxis: { title: "BMU Node Index", gridcolor: "rgba(30,37,51,0.11)" },
              yaxis: { title: "Depth", autorange: "reversed", gridcolor: "rgba(30,37,51,0.11)" },
            }}
            style={{ width: "100%", height: "420px" }}
            config={{ displaylogo: false, responsive: true }}
          />
        ) : (
          <EmptyPlot message="SOM facies track unavailable." />
        )}
      </PlotCard>
    </div>
  );
}

function WellCard({ well }: { well: WellReport }) {
  return (
    <article className={styles.wellCard}>
      <WellHeader well={well} />
      <RawTrackPlots well={well} />
      <DerivedPlots well={well} />
    </article>
  );
}

function SequenceCorrelationChart({ correlation }: { correlation: SequenceCorrelation | null }) {
  if (!correlation || correlation.status !== "ok" || !correlation.surface_names?.length) {
    return <EmptyPlot message="Need multiple wells with valid sequence picks." />;
  }

  return (
    <Plot
      data={[
        {
          type: "heatmap",
          z: correlation.relative_matrix,
          x: correlation.well_names,
          y: correlation.surface_names,
          zmin: 0,
          zmax: 1,
          colorscale: "Blues",
          customdata: correlation.depth_matrix,
          hovertemplate:
            "Surface %{y}<br>Well %{x}<br>Relative position %{z:.3f}<br>Depth %{customdata:.2f}<extra></extra>",
        },
      ] as never}
      layout={{
        ...PLOT_LAYOUT_BASE,
        margin: { l: 84, r: 22, t: 28, b: 55 },
        xaxis: { tickangle: -24 },
        yaxis: { autorange: "reversed" },
      }}
      style={{ width: "100%", height: "360px" }}
      config={{ displaylogo: false, responsive: true }}
    />
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [demoMode, setDemoMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantWidth, setAssistantWidth] = useState(420);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [sequenceAiLoading, setSequenceAiLoading] = useState(false);
  const [sequenceAiText, setSequenceAiText] = useState("Run analysis and click AI Autocomplete Suggestions.");
  const [sequenceAiMeta, setSequenceAiMeta] = useState("Source: N/A");

  const analysis = useAnalysis();
  const sequence = useSequenceReview(analysis.payload);

  const chat = useChat({
    getAnalysisId: () => analysis.payload?.analysis_id || null,
    isAiEnabled: () => analysis.aiEnabled,
    onStatus: (message) => analysis.setStatus(message),
  });

  useEffect(() => {
    if (!analysis.payload?.analysis_id) return;
    chat.resetForAnalysis();
    sequence.resetForAnalysis();
    setSequenceAiText("Run analysis and click AI Autocomplete Suggestions.");
    setSequenceAiMeta("Source: N/A");
    setActiveTab("overview");
  }, [analysis.payload?.analysis_id]);

  useEffect(() => {
    if (!assistantOpen) return;
    function onEsc(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAssistantOpen(false);
      }
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [assistantOpen]);

  const selectedBoundaries = (sequence.boundaries || []) as SequenceBoundaryRow[];

  const selectedSequenceReport = sequence.selectedReport;

  async function runDemoMode() {
    setDemoMode(true);
    analysis.setStatus("Launching demo mode workflow...");
    await analysis.runSampleAnalysis();
    analysis.setStatus("Demo mode ready. Use Export PDF/CSV for committee/company showcase.");
  }

  async function onSequenceSuggest() {
    if (!analysis.payload?.analysis_id || !sequence.selectedWell || !selectedSequenceReport) {
      sequence.setStatus("Run analysis and select a sequence-ready well first.");
      return;
    }

    const seq = selectedSequenceReport.sequence_stratigraphy;
    if (!seq) {
      sequence.setStatus("Sequence data not available for selected well.");
      return;
    }

    const prompt = [
      `Provide sequence-stratigraphy autocomplete suggestions for well ${sequence.selectedWell}.`,
      "Focus on which auto-picked boundaries should be accepted/rejected and where manual boundaries may be required.",
      "Return concise sections: Accepted, Rejected, Add-manual, and Rationale.",
      `Curve used: ${seq.source_curve || "N/A"}.`,
      `Auto boundaries: ${JSON.stringify((seq.boundaries_auto || []).slice(0, 15))}`,
      `Intervals: ${JSON.stringify((seq.intervals_auto || []).slice(0, 20))}`,
      `Confidence threshold in UI: ${sequence.threshold.toFixed(2)}`,
    ].join("\n");

    setSequenceAiLoading(true);
    setSequenceAiMeta("Source: pending | Generating sequence suggestions...");
    setSequenceAiText("");

    try {
      const response = await fetchChatAnswer(analysis.payload.analysis_id, prompt, [], analysis.aiEnabled);
      setSequenceAiText(response.answer || "No sequence suggestions returned.");
      setSequenceAiMeta(statusMeta(response.meta));
      sequence.setStatus("AI suggestions generated. Review before accepting.");
      analysis.setStatus("Sequence AI suggestions ready.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI suggestion error";
      setSequenceAiText(`Error: ${message}`);
      setSequenceAiMeta(`Source: error | ${message}`);
      sequence.setStatus(`Error: ${message}`);
      analysis.setStatus(`Error: ${message}`);
    } finally {
      setSequenceAiLoading(false);
    }
  }

  async function onSendPrompt(prompt: string) {
    await chat.sendMessageWithText(prompt);
  }

  function onExportCsv() {
    if (!analysis.payload) {
      analysis.setStatus("No analysis results available for export.");
      return;
    }
    const filename = exportCsvReport(analysis.payload);
    analysis.setStatus(`CSV export generated (${filename}).`);
  }

  async function onExportPdf() {
    if (!analysis.payload) {
      analysis.setStatus("No analysis results available for export.");
      return;
    }

    setExportingPdf(true);
    try {
      const filename = await exportPdfReport(analysis.payload);
      analysis.setStatus(`PDF export generated (${filename}).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF export failed";
      analysis.setStatus(`Error: ${message}`);
    } finally {
      setExportingPdf(false);
    }
  }

  const payload = analysis.payload;

  return (
    <>
    {analysis.fileValidation.state === "confirming" && analysis.fileValidation.validationPayload && (
      <FileValidationModal
        reports={analysis.fileValidation.validationPayload.files}
        onConfirm={(decisions) => void analysis.proceedWithAnalysis(decisions)}
        onCancel={() => {
          analysis.fileValidation.cancel();
          analysis.setStatus("Cancelled.");
        }}
      />
    )}
    <div className={styles.appLayout}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapseToggle={() => setSidebarCollapsed((prev) => !prev)}
        isBusy={analysis.isBusy}
        status={analysis.status}
        aiEnabled={analysis.aiEnabled}
        demoMode={demoMode}
        hasPayload={!!payload}
        exportingPdf={exportingPdf}
        onFileChange={(files) => analysis.setFileList(files)}
        onAnalyzeSample={() => void analysis.runSampleAnalysis()}
        onAnalyzeUploads={() => void analysis.runUploadAnalysis()}
        onRunDemo={() => void runDemoMode()}
        onExportCsv={onExportCsv}
        onExportPdf={() => void onExportPdf()}
        onAiEnabledChange={analysis.setAiEnabled}
        onDemoModeChange={setDemoMode}
      />
      <main
        className={`${styles.mainBody} ${demoMode ? styles.demoMode : ""}`}
        style={{ "--assistant-width": `${assistantWidth}px` } as CSSProperties}
      >
      <SectionPanel>
        <TabBar active={activeTab} onChange={setActiveTab} />
      </SectionPanel>

      {activeTab === "overview" && payload ? (
        <>
          <SectionPanel title="Portfolio Summary">
            <div className={styles.metricsGrid}>
              <MetricCard label="Wells" value={String(payload.portfolio_summary?.well_count ?? 0)} />
              <MetricCard label="Avg QC" value={fmt(payload.portfolio_summary?.avg_qc_score, 1)} />
              <MetricCard label="Depth Samples" value={String(payload.portfolio_summary?.total_depth_points ?? 0)} />
              <MetricCard label="Wells With Potential Pay" value={String(payload.portfolio_summary?.wells_with_pay ?? 0)} />
              <MetricCard label="Avg Anomaly %" value={fmt(payload.portfolio_summary?.avg_anomaly_pct, 2)} />
              <MetricCard label="Density Transform" value={payload.density_transform?.method || "N/A"} />
              <MetricCard
                label="Transform Support Points"
                value={String(payload.density_transform?.support_points ?? "N/A")}
              />
            </div>
          </SectionPanel>

          <SectionPanel title="Cross-Well Analytics">
            <div className={styles.gridTwo}>
              <PlotCard title="Well Ranking">
                {payload.portfolio_analytics.well_ranking.length ? (
                  <Plot
                    data={[
                      {
                        type: "bar",
                        orientation: "h",
                        y: payload.portfolio_analytics.well_ranking.map((row) => `${row.rank}. ${row.well_name}`),
                        x: payload.portfolio_analytics.well_ranking.map((row) => row.composite_score),
                        marker: {
                          color: payload.portfolio_analytics.well_ranking.map((row) => row.composite_score),
                          // Traffic-light: low=red, mid=amber, high=green — universal quality convention
                          colorscale: [
                            [0.0, "#d73027"],
                            [0.5, "#fee08b"],
                            [1.0, "#1a9850"],
                          ],
                        },
                        text: payload.portfolio_analytics.well_ranking.map((row) => fmt(row.composite_score, 2)),
                        textposition: "inside",
                        hovertemplate: "%{y}<br>Composite score: %{x:.2f}<extra></extra>",
                      },
                    ] as never}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      margin: { l: 140, r: 24, t: 24, b: 35 },
                      xaxis: { title: "Composite Score", gridcolor: "rgba(30,37,51,0.11)" },
                      yaxis: { autorange: "reversed" },
                    }}
                    style={{ width: "100%", height: "350px" }}
                    config={{ displaylogo: false, responsive: true }}
                  />
                ) : (
                  <EmptyPlot message="No ranking data available." />
                )}
              </PlotCard>

              <PlotCard
                title="Facies Similarity"
                meta={
                  payload.portfolio_analytics.facies_similarity.value_interpretation
                    ? `${payload.portfolio_analytics.facies_similarity.method || "Similarity"} | ${payload.portfolio_analytics.facies_similarity.value_interpretation}`
                    : ""
                }
              >
                {payload.portfolio_analytics.facies_similarity.labels.length &&
                payload.portfolio_analytics.facies_similarity.matrix.length ? (
                  <Plot
                    data={[
                      {
                        type: "heatmap",
                        z: payload.portfolio_analytics.facies_similarity.matrix,
                        x: payload.portfolio_analytics.facies_similarity.labels,
                        y: payload.portfolio_analytics.facies_similarity.labels,
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
                    ] as never}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      margin: { l: 80, r: 24, t: 26, b: 72 },
                      xaxis: { tickangle: -30 },
                    }}
                    style={{ width: "100%", height: "360px" }}
                    config={{ displaylogo: false, responsive: true }}
                  />
                ) : (
                  <EmptyPlot message="No facies similarity data available." />
                )}
              </PlotCard>

              <PlotCard title="Pay-Risk Matrix">
                {payload.portfolio_analytics.pay_risk_matrix.length ? (
                  <Plot
                    data={[
                      {
                        type: "scatter",
                        mode: "markers+text",
                        x: payload.portfolio_analytics.pay_risk_matrix.map((row) => row.risk_index),
                        y: payload.portfolio_analytics.pay_risk_matrix.map((row) => row.pay_index),
                        text: payload.portfolio_analytics.pay_risk_matrix.map((row) => row.well_name),
                        textposition: "top center",
                        marker: {
                          size: payload.portfolio_analytics.pay_risk_matrix.map((row) =>
                            Math.max(12, 18 + (row.net_reservoir_fraction || 0) * 35)
                          ),
                          color: payload.portfolio_analytics.pay_risk_matrix.map(
                            (row) => QUADRANT_COLORS[row.quadrant || ""] || "#2fa7c8"
                          ),
                          line: { color: "rgba(30,37,51,0.2)", width: 0.8 },
                          opacity: 0.92,
                        },
                        customdata: payload.portfolio_analytics.pay_risk_matrix.map((row) => [
                          row.qc_score,
                          row.anomaly_pct,
                          row.quadrant,
                        ]),
                        hovertemplate:
                          "%{text}<br>Pay index: %{y:.2f}<br>Risk index: %{x:.2f}<br>QC score: %{customdata[0]:.1f}<br>Anomaly %: %{customdata[1]:.2f}<br>Category: %{customdata[2]}<extra></extra>",
                      },
                    ] as never}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      margin: { l: 55, r: 24, t: 24, b: 42 },
                      xaxis: { title: "Risk Index", range: [0, 100], gridcolor: "rgba(30,37,51,0.11)" },
                      yaxis: { title: "Pay Index", range: [0, 100], gridcolor: "rgba(30,37,51,0.11)" },
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
                    style={{ width: "100%", height: "360px" }}
                    config={{ displaylogo: false, responsive: true }}
                  />
                ) : (
                  <EmptyPlot message="No pay-risk data available." />
                )}
              </PlotCard>

              <PlotCard title="Geophysics Crossplot">
                {payload.portfolio_analytics.geophysics_crossplot.length ? (
                  <Plot
                    data={[
                      {
                        type: "scatter",
                        mode: "markers+text",
                        x: payload.portfolio_analytics.geophysics_crossplot.map((row) => row.avg_velocity_ft_s),
                        y: payload.portfolio_analytics.geophysics_crossplot.map((row) => row.reflectivity_energy),
                        text: payload.portfolio_analytics.geophysics_crossplot.map((row) => row.well_name),
                        textposition: "top center",
                        marker: {
                          size: payload.portfolio_analytics.geophysics_crossplot.map((row) => Math.max(14, (row.pay_index || 0) * 0.35)),
                          color: payload.portfolio_analytics.geophysics_crossplot.map((row) => row.risk_index),
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
                    ] as never}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      margin: { l: 60, r: 24, t: 24, b: 45 },
                      xaxis: { title: "Average Velocity (ft/s)", gridcolor: "rgba(30,37,51,0.11)" },
                      yaxis: { title: "Reflectivity Energy", gridcolor: "rgba(30,37,51,0.11)" },
                    }}
                    style={{ width: "100%", height: "360px" }}
                    config={{ displaylogo: false, responsive: true }}
                  />
                ) : (
                  <EmptyPlot message="Geophysics crossplot requires DT curve data." />
                )}
              </PlotCard>

              <PlotCard title="SOM Quality">
                {payload.portfolio_analytics.som_quality.length ? (
                  <Plot
                    data={[
                      {
                        type: "bar",
                        x: payload.portfolio_analytics.som_quality.map((row) => row.well_name),
                        y: payload.portfolio_analytics.som_quality.map((row) => row.quantization_error),
                        name: "Quantization Error",
                        marker: { color: "#f2bf58" },
                        hovertemplate: "%{x}<br>QE: %{y:.4f}<extra></extra>",
                      },
                      {
                        type: "scatter",
                        x: payload.portfolio_analytics.som_quality.map((row) => row.well_name),
                        y: payload.portfolio_analytics.som_quality.map((row) => row.topological_error),
                        mode: "lines+markers",
                        yaxis: "y2",
                        name: "Topological Error",
                        line: { color: "#58d1b2", width: 2 },
                        marker: { size: 7 },
                        hovertemplate: "%{x}<br>TE: %{y:.4f}<extra></extra>",
                      },
                    ] as never}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      margin: { l: 55, r: 55, t: 24, b: 64 },
                      xaxis: { tickangle: -25 },
                      yaxis: { title: "Quantization Error", gridcolor: "rgba(30,37,51,0.11)" },
                      yaxis2: { title: "Topological Error", overlaying: "y", side: "right", showgrid: false },
                      legend: { orientation: "h" },
                    }}
                    style={{ width: "100%", height: "360px" }}
                    config={{ displaylogo: false, responsive: true }}
                  />
                ) : (
                  <EmptyPlot message="SOM quality metrics unavailable." />
                )}
              </PlotCard>
            </div>
          </SectionPanel>

          <SectionPanel title="AI Technical Interpretation">
            <p className={styles.meta}>{analysis.aiMeta}</p>
            {analysis.aiLoading ? <SkeletonText /> : <MarkdownView text={analysis.aiText || payload.ai_interpretation || "No AI interpretation."} />}
          </SectionPanel>

          <SectionPanel title="Per-Well Diagnostic Workspace">
            <div className={styles.wellGrid}>
              {payload.wells?.map((well) => (
                <WellCard key={`${well.file_name}-${well.well_name}`} well={well} />
              ))}
            </div>
          </SectionPanel>

          {payload.errors?.length ? (
            <SectionPanel title="Errors">
              <ul className={styles.errorList}>
                {payload.errors.map((error, idx) => (
                  <li key={`${error.file_name || "file"}-${idx}`}>
                    {error.file_name || "file"}: {error.error}
                  </li>
                ))}
              </ul>
            </SectionPanel>
          ) : null}
        </>
      ) : null}

      {activeTab === "sequence" ? (
        <>
          <SectionPanel title="Sequence Stratigraphy Studio">
            <div className={`${styles.row} ${styles.wrap}`}>
              <label className={styles.field}>
                <span>Well</span>
                <select
                  value={sequence.selectedWell}
                  onChange={(event) => sequence.setSelectedWell(event.target.value)}
                  disabled={!sequence.readyWells.length}
                >
                  {sequence.readyWells.map((well) => (
                    <option key={well.well_name} value={well.well_name}>
                      {well.well_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Confidence threshold ({sequence.threshold.toFixed(2)})</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(sequence.threshold * 100)}
                  onChange={(event) => sequence.setThreshold(Number(event.target.value) / 100)}
                />
              </label>

              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={() => void onSequenceSuggest()}
                disabled={!analysis.payload?.analysis_id || !sequence.selectedWell}
              >
                AI Autocomplete Suggestions
              </button>

              <button
                className={`${styles.button} ${styles.secondary}`}
                onClick={() => sequence.resetSelectedWellEdits()}
                disabled={!sequence.selectedWell}
              >
                Reset Human Edits
              </button>
            </div>
            <p className={styles.status}>{sequence.status}</p>
          </SectionPanel>

          <SectionPanel title="Sequence Log + Human Review">
            {selectedSequenceReport?.sequence_stratigraphy?.status === "ok" ? (
              <Plot
                data={[
                  {
                    type: "scatter",
                    mode: "lines",
                    x: selectedSequenceReport.sequence_stratigraphy.tracks.signal || [],
                    y: selectedSequenceReport.sequence_stratigraphy.tracks.depth || [],
                    line: { color: "#8b6914", width: 1.4 }, // dark amber — raw/noisy, subordinate
                    name: "Signal",
                  },
                  {
                    type: "scatter",
                    mode: "lines",
                    x: selectedSequenceReport.sequence_stratigraphy.tracks.signal_smooth || [],
                    y: selectedSequenceReport.sequence_stratigraphy.tracks.depth || [],
                    line: { color: "#1a5ea8", width: 2.2 }, // steel blue — interpreter's working curve
                    name: "Smoothed",
                  },
                ] as never}
                layout={{
                  ...PLOT_LAYOUT_BASE,
                  title: { text: `Well: ${selectedSequenceReport.well_name}`, font: { size: 14 } },
                  yaxis: { title: "Depth", autorange: "reversed" },
                  xaxis: {
                    title: `${selectedSequenceReport.sequence_stratigraphy.source_curve || "Curve"} (transformed)`,
                  },
                  shapes: [
                    ...((selectedSequenceReport.sequence_stratigraphy.intervals_auto || []).map((interval) => ({
                      type: "rect",
                      xref: "paper",
                      yref: "y",
                      x0: 0,
                      x1: 1,
                      y0: interval.top,
                      y1: interval.base,
                      fillcolor: SEQ_TRACT_COLOR[interval.tract] || SEQ_TRACT_COLOR.UNDEF,
                      line: { width: 0 },
                      layer: "below",
                    })) as Array<Record<string, unknown>>),
                    ...(selectedBoundaries.map((boundary) => ({
                      type: "line",
                      xref: "paper",
                      yref: "y",
                      x0: 0,
                      x1: 1,
                      y0: boundary.depth,
                      y1: boundary.depth,
                      line: {
                        color:
                          boundary.status === "accepted"
                            ? "rgba(22,132,70,1.0)"    // solid green — confirmed pick
                            : boundary.status === "rejected"
                              ? "rgba(186,48,48,1.0)"  // solid muted red — discarded pick
                              : "rgba(170,120,30,1.0)",// amber/ochre — unreviewed; clearly visible
                        dash: boundary.status === "accepted" ? "solid" : boundary.status === "rejected" ? "dash" : "dot",
                        width: boundary.status === "accepted" ? 2.0 : boundary.status === "rejected" ? 1.8 : 1.5,
                      },
                    })) as Array<Record<string, unknown>>),
                  ],
                }}
                style={{ width: "100%", height: "660px" }}
                config={{ displaylogo: false, responsive: true }}
              />
            ) : (
              <EmptyPlot message="No sequence-ready well selected." />
            )}
          </SectionPanel>

          <SectionPanel title="Boundary Review">
            <div className={styles.gridTwo}>
              <ul className={styles.boundaryList}>
                {selectedBoundaries.map((boundary) => (
                  <li key={boundary.id} className={styles.boundaryItem}>
                    <div className={styles.boundaryTop}>
                      <strong>
                        {boundary.id} | Depth {fmt(boundary.depth, 2)}
                      </strong>
                      <div className={`${styles.row} ${styles.tight}`}>
                        <button onClick={() => sequence.setBoundaryStatus(boundary.id, "accepted")}>Accept</button>
                        <button onClick={() => sequence.setBoundaryStatus(boundary.id, "rejected")}>Reject</button>
                        <button onClick={() => sequence.setBoundaryStatus(boundary.id, "pending")}>Pending</button>
                        {boundary.source === "manual" ? (
                          <button onClick={() => sequence.setBoundaryStatus(boundary.id, "delete-manual")}>Delete</button>
                        ) : null}
                      </div>
                    </div>
                    <p className={styles.meta}>
                      {boundary.from_tract} -&gt; {boundary.to_tract} | confidence {fmt(boundary.confidence, 3)} | status{" "}
                      {boundary.status}
                    </p>
                  </li>
                ))}
              </ul>

              <div className={styles.boundaryManual}>
                <label className={styles.field}>
                  <span>Manual boundary depth</span>
                  <input
                    type="number"
                    step="0.1"
                    value={sequence.manualDepth}
                    onChange={(event) => sequence.setManualDepth(event.target.value)}
                    placeholder="e.g. 2045.2"
                  />
                </label>
                <button className={`${styles.button} ${styles.secondary}`} onClick={sequence.addManualBoundary}>
                  Add Manual Boundary
                </button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel title="Cross-Well Sequence Correlation">
            <SequenceCorrelationChart correlation={sequence.correlation} />
          </SectionPanel>

          <SectionPanel title="AI Sequence Interpretation">
            <p className={styles.meta}>{sequenceAiMeta}</p>
            {sequenceAiLoading ? <SkeletonText /> : <MarkdownView text={sequenceAiText} />}
          </SectionPanel>
        </>
      ) : null}

      </main>
      <AssistantDrawer
        open={assistantOpen}
        onToggle={() => setAssistantOpen((prev) => !prev)}
        analysisId={analysis.payload?.analysis_id || null}
        aiEnabled={analysis.aiEnabled}
        aiMeta={analysis.aiMeta}
        aiInterpretation={analysis.aiText || analysis.payload?.ai_interpretation || "No AI interpretation."}
        aiLoading={analysis.aiLoading}
        messages={chat.messages}
        input={chat.input}
        setInput={chat.setInput}
        isPending={chat.isPending}
        onSend={() => {
          void chat.sendMessage();
        }}
        onSendPrompt={(prompt) => {
          void onSendPrompt(prompt);
        }}
        onClear={chat.clear}
        onWidthChange={setAssistantWidth}
      />
    </div>
    </>
  );
}
