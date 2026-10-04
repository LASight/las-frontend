import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzePayload } from "../models/analyze-models";
import { endAccountSession, setSessionAccount } from "../services/session-scope";
import { useAnalysis } from "./use-analysis";

const api = vi.hoisted(() => ({ fetchAnalysis: vi.fn(), fetchAiInterpretation: vi.fn(), analyzeUploads: vi.fn(), analyzeSamples: vi.fn(), preValidateFiles: vi.fn() }));
vi.mock("../services/api-service", () => api);
const payload = (id: string) => ({ analysis_id: id, wells: [] }) as unknown as AnalyzePayload;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let analysis: ReturnType<typeof useAnalysis>;
const publish = vi.fn();
function Probe() { analysis = useAnalysis({ scope: "portfolio", onNewAnalysis: publish }); return null; }

describe("analysis request identity (software fixtures, no scientific evidence)", () => {
  let root: Root, client: QueryClient;
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); setSessionAccount("account-a");
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(document.createElement("div"));
    api.fetchAiInterpretation.mockResolvedValue({ ai_interpretation: "Current narrative", ai_meta: {} });
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); });

  it("publishes only B when A's saved payload arrives last, and exposes adoption busy", async () => {
    const a = deferred<AnalyzePayload>(), b = deferred<AnalyzePayload>();
    api.fetchAnalysis.mockImplementation((id: string) => id === "a" ? a.promise : b.promise);
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = analysis.adoptAnalysis("a"); });
    expect(analysis.isBusy).toBe(true);
    await act(async () => { second = analysis.adoptAnalysis("b"); });
    await act(async () => { b.resolve(payload("b")); await second; });
    await act(async () => { a.resolve(payload("a")); await first; });
    expect(analysis.payload?.analysis_id).toBe("b");
    expect(publish.mock.calls.map(([value]) => value.analysis_id)).toEqual(["b"]);
    expect(api.fetchAiInterpretation).toHaveBeenCalledTimes(1);
    expect(analysis.status).toBe("AI interpretation ready.");
    expect(analysis.isBusy).toBe(false);
  });

  it("does not let A's failure replace B's status", async () => {
    const a = deferred<AnalyzePayload>();
    api.fetchAnalysis.mockImplementation((id: string) => id === "a" ? a.promise : Promise.resolve(payload("b")));
    let first!: Promise<void>;
    await act(async () => { first = analysis.adoptAnalysis("a"); });
    await act(async () => { await analysis.adoptAnalysis("b"); });
    await act(async () => { a.reject(new Error("Late A failure")); await first; });
    expect(analysis.status).toBe("AI interpretation ready.");
    expect(analysis.payload?.analysis_id).toBe("b");
  });

  it("does not attach A's late AI narrative or finally callback to B", async () => {
    const a = deferred<{ ai_interpretation: string }>(), b = deferred<{ ai_interpretation: string }>();
    api.fetchAnalysis.mockImplementation(async (id: string) => payload(id));
    api.fetchAiInterpretation.mockImplementation((id: string) => id === "a" ? a.promise : b.promise);
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = analysis.adoptAnalysis("a"); });
    await act(async () => { second = analysis.adoptAnalysis("b"); });
    await act(async () => { a.resolve({ ai_interpretation: "Wrong narrative for A" }); await first; });
    expect(analysis.payload?.analysis_id).toBe("b");
    expect(analysis.aiText).toBe(""); expect(analysis.aiLoading).toBe(true);
    await act(async () => { b.resolve({ ai_interpretation: "B narrative" }); await second; });
    expect(analysis.aiText).toBe("B narrative"); expect(analysis.aiLoading).toBe(false);
  });

  it.each(["success", "failure"])("ignores an AI %s after disabling the toggle, including re-enabling", async outcome => {
    const ai = deferred<{ ai_interpretation: string }>();
    api.fetchAnalysis.mockResolvedValue(payload("a")); api.fetchAiInterpretation.mockReturnValue(ai.promise);
    let run!: Promise<void>;
    await act(async () => { run = analysis.adoptAnalysis("a"); });
    await act(async () => analysis.setAiEnabled(false));
    const status = analysis.status;
    await act(async () => analysis.setAiEnabled(true));
    await act(async () => {
      if (outcome === "success") ai.resolve({ ai_interpretation: "Obsolete narrative" }); else ai.reject(new Error("Obsolete failure"));
      await run;
    });
    expect(analysis.aiText).toBe("AI interpretation disabled by toggle.");
    expect(analysis.aiLoading).toBe(false); expect(analysis.status).toBe(status);
  });

  it("uses the live disabled toggle while a saved payload is still loading", async () => {
    const saved = deferred<AnalyzePayload>(); api.fetchAnalysis.mockReturnValue(saved.promise);
    let run!: Promise<void>;
    await act(async () => { run = analysis.adoptAnalysis("a"); });
    await act(async () => analysis.setAiEnabled(false));
    await act(async () => { saved.resolve(payload("a")); await run; });
    expect(analysis.payload?.analysis_id).toBe("a"); expect(api.fetchAiInterpretation).not.toHaveBeenCalled();
  });

  it("ignores a sample result superseded by saved adoption", async () => {
    const sample = deferred<AnalyzePayload>(); api.analyzeSamples.mockReturnValue(sample.promise);
    api.fetchAnalysis.mockResolvedValue(payload("b"));
    let run!: Promise<void>;
    await act(async () => { run = analysis.runSampleAnalysis(); });
    await act(async () => { await analysis.adoptAnalysis("b"); });
    await act(async () => { sample.resolve(payload("sample")); await run; });
    expect(analysis.payload?.analysis_id).toBe("b"); expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"])("ignores an upload %s superseded by saved adoption", async outcome => {
    const upload = deferred<AnalyzePayload>(); api.analyzeUploads.mockReturnValue(upload.promise);
    api.fetchAnalysis.mockResolvedValue(payload("b"));
    await act(async () => analysis.setFileList([new File(["fixture"], "a.las"), new File(["fixture"], "b.las")] as unknown as FileList));
    let run!: Promise<void>;
    await act(async () => { run = analysis.proceedWithAnalysis([]); });
    await act(async () => { await analysis.adoptAnalysis("b"); });
    await act(async () => {
      if (outcome === "success") upload.resolve(payload("upload")); else upload.reject(new Error("Late upload failure"));
      await run;
    });
    expect(analysis.payload?.analysis_id).toBe("b"); expect(publish).toHaveBeenCalledTimes(1);
    expect(analysis.status).toBe("AI interpretation ready.");
  });

  it("does not publish work completed after account switch", async () => {
    const saved = deferred<AnalyzePayload>(); api.fetchAnalysis.mockReturnValue(saved.promise);
    let run!: Promise<void>;
    await act(async () => { run = analysis.adoptAnalysis("a"); });
    endAccountSession(); setSessionAccount("account-b");
    await act(async () => { saved.resolve(payload("a")); await run; });
    expect(analysis.payload).toBeNull(); expect(publish).not.toHaveBeenCalled();
    expect(api.fetchAiInterpretation).not.toHaveBeenCalled();
  });

  it("does not reopen an old upload validation dialog after saved adoption", async () => {
    const validation = deferred<{ files: [] }>(); api.preValidateFiles.mockReturnValue(validation.promise);
    api.fetchAnalysis.mockResolvedValue(payload("b"));
    await act(async () => analysis.setFileList([new File(["fixture"], "a.las"), new File(["fixture"], "b.las")] as unknown as FileList));
    let run!: Promise<void>;
    await act(async () => { run = analysis.runUploadAnalysis(); });
    await act(async () => { await analysis.adoptAnalysis("b"); });
    await act(async () => { validation.resolve({ files: [] }); await run; });
    expect(analysis.fileValidation.state).toBe("idle"); expect(analysis.fileValidation.validationPayload).toBeNull();
    expect(analysis.payload?.analysis_id).toBe("b"); expect(analysis.status).toBe("AI interpretation ready.");
  });
});
