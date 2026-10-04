import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AnalysisWorkspace } from "./analysis-workspace";

const { adopted } = vi.hoisted(() => ({ adopted: vi.fn() }));
vi.mock("../hooks/use-analysis", async () => {
  const { useState } = await import("react");
  type Payload = { analysis_id: string; wells: { well_name: string }[] };
  return { useAnalysis: (options: { onNewAnalysis?: (payload: Payload) => void }) => {
    const [payload, setPayload] = useState<Payload | null>(null);
    return { payload, status: "Ready", isBusy: false, aiEnabled: false, aiText: "", aiMeta: "", aiLoading: false,
      fileValidation: { state: "idle" }, setStatus: vi.fn(),
      adoptAnalysis: async (id: string) => {
        adopted(id);
        const next = { analysis_id: id, wells: [{ well_name: id }] };
        setPayload(next); options.onNewAnalysis?.(next);
      },
    };
  } };
});
vi.mock("../app-shell-context", () => ({ SidebarPanel: () => null, useAppShell: () => ({ collapsed: false }), useShellStatus: vi.fn() }));
vi.mock("../hooks/use-sequence-review", () => ({ useSequenceReview: () => ({ resetForAnalysis: vi.fn() }) }));
vi.mock("../hooks/use-sequence-ai", () => ({ useSequenceAi: () => ({ resetForAnalysis: vi.fn() }) }));
vi.mock("../hooks/use-chat", () => ({ useChat: () => ({ resetForAnalysis: vi.fn(), messages: [] }) }));
vi.mock("../hooks/use-report-export", () => ({ useReportExport: () => ({}) }));
vi.mock("../components/analysis/analysis-sidebar-panel", () => ({ AnalysisSidebarPanel: () => null }));
vi.mock("../components/assistant-drawer", () => ({ AssistantDrawer: () => null }));
vi.mock("../components/overview/overview-tab", () => ({ OverviewTab: () => null }));
vi.mock("../components/sequence/sequence-tab", () => ({ SequenceTab: () => null }));
vi.mock("../services/history-service", () => ({ historyGateway: { list: async () => ({ items: ["one", "two"].map(id => ({
  item_id: id, kind: "las", label: id, state: "done", file_count: 1, created_at: "2026-10-03T00:00:00Z",
})) }) } }));

describe("saved analysis URL identity", () => {
  it("retains handoff identity across remount, selector changes and sequence links without duplicate adoption", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    adopted.mockClear();
    const host = document.createElement("div"); document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const routes = [{ path: "/analysis", element: <AnalysisWorkspace /> }, { path: "/analysis/sequence", element: <AnalysisWorkspace /> }];
    let root = createRoot(host);
    let router = createMemoryRouter(routes, { initialEntries: ["/analysis?analysis=one"] });
    async function render() {
      await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    }
    try {
      await render();
      expect(router.state.location.search).toBe("?analysis=one");
      expect(adopted.mock.calls).toEqual([["one"]]);
      const link = [...host.querySelectorAll("a")].find(a => a.textContent === "Sequence Stratigraphy");
      expect(link?.getAttribute("href")).toBe("/analysis/sequence?analysis=one");
      const select = host.querySelector("select")!;
      await act(async () => { select.value = "two"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(router.state.location.search).toBe("?analysis=two");
      expect(adopted.mock.calls).toEqual([["one"], ["two"]]);
      await act(async () => root.unmount()); router.dispose();
      root = createRoot(host);
      router = createMemoryRouter(routes, { initialEntries: ["/analysis/sequence?analysis=two"] });
      await render();
      expect(router.state.location.pathname).toBe("/analysis/sequence");
      expect(router.state.location.search).toBe("?analysis=two");
      expect(adopted.mock.calls).toEqual([["one"], ["two"], ["two"]]);
      expect(host.querySelector("select")?.value).toBe("two");
    } finally {
      await act(async () => root.unmount()); router.dispose(); client.clear(); host.remove();
    }
  });
});
