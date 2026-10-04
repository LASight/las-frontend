import { useEffect, useRef, useState } from "react";
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
import { getSessionScope, isCurrentSession, type SessionScope } from "../services/session-scope";

type Options = {
  scope?: "single" | "portfolio";
  onNewAnalysis?: (payload: AnalyzePayload) => void;
};

export function useAnalysis(options: Options = {}) {
  const scope = options.scope ?? "single";
  const [payload, setPayload] = useState<AnalyzePayload | null>(null);
  const [status, setStatus] = useState("Ready.");
  const [aiEnabled, setAiEnabledState] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiMeta, setAiMeta] = useState("Source: N/A");
  const [fileList, setFileList] = useState<FileList | null>(null);
  const fileValidation = useFileValidation();
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const generation = useRef(0);
  const aiGeneration = useRef(0);
  const mounted = useRef(true);
  const aiEnabledRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; aiGeneration.current++; };
  }, []);
  type Run = { generation: number; session: SessionScope };
  const isCurrent = (run: Run) => mounted.current && generation.current === run.generation && isCurrentSession(run.session);
  function begin(message: string): Run {
    const run = { generation: ++generation.current, session: getSessionScope() };
    fileValidation.reset();
    aiGeneration.current++;
    setLoadingAnalysis(true);
    setAiLoading(false);
    setAiText("");
    setAiMeta("Source: N/A");
    setStatus(message);
    return run;
  }
  function setAiEnabled(enabled: boolean) {
    aiEnabledRef.current = enabled;
    setAiEnabledState(enabled);
    if (!enabled) {
      aiGeneration.current++;
      setAiLoading(false);
      setAiText("AI interpretation disabled by toggle.");
      setAiMeta("Source: heuristic | AI disabled");
    }
  }

  const sampleMutation = useMutation({
    mutationFn: async () => analyzeSamples(),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ files, decisions }: { files: FileList; decisions?: ValidationDecision[] }) =>
      analyzeUploads(files, decisions),
  });

  async function handlePostAnalyze(nextPayload: AnalyzePayload, run: Run) {
    if (!isCurrent(run)) return;
    setPayload(nextPayload);
    setLoadingAnalysis(false);
    optionsRef.current.onNewAnalysis?.(nextPayload);

    if (aiEnabledRef.current && nextPayload.analysis_id) {
      const aiRequest = ++aiGeneration.current;
      const currentAi = () => isCurrent(run) && aiEnabledRef.current && aiGeneration.current === aiRequest;
      setAiLoading(true);
      setAiMeta("Source: pending | Generating interpretation...");
      setAiText("");
      try {
        const resp = await fetchAiInterpretation(nextPayload.analysis_id, true);
        if (!currentAi()) return;
        setAiText(resp.ai_interpretation || "No AI interpretation.");
        setAiMeta(statusMeta(resp.ai_meta));
        setStatus("AI interpretation ready.");
      } catch (err) {
        if (!currentAi()) return;
        const msg = err instanceof Error ? err.message : "AI interpretation failed.";
        setAiText("AI interpretation failed.");
        setAiMeta(`Source: error | ${msg}`);
        setStatus(`Error: ${msg}`);
      } finally {
        if (currentAi()) setAiLoading(false);
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
      setStatus("Sample portfolios are available in Compare wells.");
      return;
    }
    const run = begin("Running sample multi-well analysis...");
    try { await handlePostAnalyze(await sampleMutation.mutateAsync(), run); }
    catch (err) { if (isCurrent(run)) setStatus(`Error: ${err instanceof Error ? err.message : "Analysis failed."}`); }
    finally { if (isCurrent(run)) setLoadingAnalysis(false); }
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
    const run = begin("Validating files...");
    try { await fileValidation.validate(fileList); }
    finally { if (isCurrent(run)) setLoadingAnalysis(false); }
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
    const run = begin(scope === "portfolio" ? "Loading saved portfolio..." : "Loading saved well...");
    // Never label the previous payload as the newly selected saved analysis.
    setPayload(null);
    try {
      await handlePostAnalyze(await fetchAnalysis(analysisId), run);
    } catch (err) {
      if (!isCurrent(run)) return;
      const message = err instanceof Error ? err.message : "Could not load analysis.";
      setStatus(`Error: ${message}`);
    } finally {
      if (isCurrent(run)) setLoadingAnalysis(false);
    }
  }

  async function proceedWithAnalysis(decisions: ValidationDecision[]) {
    if (!fileList) return;
    const run = begin("Uploading files and running analysis...");
    try { await handlePostAnalyze(await uploadMutation.mutateAsync({ files: fileList, decisions }), run); }
    catch (err) { if (isCurrent(run)) setStatus(`Error: ${err instanceof Error ? err.message : "Analysis failed."}`); }
    finally { if (isCurrent(run)) setLoadingAnalysis(false); }
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
    isBusy: loadingAnalysis || aiLoading || sampleMutation.isPending || uploadMutation.isPending || fileValidation.state === "validating",
  };
}
