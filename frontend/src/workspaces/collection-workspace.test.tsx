import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionQueryKey } from "../hooks/use-collection";
import { collectionGateway } from "../services/collection-service";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE, ApiError } from "../services/http-client";
import { collectionFixture } from "../test-fixtures/collection-fixtures";
import { CollectionWorkspace } from "./collection-workspace";
import routerSource from "../app-router.tsx?raw";

vi.mock("../app-shell-context", () => ({ useShellStatus: vi.fn() }));
vi.mock("../services/collection-service", () => ({ collectionGateway: {
  get: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn(), renameSegment: vi.fn(), detachSegment: vi.fn(),
} }));
vi.mock("../services/digitization-service", () => ({ digitizationGateway: { setEdits: vi.fn() } }));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let summary = collectionFixture();
function LocationProbe() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); }
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/digitize/collections/collection"]}>
    <LocationProbe /><Routes>
      <Route path="/digitize/collections/:collectionId" element={<CollectionWorkspace />} />
      <Route path="/digitize/:jobId/:step" element={<p>Individual job wizard</p>} />
      <Route path="/analysis" element={<p>Analysis destination</p>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>));
  await tick();
}
function button(label: string): HTMLButtonElement {
  const element = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(element).toBeDefined(); return element!;
}
async function click(label: string) {
  const element = button(label); expect(element.disabled).toBe(false);
  await act(async () => element.click()); await tick();
}
async function select(value: string, index = 0) {
  const element = host.querySelectorAll("select")[index];
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
  await tick();
}

