import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSummary } from "../../models/digitization-models";
import { collectionGateway } from "../../services/collection-service";
import { collectionFixture, segmentJob } from "../../test-fixtures/collection-fixtures";
import { SegmentsPanel } from "./segments-panel";
import { jobQueryKey } from "../../hooks/use-digitization-job";

vi.mock("../../services/digitization-service", () => ({ IS_MOCK_GATEWAY: false }));
vi.mock("../../services/collection-service", () => ({ collectionGateway: { get: vi.fn(), create: vi.fn(), addSegment: vi.fn() } }));

let host: HTMLDivElement; let root: Root; let client: QueryClient;
function LocationProbe() { return <output>{useLocation().pathname}</output>; }
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); }
async function render(job: JobSummary) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><LocationProbe /><SegmentsPanel key={job.job_id} job={job} /></MemoryRouter></QueryClientProvider>)); await tick();
}
async function type(id: string, value: string) {
  const element = host.querySelector(`#${id}`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }); await tick();
}
async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await tick();
}
describe("wizard collection panel", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(collectionGateway.get).mockResolvedValue(collectionFixture());
    vi.mocked(collectionGateway.create).mockResolvedValue(collectionFixture());
    vi.mocked(collectionGateway.addSegment).mockResolvedValue(segmentJob("new-segment"));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  it("requires a manually entered title and creates with the current job as first member", async () => {
    const first = segmentJob("first"); first.collection_id = null;
    await render(first);
    expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    await type("collection-title", "My manual title"); await submit();
    expect(collectionGateway.create).toHaveBeenCalledWith("first", "My manual title");
    expect(client.getQueryData<JobSummary>(jobQueryKey("first"))?.collection_id).toBe("collection");
  });
  it("adds a continuation through the original-backed API and opens its own crop wizard", async () => {
    await render(segmentJob("first"));
    await type("new-segment-label", "Next interval"); await submit();
    expect(collectionGateway.addSegment).toHaveBeenCalledWith("collection", "Next interval");
    expect(host.textContent).toContain("/digitize/new-segment/crop");
    expect(client.getQueryData<JobSummary>(jobQueryKey("new-segment"))?.job_id).toBe("new-segment");
    expect(client.getQueryData<JobSummary>(jobQueryKey("first"))).toEqual(collectionFixture().segments[0].job);
  });
  it("selects each segment's own job and exposes return-to-collection from history's job", async () => {
    await render(segmentJob("first"));
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/digitize/collections/collection");
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "second"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
    expect(host.textContent).toContain("/digitize/second/review");
    expect(host.textContent).toContain("proposals do not identify continuations or read depths");
  });
  it("surfaces add errors without navigating or copying work", async () => {
    vi.mocked(collectionGateway.addSegment).mockRejectedValueOnce(new Error("Original unavailable"));
    await render(segmentJob("first")); await type("new-segment-label", "Next"); await submit();
    expect(host.textContent).toContain("Original unavailable");
    expect(host.textContent).not.toContain("/digitize/new-segment/crop");
  });
});
