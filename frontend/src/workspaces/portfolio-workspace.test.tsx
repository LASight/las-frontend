import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzePayload, FileValidationReport } from "../models/analyze-models";
import { PortfolioWorkspace } from "./portfolio-workspace";

const api = vi.hoisted(() => ({ fetchAnalysis: vi.fn(), fetchAiInterpretation: vi.fn(), analyzeUploads: vi.fn(), preValidateFiles: vi.fn(), analyzeSamples: vi.fn() }));
vi.mock("../services/api-service", () => api);
vi.mock("../app-shell-context", () => ({ SidebarPanel: () => null, useAppShell: () => ({ collapsed: false }), useShellStatus: vi.fn() }));
vi.mock("../hooks/use-chat", () => ({ useChat: () => ({ resetForAnalysis: vi.fn(), messages: [] }) }));
vi.mock("../hooks/use-report-export", () => ({ useReportExport: () => ({}) }));
vi.mock("../components/analysis/analysis-sidebar-panel", () => ({ AnalysisSidebarPanel: () => null }));
vi.mock("../components/assistant-drawer", () => ({ AssistantDrawer: () => null }));
vi.mock("../components/overview/portfolio-overview", () => ({ PortfolioOverview: () => <div data-testid="analytics">Existing analytics</div> }));
vi.mock("../components/comparison/well-log-comparison", () => ({ WellLogComparison: ({ analysisId }: { analysisId: string }) => <div data-testid="logs">Logs for {analysisId}</div> }));
vi.mock("../services/history-service", () => ({ historyGateway: { list: async () => ({ items: [
  { item_id: "one", label: "Portfolio one", file_count: 2, state: "done" },
  { item_id: "two", label: "Portfolio two", file_count: 3, state: "done" },
  { item_id: "single", label: "Single well", file_count: 1, state: "done" },
  { item_id: "failed", label: "Failed portfolio", file_count: 2, state: "failed" },
] }) } }));

const payload = (id: string): AnalyzePayload => ({ analysis_id: id, wells: [{ well_name: "Well A", file_name: "a.las", tracks: {} }, { well_name: "Well B", file_name: "b.las", tracks: {} }] }) as AnalyzePayload;
const validation = (file_name: string, can_proceed = true): FileValidationReport => ({
  file_name, well_name: file_name, can_proceed, las_version: "2.0", depth_range: [100, 102], depth_unit: "FT", depth_curve: "DEPT",
  available_curves: ["DEPT", "GR"], null_value: -999.25, curve_count: 2, row_count: 3, curves: [], issues: [], parsing_warnings: [],
});

