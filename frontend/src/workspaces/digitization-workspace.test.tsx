import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShellProvider } from "../app-shell-context";
import { useJobController } from "../components/digitization/job-context";
import { jobQueryKey } from "../hooks/use-digitization-job";
import { segmentJob } from "../test-fixtures/collection-fixtures";
import { DigitizationWorkspace } from "./digitization-workspace";

vi.mock("../services/digitization-service", () => ({
  IS_MOCK_GATEWAY: false,
  digitizationGateway: { getJob: vi.fn(async (id: string) => segmentJob(id)) },
}));
vi.mock("../services/collection-service", () => ({ collectionGateway: { get: vi.fn() } }));

function StepProbe() {
  const { job } = useJobController();
  const [draft, setDraft] = useState("");
  return <><span data-testid="step-job">{job?.job_id}</span>
    <input aria-label="Step-local draft" value={draft} onChange={(e) => setDraft(e.target.value)} /></>;
}

describe("wizard navigation between independent jobs", () => {
  it("keeps a single segment panel and remounts only the step when the job changes", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    for (const id of ["first", "second"]) client.setQueryData(jobQueryKey(id), { ...segmentJob(id), collection_id: null });
    const router = createMemoryRouter([{
      path: "/digitize/:jobId", element: <DigitizationWorkspace />,
      children: [{ path: "review", element: <StepProbe /> }, { path: "crop", element: <StepProbe /> }],
    }], { initialEntries: ["/digitize/first/review"] });
    try {
      await act(async () => root.render(<QueryClientProvider client={client}>
        <AppShellProvider value={{ sidebarSlot: null, collapsed: false, setStatus: () => {}, setBusy: () => {} }}>
          <RouterProvider router={router} />
        </AppShellProvider>
      </QueryClientProvider>));
      expect(host.querySelectorAll("#collection-title")).toHaveLength(1);
      await act(async () => { await router.navigate("/digitize/second/crop"); });
      expect(host.querySelectorAll("#collection-title")).toHaveLength(1);
      expect(host.querySelectorAll('[data-testid="step-job"]')).toHaveLength(1);
      expect(host.querySelector('[data-testid="step-job"]')?.textContent).toBe("second");
      expect(host.querySelectorAll('input[aria-label="Step-local draft"]')).toHaveLength(1);
      await act(async () => { await router.navigate("/digitize/first/review"); });
      expect(host.querySelectorAll("#collection-title")).toHaveLength(1);
      expect(host.querySelector('[data-testid="step-job"]')?.textContent).toBe("first");
      expect(errors.mock.calls.some(args => args.some(x => String(x).includes("same key")))).toBe(false);
    } finally {
      await act(async () => root.unmount());
      router.dispose(); client.clear(); host.remove(); errors.mockRestore();
    }
  });
});
