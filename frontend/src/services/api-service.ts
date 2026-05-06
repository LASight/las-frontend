import type { AiResponse, AnalyzePayload, ChatResponse, PreValidatePayload, ValidationDecision } from "../models/analyze-models";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function analyzeSamples(): Promise<AnalyzePayload> {
  return apiRequest<AnalyzePayload>("/api/analyze-samples?with_ai=false", {
    method: "POST",
  });
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

export async function fetchAiInterpretation(analysisId: string, withAi: boolean): Promise<AiResponse> {
  return apiRequest<AiResponse>("/api/ai-interpretation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis_id: analysisId,
      with_ai: withAi,
    }),
  });
}

export async function fetchChatAnswer(
  analysisId: string,
  question: string,
  history: Array<{ role: string; content: string }>,
  withAi: boolean
): Promise<ChatResponse> {
  return apiRequest<ChatResponse>("/api/chat-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis_id: analysisId,
      question,
      history,
      with_ai: withAi,
    }),
  });
}
