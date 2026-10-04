import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCurveReview } from "../../../hooks/use-curve-review";
import { DEFAULT_CALIBRATION, type CurveEdit, type JobSummary } from "../../../models/digitization-models";
import { digitizationGateway } from "../../../services/digitization-service";
import { ExportStep } from "./export-step";

const controller = vi.hoisted(() => ({ job: null as JobSummary | null }));
vi.mock("../job-context", () => ({ useJobController: () => controller }));
vi.mock("../../../services/digitization-service", () => ({
  IS_MOCK_GATEWAY: false,
  digitizationGateway: { getCurve: vi.fn(), setEdits: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn() },
}));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let review: ReturnType<typeof useCurveReview>;
const redraw: CurveEdit = { kind: "redraw", y0: 0, y1: 2, x_by_row: [10, 20] };
const discard: CurveEdit = { kind: "discard", y0: 2, y1: 3 };
function ReviewProbe() {
  review = useCurveReview(controller.job);
  return <span>{review.edits.length}</span>;
}
function job(edits: CurveEdit[] = [], revision = 0): JobSummary {
  return {
    job_id: "job", phase: "reviewing", file_name: "scan.tif", created_at: 0,
    raster: { width: 100, height: 3, mode: "L", image_format: "TIFF", size_bytes: 10, n_pages: 1, dpi: null },
    preprocess: null, detection: null, crop: { x_left: 0, x_right: 100, y_top: 0, y_bottom: 3 },
    calibration: DEFAULT_CALIBRATION, settings: null, progress: null,
    quality: { coverage: 1, n_wraps: 0, n_rows: 3, n_unrecovered: 0 }, error: null,
    edits, edits_revision: revision,
  };
}
async function render(step: "review" | "export") {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{step === "review" ? <ReviewProbe /> : <ExportStep />}</MemoryRouter>
    </QueryClientProvider>
  ));
  // React Query batches notifications through a timer.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((element) => element.textContent === label);
  expect(button).toBeDefined();
  expect(button?.disabled).toBe(false);
  await act(async () => button?.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe("Review → Export and reload", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.clearAllMocks();
    controller.job = job();
    host = document.createElement("div");
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(digitizationGateway.getCurve).mockResolvedValue({ y0: 0, y1: 3, stride: 1, x: [1, 2, 3], observed: [true, true, true] });
    vi.mocked(digitizationGateway.setEdits).mockImplementation(async (_, edits, revision) => {
      controller.job = job(edits, (revision ?? 0) + 1);
      return controller.job;
    });
    vi.mocked(digitizationGateway.exportLas).mockResolvedValue({ text: "~Version", fileName: "job.las" });
    vi.mocked(digitizationGateway.sendToAnalysis).mockResolvedValue({ analysis_id: "analysis", well_count: 1, file_name: "job.las" });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = () => "blob:test";
      static revokeObjectURL = () => {};
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the shared corrected snapshot for Download and Analyze after navigation", async () => {
    await render("review");
    await act(async () => {
      review.applyStroke([{ row: 0, x: 10 }, { row: 1, x: 20 }]);
      review.discardRange(2, 3);
      await review.flushEdits();
    });
    expect(review.baseX).toEqual([1, 2, 3]);
    expect(review.x).toEqual([10, 20, null]);
    await render("export");
    expect(host.textContent).toContain("2 (3 rows)");
    await click("Download LAS");
    expect(digitizationGateway.exportLas).toHaveBeenCalledWith("job", expect.objectContaining({ edits: [redraw, discard], edits_revision: 2 }));
    await click("Analyze in LASight");
    expect(digitizationGateway.sendToAnalysis).toHaveBeenCalledWith("job", expect.objectContaining({ edits: [redraw, discard], edits_revision: 2 }));
  });

  it("rehydrates backend edits with a fresh query client and exports undo/reset correctly", async () => {
    controller.job = job([redraw, discard], 6);
    await render("review");
    await act(async () => { review.undo(); await review.flushEdits(); });
    await act(async () => root.unmount());
    client.clear();
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render("export");
    expect(host.textContent).toContain("1 (2 rows)");
    await click("Download LAS");
    expect(digitizationGateway.exportLas).toHaveBeenLastCalledWith("job", expect.objectContaining({ edits: [redraw], edits_revision: 7 }));
    await render("review");
    await act(async () => { review.reset(); await review.flushEdits(); });
    expect(review.x).toEqual([1, 2, 3]);
    await render("export");
    await click("Download LAS");
    expect(digitizationGateway.exportLas).toHaveBeenLastCalledWith("job", expect.objectContaining({ edits: [], edits_revision: 8 }));
  });

  it("waits for an in-flight durable save before exporting", async () => {
    let acknowledge!: (value: JobSummary) => void;
    vi.mocked(digitizationGateway.setEdits).mockReturnValue(new Promise((resolve) => { acknowledge = resolve; }));
    await render("review");
    await act(async () => review.discardRange(2, 3));
    await render("export");
    await click("Download LAS");
    expect(digitizationGateway.exportLas).not.toHaveBeenCalled();
    await act(async () => acknowledge(job([discard], 1)));
    expect(digitizationGateway.exportLas).toHaveBeenCalledWith("job", expect.objectContaining({ edits: [discard], edits_revision: 1 }));
  });

  it("blocks both export paths on save failure rather than sending []", async () => {
    vi.mocked(digitizationGateway.setEdits).mockRejectedValue(new Error("offline"));
    await render("review");
    await act(async () => review.discardRange(2, 3));
    await render("export");
    await click("Download LAS");
    await click("Analyze in LASight");
    expect(digitizationGateway.exportLas).not.toHaveBeenCalled();
    expect(digitizationGateway.sendToAnalysis).not.toHaveBeenCalled();
    expect(host.textContent).toContain("offline");
    expect(localStorage.length).toBe(1);
  });
});
