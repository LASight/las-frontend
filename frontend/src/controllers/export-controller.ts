import type { AnalyzePayload } from "../models/analyze-models";
import { fmt } from "./format-controller";

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function downloadBlob(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").slice(0, 19);
}

export function exportCsvReport(
  payload: AnalyzePayload,
  scope: "single" | "portfolio" = "portfolio"
): string {
  const rows: unknown[][] = [];
  const ranking = payload.portfolio_analytics?.well_ranking || [];
  const payRisk = payload.portfolio_analytics?.pay_risk_matrix || [];

  const isPortfolio = scope === "portfolio";
  rows.push([isPortfolio ? "WellSight Portfolio Analysis Report" : "WellSight Well Analysis Report"]);
  rows.push(["Generated At", new Date().toISOString()]);
  rows.push([]);
  if (isPortfolio) {
    rows.push(["Portfolio Summary"]);
    rows.push(["Wells", payload.portfolio_summary?.well_count ?? ""]);
    rows.push(["Average QC", payload.portfolio_summary?.avg_qc_score ?? ""]);
    rows.push(["Depth Samples", payload.portfolio_summary?.total_depth_points ?? ""]);
    rows.push(["Wells With Potential Pay", payload.portfolio_summary?.wells_with_pay ?? ""]);
    rows.push([]);
    rows.push(["Well Ranking"]);
    rows.push(["Rank", "Well", "API", "Composite", "Pay", "Risk", "Velocity", "Reflectivity", "Quadrant"]);

    for (const row of ranking) {
      rows.push([
        row.rank,
        row.well_name,
        row.api || "",
        row.composite_score,
        row.pay_index,
        row.risk_index,
        row.avg_velocity_ft_s,
        row.reflectivity_energy,
        row.quadrant,
      ]);
    }

    rows.push([]);
    rows.push(["Pay-Risk Matrix"]);
    rows.push(["Well", "QC", "Anomaly %", "Net Reservoir Fraction", "Pay Index", "Risk Index", "Quadrant"]);
    for (const row of payRisk) {
      rows.push([
        row.well_name,
        row.qc_score,
        row.anomaly_pct,
        row.net_reservoir_fraction,
        row.pay_index,
        row.risk_index,
        row.quadrant,
      ]);
    }
  }

  rows.push([]);
  rows.push([isPortfolio ? "Per-Well Summary" : "Well Summary"]);
  rows.push([
    "Well",
    "API",
    "Company",
    "Rows",
    "QC",
    "Avg Vsh",
    "Avg Phi",
    "Avg Sw",
    "Net Reservoir Points",
    "Avg Velocity (ft/s)",
    "Reflectivity Energy",
    "SOM Grid",
    "SOM Quantization Error",
    "SOM Topological Error",
  ]);
  for (const well of payload.wells || []) {
    const som = well.ml?.som || {};
    const somGrid = som.grid?.rows && som.grid?.cols ? `${som.grid.rows}x${som.grid.cols}` : "";
    rows.push([
      well.well_name,
      well.api,
      well.company || "",
      well.n_rows,
      well.qc?.data_score,
      well.petrophysics?.summary?.avg_vsh,
      well.petrophysics?.summary?.avg_phi,
      well.petrophysics?.summary?.avg_sw,
      well.petrophysics?.summary?.net_reservoir_points,
      well.geophysics?.avg_velocity_ft_s,
      well.geophysics?.reflectivity_energy,
      somGrid,
      som.training?.quantization_error,
      som.training?.topological_error,
    ]);
  }

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const filename = `wellsight_${isPortfolio ? "portfolio" : "well"}_report_${exportTimestamp()}.csv`;
  downloadBlob(filename, csv, "text/csv;charset=utf-8");
  return filename;
}

type AutoTableDoc = {
  autoTable: (args: Record<string, unknown>) => void;
  lastAutoTable?: { finalY: number };
};

