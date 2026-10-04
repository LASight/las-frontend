import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionGateway } from "../../../services/collection-service";
import { digitizationGateway } from "../../../services/digitization-service";
import { collectionFixture, segmentJob } from "../../../test-fixtures/collection-fixtures";
import { IntakeStep } from "./intake-step";

vi.mock("../../../app-shell-context", () => ({ SidebarPanel: () => null, useAppShell: () => ({ collapsed: false }), useShellStatus: vi.fn() }));
vi.mock("../../../services/digitization-service", () => ({ IS_MOCK_GATEWAY: false, digitizationGateway: { createJob: vi.fn(), getJob: vi.fn(), health: vi.fn() } }));
vi.mock("../../../services/collection-service", () => ({ collectionGateway: { create: vi.fn(), get: vi.fn(), renameSegment: vi.fn() } }));
function Destination() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
let host: HTMLDivElement, root: Root, client: QueryClient;
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); }); }
async function upload() {
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Upload and continue")!.click()); await tick();
}
describe("upload enters one curve workspace", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(digitizationGateway.createJob).mockResolvedValue({ ...segmentJob("source"), collection_id: null, file_name: "Shutts.tiff" });
    vi.mocked(digitizationGateway.getJob).mockResolvedValue({ ...segmentJob("source"), collection_id: null });
    vi.mocked(collectionGateway.create).mockResolvedValue(collectionFixture());
    vi.mocked(collectionGateway.renameSegment).mockResolvedValue(collectionFixture());
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/digitize/new"]}><Routes><Route path="/digitize/new" element={<IntakeStep />} /><Route path="/digitize/curves/:collectionId" element={<Destination />} /></Routes></MemoryRouter></QueryClientProvider>));
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["test only"], "Shutts.tiff", { type: "image/tiff" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
  it("creates a filename-titled curve with the uploaded source as Segment 1, without invented well data", async () => {
    await upload();
    expect(digitizationGateway.createJob).toHaveBeenCalledTimes(1);
    expect(collectionGateway.create).toHaveBeenCalledWith("source", "Shutts.tiff");
    expect(collectionGateway.renameSegment).toHaveBeenCalledWith("collection", "source", "Segment 1");
    expect(host.textContent).toBe("/digitize/curves/collection?segment=source&view=crop");
  });
  it("retries collection failures without uploading a duplicate TIFF", async () => {
    vi.mocked(collectionGateway.create).mockRejectedValueOnce(new Error("Assembly unavailable"));
    await upload(); expect(host.textContent).toContain("Assembly unavailable"); await upload();
    expect(digitizationGateway.createJob).toHaveBeenCalledTimes(1);
    expect(digitizationGateway.getJob).toHaveBeenCalledWith("source");
    expect(host.textContent).toContain("/digitize/curves/collection");
  });
  it("recovers a lost create response from the source's durable membership", async () => {
    vi.mocked(collectionGateway.create).mockRejectedValueOnce(new Error("Response lost"));
    await upload();
    vi.mocked(digitizationGateway.getJob).mockResolvedValue(segmentJob("source"));
    vi.mocked(collectionGateway.get).mockResolvedValue(collectionFixture());
    await upload(); expect(collectionGateway.create).toHaveBeenCalledTimes(1);
    expect(collectionGateway.get).toHaveBeenCalledWith("collection");
    expect(host.textContent).toContain("/digitize/curves/collection");
  });
});
