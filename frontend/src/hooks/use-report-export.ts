import { useState } from "react";

import { exportCsvReport, exportPdfReport } from "../controllers/export-controller";
import type { AnalyzePayload } from "../models/analyze-models";

type Options = {
  getPayload: () => AnalyzePayload | null;
  onStatus: (message: string) => void;
};

/**
 * Owns CSV/PDF report export: the async PDF loading flag and the handlers that
 * wrap the export controller. Keeps export orchestration out of the view (SRP).
 */
export function useReportExport({ getPayload, onStatus }: Options) {
  const [exportingPdf, setExportingPdf] = useState(false);

  function exportCsv() {
    const payload = getPayload();
    if (!payload) {
      onStatus("No analysis results available for export.");
      return;
    }
    const filename = exportCsvReport(payload);
    onStatus(`CSV export generated (${filename}).`);
  }

  async function exportPdf() {
    const payload = getPayload();
    if (!payload) {
      onStatus("No analysis results available for export.");
      return;
    }

    setExportingPdf(true);
    try {
      const filename = await exportPdfReport(payload);
      onStatus(`PDF export generated (${filename}).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF export failed";
      onStatus(`Error: ${message}`);
    } finally {
      setExportingPdf(false);
    }
  }

  return { exportingPdf, exportCsv, exportPdf };
}