export async function exportPdfReport(
  payload: AnalyzePayload,
  scope: "single" | "portfolio" = "portfolio"
): Promise<string> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" }) as unknown as AutoTableDoc & {
    setFillColor: (...args: number[]) => void;
    rect: (...args: Array<number | string>) => void;
    setTextColor: (...args: number[]) => void;
    setFontSize: (value: number) => void;
    text: (value: string | string[], x: number, y: number) => void;
    splitTextToSize: (text: string, size: number) => string[];
    addPage: () => void;
    save: (filename: string) => void;
  };

  const summary = payload.portfolio_summary || {
    well_count: 0,
    avg_qc_score: null,
    avg_anomaly_pct: null,
  };
  const ranking = payload.portfolio_analytics?.well_ranking || [];
  const payRisk = payload.portfolio_analytics?.pay_risk_matrix || [];
  const wells = payload.wells || [];
  const isPortfolio = scope === "portfolio";

  doc.setFillColor(14, 30, 44);
  doc.rect(0, 0, 595, 72, "F");
  doc.setTextColor(234, 244, 251);
  doc.setFontSize(20);
  doc.text(isPortfolio ? "WellSight Portfolio Analysis" : "WellSight Well Analysis", 40, 45);

  doc.setTextColor(39, 58, 73);
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 98);
  if (isPortfolio) {
    doc.text(`Wells analyzed: ${summary.well_count ?? 0}`, 40, 116);
    doc.text(`Average QC: ${fmt(summary.avg_qc_score, 1)}`, 190, 116);
    doc.text(`Avg anomaly %: ${fmt(summary.avg_anomaly_pct, 2)}`, 330, 116);

    autoTable(doc as never, {
      startY: 132,
      head: [["Rank", "Well", "API", "Composite", "Pay", "Risk", "Velocity", "Reflectivity", "Quadrant"]],
      body: ranking.map((row) => [
        row.rank,
        row.well_name,
        row.api || "N/A",
        fmt(row.composite_score, 2),
        fmt(row.pay_index, 2),
        fmt(row.risk_index, 2),
        fmt(row.avg_velocity_ft_s, 1),
        fmt(row.reflectivity_energy, 5),
        row.quadrant,
      ]),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [47, 167, 200] },
    });

    autoTable(doc as never, {
      startY: (doc.lastAutoTable?.finalY || 132) + 16,
      head: [["Well", "QC", "Anomaly %", "Net Reservoir Fraction", "Pay", "Risk"]],
      body: payRisk.map((row) => [
        row.well_name,
        fmt(row.qc_score, 1),
        fmt(row.anomaly_pct, 2),
        fmt(row.net_reservoir_fraction, 4),
        fmt(row.pay_index, 2),
        fmt(row.risk_index, 2),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [84, 209, 160] },
    });
  } else {
    const well = wells[0];
    doc.text(`Well: ${well?.well_name || "N/A"}`, 40, 116);
    doc.text(`API: ${well?.api || "N/A"}`, 250, 116);
  }

  autoTable(doc as never, {
    startY: (doc.lastAutoTable?.finalY || 116) + 16,
    head: [["Well", "SOM Grid", "SOM QE", "SOM TE"]],
    body: wells.map((well) => {
      const som = well.ml?.som || {};
      const somGrid = som.grid?.rows && som.grid?.cols ? `${som.grid.rows}x${som.grid.cols}` : "N/A";
      return [
        well.well_name,
        somGrid,
        fmt(som.training?.quantization_error, 4),
        fmt(som.training?.topological_error, 4),
      ];
    }),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [242, 191, 88] },
  });

  doc.setFontSize(10);
  doc.setTextColor(70, 84, 98);
  const interpretation = (payload.ai_interpretation || "").slice(0, 1700);
  const wrapped = doc.splitTextToSize(`AI Interpretation:\n${interpretation}`, 510);
  let y = (doc.lastAutoTable?.finalY || 200) + 20;
  if (y > 740) {
    doc.addPage();
    y = 60;
  }
  doc.text(wrapped, 40, y);

  const filename = `wellsight_${isPortfolio ? "portfolio" : "well"}_report_${exportTimestamp()}.pdf`;
  doc.save(filename);
  return filename;
}