describe("comparison portfolio workflow and persistent URL identity", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  let router: ReturnType<typeof createMemoryRouter>;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); api.fetchAnalysis.mockImplementation(async (id: string) => payload(id));
    api.fetchAiInterpretation.mockResolvedValue({ ai_interpretation: "Fixture interpretation", ai_meta: { source: "fixture" } });
    api.analyzeUploads.mockResolvedValue(payload("new-upload"));
    api.preValidateFiles.mockResolvedValue({ files: [validation("a.las"), validation("b.las")] });
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); router?.dispose(); client.clear(); host.remove(); });
  async function mount(url = "/portfolio") {
    router = createMemoryRouter([{ path: "/portfolio", element: <PortfolioWorkspace /> }], { initialEntries: [url] });
    await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  async function button(text: string) {
    const element = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
    expect(element).toBeDefined(); await act(async () => element.click());
  }
  async function files(names: string[]) {
    const input = host.querySelector('input[aria-label="Choose LAS files"]')!;
    const selectedFiles = names.map(name => new File(["LAS fixture"], name));
    Object.defineProperty(input, "files", { configurable: true, value: selectedFiles });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    return selectedFiles;
  }

  it("cold-loads once, retains analysis/tab/other query parameters and rehydrates after reload", async () => {
    await mount("/portfolio?analysis=one&view=analytics&context=qa");
    expect(host.querySelector('[data-testid="analytics"]')).not.toBeNull();
    expect(router.state.location.search).toBe("?analysis=one&view=analytics&context=qa");
    expect(api.fetchAnalysis.mock.calls).toEqual([["one"]]); expect(api.fetchAiInterpretation).toHaveBeenCalledTimes(1);
    expect([...host.querySelectorAll("option")].some(option => option.value === "single")).toBe(false);
    expect([...host.querySelectorAll("option")].some(option => option.value === "failed")).toBe(false);
    await button("Well logs"); expect(host.querySelector('[data-testid="logs"]')?.textContent).toContain("one");
    expect(api.fetchAnalysis).toHaveBeenCalledTimes(1); expect(api.fetchAiInterpretation).toHaveBeenCalledTimes(1);
    const select = host.querySelector('select[aria-label="Saved portfolio"]')! as HTMLSelectElement;
    await act(async () => { select.value = "two"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(router.state.location.search).toBe("?analysis=two&view=logs&context=qa");
    expect(api.fetchAnalysis.mock.calls).toEqual([["one"], ["two"]]); expect(api.fetchAiInterpretation).toHaveBeenCalledTimes(2);
    const reload = `${router.state.location.pathname}${router.state.location.search}`;
    await act(async () => root.unmount()); router.dispose(); root = createRoot(host);
    await mount(reload);
    expect(router.state.location.search).toBe("?analysis=two&view=logs&context=qa");
    expect(api.fetchAnalysis.mock.calls).toEqual([["one"], ["two"], ["two"]]); expect(api.fetchAiInterpretation).toHaveBeenCalledTimes(3);
    expect((host.querySelector('select[aria-label="Saved portfolio"]') as HTMLSelectElement).value).toBe("two");
  });

  it("requires two chosen files and runs the existing validation/confirmation pipeline before analysis", async () => {
    await mount("/portfolio?view=analytics&context=qa");
    const prepare = () => [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === "Prepare comparison")!;
    expect(prepare().disabled).toBe(true);
    await files(["a.las"]); expect(prepare().disabled).toBe(true); expect(host.textContent).toContain("Choose at least two LAS files");
    const selected = await files(["a.las", "b.las"]); expect(prepare().disabled).toBe(false);
    expect(host.querySelector('[aria-label="Chosen LAS files"]')?.textContent).toContain("b.las");
    await button("Prepare comparison");
    expect(api.preValidateFiles).toHaveBeenCalledWith(selected); expect(api.analyzeUploads).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("File Validation");
    await button("Analyze 2 files");
    expect(api.analyzeUploads).toHaveBeenCalledWith(selected, [
      expect.objectContaining({ file_name: "a.las", proceed: true, sort_depth: false }),
      expect.objectContaining({ file_name: "b.las", proceed: true, sort_depth: false }),
    ]);
    expect(router.state.location.search).toBe("?view=analytics&context=qa&analysis=new-upload");
    expect(host.querySelector('[data-testid="analytics"]')).not.toBeNull();
    expect(api.fetchAnalysis).not.toHaveBeenCalled(); expect(api.fetchAiInterpretation).toHaveBeenCalledTimes(1);
  });

  it("shows failed validation and chosen filenames rather than a blank page", async () => {
    api.preValidateFiles.mockRejectedValueOnce(new Error("Invalid LAS fixture"));
    await mount(); await files(["a.las", "b.las"]); await button("Prepare comparison");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Error: Invalid LAS fixture");
    expect(host.querySelector('[aria-label="Chosen LAS files"]')?.textContent).toBe("a.lasb.las");
    expect(api.analyzeUploads).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps failed adoption identity and an actionable upload empty state", async () => {
    api.fetchAnalysis.mockRejectedValueOnce(new Error("Saved portfolio unavailable"));
    await mount("/portfolio?analysis=missing&view=logs");
    expect(router.state.location.search).toBe("?analysis=missing&view=logs");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Error: Saved portfolio unavailable");
    expect(host.querySelector('input[aria-label="Choose LAS files"]')).not.toBeNull();
    expect(api.fetchAnalysis).toHaveBeenCalledTimes(1); expect(api.fetchAiInterpretation).not.toHaveBeenCalled();
  });

  it("never bypasses a blocked validation report", async () => {
    api.preValidateFiles.mockResolvedValueOnce({ files: [validation("a.las", false), validation("b.las", false)] });
    await mount(); await files(["a.las", "b.las"]); await button("Prepare comparison");
    const blocked = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === "No files can proceed")!;
    expect(blocked.disabled).toBe(true); expect(api.analyzeUploads).not.toHaveBeenCalled();
    await button("Cancel"); expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Cancelled.");
  });

  it("keeps B's URL and logs when a superseded A load arrives last", async () => {
    let resolveA!: (value: AnalyzePayload) => void;
    api.fetchAnalysis.mockImplementation((id: string) => id === "one"
      ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(payload(id)));
    await mount("/portfolio?analysis=one&view=logs&context=qa");
    expect((host.querySelector('[aria-label="Saved portfolio"]') as HTMLSelectElement).disabled).toBe(true);
    // Browser back/forward or a deep link can supersede a disabled selector.
    await act(async () => { await router.navigate("/portfolio?analysis=two&view=logs&context=qa"); });
    await act(async () => resolveA(payload("one")));
    expect(router.state.location.search).toBe("?analysis=two&view=logs&context=qa");
    expect(host.querySelector('[data-testid="logs"]')?.textContent).toBe("Logs for two");
    expect(api.fetchAiInterpretation.mock.calls.map(([id]) => id)).toEqual(["two"]);
  });
});
