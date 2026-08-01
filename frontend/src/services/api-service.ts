import type {
  AiResponse,
  AnalyzePayload,
  ChatResponse,
  PreValidatePayload,
  ValidationDecision,
} from "../models/analyze-models";
import { apiRequest, postJson } from "./http-client";

export async function analyzeSamples(): Promise<AnalyzePayload> {
  return apiRequest<AnalyzePayload>("/api/analyze-samples?with_ai=false", {
    method: "POST",
  });
}

/**
 * Re-fetch a completed analysis by id.
 *
 * Used when the digitization workspace hands over a freshly exported LAS: the
 * backend has already run the analysis, so the user should land on the results
 * rather than re-upload the file they just produced.
 */
export async function fetchAnalysis(analysisId: string): Promise<AnalyzePayload> {
  return apiRequest<AnalyzePayload>(`/api/analyses/${analysisId}`);
}

export async function preValidateFiles(files: FileList | File[]): Promise<PreValidatePayload> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append("files", file);
  }
  return apiRequest<PreValidatePayload>("/api/pre-validate", {
    method: "POST",
    body: form,
  });
}

export async function analyzeUploads(
  files: FileList | File[],
  decisions?: ValidationDecision[]
): Promise<AnalyzePayload> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append("files", file);
  }
  if (decisions) {
    form.append("decisions", JSON.stringify(decisions));
  }
  return apiRequest<AnalyzePayload>("/api/analyze-files?with_ai=false", {
    method: "POST",
    body: form,
  });
}

export async function fetchAiInterpretation(
  analysisId: string,
  withAi: boolean
): Promise<AiResponse> {
  return postJson<AiResponse>("/api/ai-interpretation", {
    analysis_id: analysisId,
    with_ai: withAi,
  });
}

export async function fetchChatAnswer(
  analysisId: string,
  question: string,
  history: Array<{ role: string; content: string }>,
  withAi: boolean
): Promise<ChatResponse> {
  return postJson<ChatResponse>("/api/chat-data", {
    analysis_id: analysisId,
    question,
    history,
    with_ai: withAi,
  });
}