describe("collection UI with HTTP fixtures, not scientific integration evidence", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); vi.clearAllMocks();
    summary = collectionFixture();
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(collectionGateway.get).mockImplementation(async () => structuredClone(summary));
    vi.mocked(collectionGateway.exportLas).mockResolvedValue({ text: "~Version\nTEST FIXTURE", fileName: "joined.las" });
    vi.mocked(collectionGateway.sendToAnalysis).mockResolvedValue({ analysis_id: "analysis-id", well_count: 1, file_name: "joined.las" });
    vi.mocked(digitizationGateway.setEdits).mockImplementation(async (id, edits, revision) => ({ ...summary.segments.find((segment) => segment.job_id === id)!.job, edits, edits_revision: (revision ?? 0) + 1 }));
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:test"); static revokeObjectURL = vi.fn(); });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("declares the collection route before the dynamic job route, outside job phase guards", () => {
    const collectionRoute = routerSource.indexOf('path: "digitize/collections/:collectionId"');
    const jobRoute = routerSource.indexOf('path: "digitize/:jobId"');
    expect(collectionRoute).toBeGreaterThan(0);
    expect(collectionRoute).toBeLessThan(jobRoute);
    expect(routerSource.slice(collectionRoute, jobRoute)).toContain("<CollectionWorkspace />");
    expect(routerSource.slice(collectionRoute, jobRoute)).not.toContain("RequireJobPhase");
  });

  it("lands on the collection route, starts with no default, and disables both outputs", async () => {
    await render();
    expect(host.textContent).toContain("Operator title");
    expect(host.textContent).not.toContain("Individual job wizard");
    expect(host.querySelector("select")!.value).toBe("");
    expect(button("Download combined LAS").disabled).toBe(true);
    expect(button("Analyze collection in LASight").disabled).toBe(true);
    expect(collectionGateway.exportLas).not.toHaveBeenCalled();
    expect((host.querySelector("#collection-header-well") as HTMLInputElement).value).toBe("");
  });
  it("downloads after explicit selection using fingerprint and conflict IDs", async () => {
    await render(); await select("second"); await click("Download combined LAS");
    expect(collectionGateway.exportLas).toHaveBeenCalledWith("collection", expect.objectContaining({
      overlap_choices: { "overlap-a": "second" }, expected_revision: "fingerprint-v1", step: 0.5,
      header: expect.objectContaining({ well: "" }),
    }));
    expect(host.textContent).toContain("Combined LAS preview");
    expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
  });
  it("requires a choice for every two-way or three-way conflict", async () => {
    summary.overlaps.push({ conflict_id: "triple", depth_top: 80, depth_bottom: 90, job_ids: ["first", "second", "third"] });
    summary.segments.push({ ...summary.segments[1], job_id: "third", label: "Third", job: { ...summary.segments[1].job, job_id: "third" } });
    await render(); await select("first");
    expect(button("Download combined LAS").disabled).toBe(true);
    await select("third", 1);
    expect(button("Download combined LAS").disabled).toBe(false);
  });
  it("refreshes a stale revision without retrying or losing unchanged conflict choices", async () => {
    await render(); await select("second");
    summary.revision = "fingerprint-v2";
    await click("Download combined LAS");
    expect(collectionGateway.exportLas).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Collection changed");
    expect(host.querySelector("select")!.value).toBe("second");
    await click("Download combined LAS");
    expect(collectionGateway.exportLas).toHaveBeenCalledTimes(1);
    expect(collectionGateway.exportLas).toHaveBeenCalledWith("collection", expect.objectContaining({ expected_revision: "fingerprint-v2" }));
  });
  it("refetches a backend 409 and requires a new choice when an interval changes", async () => {
    await render(); await select("second");
    vi.mocked(collectionGateway.exportLas).mockImplementationOnce(async () => {
      summary.revision = "fingerprint-v2"; summary.overlaps[0].depth_bottom = 95;
      throw new ApiError(409, "Stale collection revision");
    });
    await click("Download combined LAS"); await tick();
    expect(host.textContent).toContain("Stale collection revision");
    expect(host.querySelector("select")!.value).toBe("");
    expect(button("Download combined LAS").disabled).toBe(true);
    expect(collectionGateway.exportLas).toHaveBeenCalledTimes(1);
  });
  it("persists decisions as a collection-specific local draft across reload", async () => {
    await render(); await select("first");
    expect(JSON.parse(localStorage.getItem(`digitization-collection-draft:${API_BASE}:collection`)!).choices).toEqual({ "overlap-a": "first" });
    await act(async () => root.unmount()); client.clear(); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render();
    expect(host.querySelector("select")!.value).toBe("first");
    expect(button("Download combined LAS").disabled).toBe(false);
  });
  it("does not reuse a different collection's draft", async () => {
    localStorage.setItem(`digitization-collection-draft:${API_BASE}:other-collection`, JSON.stringify({ choices: { "overlap-a": "first" }, conflicts: { "overlap-a": '[50,100,["first","second"]]' } }));
    await render(); expect(host.querySelector("select")!.value).toBe("");
  });
  it("blocks incompatible or unfinished members and server-reported issues", async () => {
    summary.segments[1].job.calibration!.depth_unit = "M";
    summary.segments[1].job.phase = "segmenting";
    summary.issues = ["Server says not ready"];
    await render(); await select("first");
    expect(host.textContent).toContain("Segments need attention");
    expect(host.textContent).toContain("Server says not ready");
    expect(host.textContent).toContain("must match");
    expect(button("Download combined LAS").disabled).toBe(true);
  });
  it("blocks tiny steps before making export requests", async () => {
    await render(); await select("first");
    const element = host.querySelector("#collection-depth-step") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, "0.00000001");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }); await tick();
    expect(host.textContent).toContain("1,000,000 output rows");
    expect(button("Download combined LAS").disabled).toBe(true);
  });
  it("waits for a recovered job-specific draft and blocks output on save failure", async () => {
    localStorage.setItem(`digitization-review-draft:${API_BASE}:second`, JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 1 }], edits_revision: 0 }));
    vi.mocked(digitizationGateway.setEdits).mockRejectedValueOnce(new Error("Corrections offline"));
    await render(); await select("second"); await click("Download combined LAS");
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("second", [{ kind: "discard", y0: 0, y1: 1 }], 0);
    expect(collectionGateway.exportLas).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Corrections offline");
    expect(localStorage.getItem(`digitization-review-draft:${API_BASE}:second`)).not.toBeNull();
  });
  it("waits for successful durable saves and asks to review the resulting fresh revision", async () => {
    localStorage.setItem(`digitization-review-draft:${API_BASE}:second`, JSON.stringify({ edits: [{ kind: "discard", y0: 0, y1: 1 }], edits_revision: 0 }));
    let acknowledge!: (job: typeof summary.segments[number]["job"]) => void;
    vi.mocked(digitizationGateway.setEdits).mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve; }));
    await render(); await select("second"); await click("Download combined LAS");
    expect(collectionGateway.exportLas).not.toHaveBeenCalled();
    summary.revision = "fingerprint-saved-edits";
    await act(async () => acknowledge({ ...summary.segments[1].job, edits_revision: 1 })); await tick();
    expect(collectionGateway.exportLas).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Collection changed");
    expect(host.querySelector("select")!.value).toBe("second");
    await click("Download combined LAS");
    expect(collectionGateway.exportLas).toHaveBeenCalledWith("collection", expect.objectContaining({ expected_revision: "fingerprint-saved-edits" }));
  });
  it("navigates to the returned analysis ID and invalidates history", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await render(); await select("second"); await click("Analyze collection in LASight");
    expect(collectionGateway.sendToAnalysis).toHaveBeenCalledWith("collection", expect.objectContaining({ overlap_choices: { "overlap-a": "second" }, expected_revision: "fingerprint-v1" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["history"] });
    expect(host.textContent).toContain("/analysis?analysis=analysis-id");
  });
  it("keeps valid decisions when a background summary changes only the revision", async () => {
    await render(); await select("first");
    summary.revision = "new";
    await act(async () => client.setQueryData(collectionQueryKey("collection"), structuredClone(summary))); await tick();
    expect(host.querySelector("select")!.value).toBe("first");
  });
});
