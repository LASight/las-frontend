import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { statusMeta } from "../controllers/format-controller";
import type { AnalyzePayload, ValidationDecision } from "../models/analyze-models";
import {
  analyzeSamples,
  analyzeUploads,
  fetchAiInterpretation,
  fetchAnalysis,
} from "../services/api-service";
import { useFileValidation } from "./use-file-validation";

type Options = {
  scope?: "single" | "portfolio";
  onNewAnalysis?: (payload: AnalyzePayload) => void;
};

export function useAnalysis(options: Options = {}) {
  const scope = options.scope ?? "single";
  const [payload, setPayload] = useState<AnalyzePayload | null>(null);
  const [status, setStatus] = useState("Ready.");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiMeta, setAiMeta] = useState("Source: N/A");
  const [fileList, setFileList] = useState<FileList | null>(null);
  const fileValidation = useFileValidation();

  const sampleMutation = useMutation({
    mutationFn: async () => analyzeSamples(),
    onMutate: () => setStatus("Running sample multi-well analysis..."),
    onError: (err: Error) => setStatus(`Error: ${err.message}`),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ files, decisions }: { files: FileList; decisions?: ValidationDecision[] }) =>
      analyzeUploads(files, decisions),
    onMutate: () => setStatus("Uploading files and running analysis..."),
    onError: (err: Error) => setStatus(`Error: ${err.message}`),
  });

  async function handlePostAnalyze(nextPayload: AnalyzePayload) {
    setPayload(nextPayload);
    options.onNewAnalysis?.(nextPayload);

    if (aiEnabled && nextPayload.analysis_id) {
      setAiLoading(true);
      setAiMeta("Source: pending | Generating interpretation...");
      setAiText("");
      try {
        const resp = await fetchAiInterpretation(nextPayload.analysis_id, true);
        setAiText(resp.ai_interpretation || "No AI interpretation.");
        setAiMeta(statusMeta(resp.ai_meta));
        setStatus("AI interpretation ready.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI interpretation failed.";
        setAiText("AI interpretation failed.");
        setAiMeta(`Source: error | ${msg}`);
        setStatus(`Error: ${msg}`);
      } finally {
        setAiLoading(false);
      }
      return;
    }

    setAiLoading(false);
    setAiText("AI interpretation disabled by toggle.");
    setAiMeta("Source: heuristic | AI disabled");
    const wellCount = nextPayload.portfolio_summary?.well_count ?? nextPayload.wells?.length ?? 0;
    setStatus(
      scope === "portfolio"
        ? `Completed portfolio analysis for ${wellCount} wells.`
        : "Completed well analysis."
    );
  }

  async function runSampleAnalysis() {
    if (scope !== "portfolio") {
      setStatus("Sample portfolios are available in Portfolio Analytics.");
      return;
    }
    const nextPayload = await sampleMutation.mutateAsync();
    await handlePostAnalyze(nextPayload);
  }

  async function runUploadAnalysis() {
    const requiredFiles = scope === "portfolio" ? 2 : 1;
    if (!fileList || fileList.length < requiredFiles) {
      setStatus(
        scope === "portfolio"
          ? "Select at least two LAS files for portfolio analysis."
          : "Select one LAS file first."
      );
      return;
    }
    if (scope === "single" && fileList.length !== 1) {
      setStatus("LAS Analysis accepts one well at a time.");
      return;
    }
    fileValidation.reset();
    setStatus("Validating files...");
    await fileValidation.validate(fileList);
  }

  /**
   * Load an analysis the backend has already run, by id.
   *
   * The digitization workspace's handoff: it exports a LAS, the backend
   * analyzes it and returns an id, and this picks the result up so the user
   * lands on the Overview tab instead of re-uploading the file they just
   * produced.
   */
  async function adoptAnalysis(analysisId: string) {
    setStatus(scope === "portfolio" ? "Loading saved portfolio..." : "Loading saved well...");
    try {
      await handlePostAnalyze(await fetchAnalysis(analysisId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load analysis.";
      setStatus(`Error: ${message}`);
    }
  }

  async function proceedWithAnalysis(decisions: ValidationDecision[]) {
    if (!fileList) return;
    fileValidation.reset();
    const nextPayload = await uploadMutation.mutateAsync({ files: fileList, decisions });
    await handlePostAnalyze(nextPayload);
  }

  return {
    payload,
    status,
    setStatus,
    aiEnabled,
    aiLoading,
    aiText,
    aiMeta,
    fileList,
    setFileList,
    setAiEnabled,
    runSampleAnalysis,
    runUploadAnalysis,
    proceedWithAnalysis,
    adoptAnalysis,
    fileValidation,
    isBusy: sampleMutation.isPending || uploadMutation.isPending || fileValidation.state === "validating",
  };
}
