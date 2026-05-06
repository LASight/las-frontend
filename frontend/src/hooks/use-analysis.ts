import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { statusMeta } from "../controllers/format-controller";
import type { AnalyzePayload, ValidationDecision } from "../models/analyze-models";
import {
  analyzeSamples,
  analyzeUploads,
  fetchAiInterpretation,
} from "../services/api-service";
import { useFileValidation } from "./use-file-validation";

type Options = {
  onNewAnalysis?: (payload: AnalyzePayload) => void;
};

export function useAnalysis(options: Options = {}) {
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
    setStatus(`Completed analysis for ${nextPayload.portfolio_summary?.well_count ?? 0} wells.`);
  }

  async function runSampleAnalysis() {
    const nextPayload = await sampleMutation.mutateAsync();
    await handlePostAnalyze(nextPayload);
  }

  async function runUploadAnalysis() {
    if (!fileList || fileList.length === 0) {
      setStatus("Select one or more LAS files first.");
      return;
    }
    fileValidation.reset();
    setStatus("Validating files...");
    await fileValidation.validate(fileList);
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
    fileValidation,
    isBusy: sampleMutation.isPending || uploadMutation.isPending || fileValidation.state === "validating",
  };
}
