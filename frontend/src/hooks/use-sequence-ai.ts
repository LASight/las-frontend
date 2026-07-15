import { useState } from "react";

import { statusMeta } from "../controllers/format-controller";
import type { WellReport } from "../models/analyze-models";
import { fetchChatAnswer } from "../services/api-service";

const DEFAULT_TEXT = "Run analysis and click AI Autocomplete Suggestions.";

type SuggestParams = {
  analysisId: string | null;
  aiEnabled: boolean;
  selectedWell: string;
  selectedReport: WellReport | null;
  threshold: number;
  /** Sequence-studio status setter (sequence.setStatus). */
  onStatus: (message: string) => void;
  /** Global app status setter (analysis.setStatus). */
  onAnalysisStatus: (message: string) => void;
};

/**
 * Owns the sequence-stratigraphy AI-suggestion flow: prompt construction, the
 * `fetchChatAnswer` call, and the resulting text/meta/loading state. Keeps this
 * business logic out of the view layer (SRP).
 */
export function useSequenceAi() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [meta, setMeta] = useState("Source: N/A");
  const [loading, setLoading] = useState(false);

  function resetForAnalysis() {
    setText(DEFAULT_TEXT);
    setMeta("Source: N/A");
  }

  async function suggest({
    analysisId,
    aiEnabled,
    selectedWell,
    selectedReport,
    threshold,
    onStatus,
    onAnalysisStatus,
  }: SuggestParams) {
    if (!analysisId || !selectedWell || !selectedReport) {
      onStatus("Run analysis and select a sequence-ready well first.");
      return;
    }

    const seq = selectedReport.sequence_stratigraphy;
    if (!seq) {
      onStatus("Sequence data not available for selected well.");
      return;
    }

    const prompt = [
      `Provide sequence-stratigraphy autocomplete suggestions for well ${selectedWell}.`,
      "Focus on which auto-picked boundaries should be accepted/rejected and where manual boundaries may be required.",
      "Return concise sections: Accepted, Rejected, Add-manual, and Rationale.",
      `Curve used: ${seq.source_curve || "N/A"}.`,
      `Auto boundaries: ${JSON.stringify((seq.boundaries_auto || []).slice(0, 15))}`,
      `Intervals: ${JSON.stringify((seq.intervals_auto || []).slice(0, 20))}`,
      `Confidence threshold in UI: ${threshold.toFixed(2)}`,
    ].join("\n");

    setLoading(true);
    setMeta("Source: pending | Generating sequence suggestions...");
    setText("");

    try {
      const response = await fetchChatAnswer(analysisId, prompt, [], aiEnabled);
      setText(response.answer || "No sequence suggestions returned.");
      setMeta(statusMeta(response.meta));
      onStatus("AI suggestions generated. Review before accepting.");
      onAnalysisStatus("Sequence AI suggestions ready.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI suggestion error";
      setText(`Error: ${message}`);
      setMeta(`Source: error | ${message}`);
      onStatus(`Error: ${message}`);
      onAnalysisStatus(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  return { text, meta, loading, resetForAnalysis, suggest };
}
