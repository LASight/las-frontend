import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSummary, TrackCrop } from "../models/digitization-models";
import { collectionGateway } from "../services/collection-service";
import { digitizationGateway } from "../services/digitization-service";
import { collectionFixture, segmentJob } from "../test-fixtures/collection-fixtures";
import { CollectionWorkspace } from "./collection-workspace";
import { CurveWorkspace } from "./curve-workspace";

vi.mock("../app-shell-context", () => ({ useShellStatus: vi.fn() }));
vi.mock("../services/collection-service", () => ({ collectionGateway: { get: vi.fn(), addSegment: vi.fn(), renameSegment: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn() } }));
vi.mock("../services/digitization-service", () => ({ digitizationGateway: { getJob: vi.fn(), getCurve: vi.fn(), setEdits: vi.fn(), setCrop: vi.fn(), setCalibration: vi.fn(), startSegmentation: vi.fn(), detectTracks: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn() } }));
const autofocus = vi.hoisted(() => ({ focus: vi.fn() }));
vi.mock("../components/digitization/cropper/track-cropper", async () => {
  const { useSavedCropFocus } = await import("../components/digitization/cropper/use-saved-crop-focus");
  const viewport = { width: 564, height: 520 };
  return { TrackCropper: ({ job, crop, onChange, focusSavedCropStart = false }: { job: JobSummary; crop: TrackCrop; onChange: (crop: TrackCrop) => void; focusSavedCropStart?: boolean }) => {
    useSavedCropFocus({ enabled: focusSavedCropStart, jobId: job.job_id, savedCrop: job.crop, viewport, focus: autofocus.focus });
    return <div data-testid="original-canvas" data-job={job.job_id}><output>{crop.x_left}</output><button onClick={() => onChange({ ...crop, x_left: crop.x_left + 1 })}>Ajustar visualmente</button></div>;
  } };
});
vi.mock("../components/digitization/raster-viewport", () => ({ RasterViewport: ({ job, onStroke }: { job: JobSummary; onStroke: (samples: Array<{ row: number; x: number }>) => void }) => <div data-testid="review-canvas" data-job={job.job_id}><button onClick={() => onStroke([{ row: 0, x: job.job_id === "first" ? 10 : 20 }, { row: 1, x: 30 }])}>Corregir trazo</button></div> }));

let host: HTMLDivElement, root: Root, client: QueryClient;
let summary = collectionFixture();
function Destination() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); }
async function render(path = "/digitize/curves/collection?segment=first&view=crop") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Destination /><Routes>
    <Route path="/digitize/curves/:collectionId" element={<CurveWorkspace />} />
    <Route path="/digitize/collections/:collectionId" element={<CollectionWorkspace />} />
    <Route path="/analysis" element={<p>Analysis</p>} />
  </Routes></MemoryRouter></QueryClientProvider>)); await tick();
}
function button(text: string) { const result = [...host.querySelectorAll("button")].find((b) => b.textContent === text); expect(result).toBeDefined(); return result!; }
async function click(text: string) { const target = button(text); expect(target.disabled).toBe(false); await act(async () => target.click()); await tick(); }
async function selectSegment(id: string) { await act(async () => (host.querySelector(`#select-segment-${id}`) as HTMLButtonElement).click()); await tick(); }
async function input(selector: string, value: string) {
  const target = host.querySelector(selector) as HTMLInputElement;
  expect(target).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value); target.dispatchEvent(new Event("input", { bubbles: true })); }); await tick();
}
function replaceJob(job: JobSummary) { summary.segments.find((s) => s.job_id === job.job_id)!.job = structuredClone(job); return structuredClone(job); }

describe("unified curve workspace (UI metadata fixtures, not ML evidence)", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); vi.clearAllMocks(); summary = collectionFixture();
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(collectionGateway.get).mockImplementation(async () => structuredClone(summary));
    vi.mocked(digitizationGateway.getJob).mockImplementation(async (id) => structuredClone(summary.segments.find((s) => s.job_id === id)!.job));
    vi.mocked(digitizationGateway.getCurve).mockResolvedValue({ y0: 0, y1: 3, stride: 1, x: [1, 2, 3], observed: [true, true, true] });
    vi.mocked(digitizationGateway.setEdits).mockImplementation(async (id, edits, revision) => replaceJob({ ...summary.segments.find((s) => s.job_id === id)!.job, edits, edits_revision: (revision ?? 0) + 1 }));
    vi.mocked(digitizationGateway.setCrop).mockImplementation(async (id, crop) => replaceJob({ ...summary.segments.find((s) => s.job_id === id)!.job, crop, calibration: null, quality: null, edits: [], edits_revision: (summary.segments.find((s) => s.job_id === id)!.job.edits_revision ?? 0) + 1, phase: "calibrating" }));
    vi.mocked(digitizationGateway.setCalibration).mockImplementation(async (id, calibration) => replaceJob({ ...summary.segments.find((s) => s.job_id === id)!.job, calibration }));
    vi.mocked(digitizationGateway.startSegmentation).mockImplementation(async (id) => replaceJob({ ...summary.segments.find((s) => s.job_id === id)!.job, quality: segmentJob(id).quality, phase: "reviewing" }));
    vi.mocked(collectionGateway.renameSegment).mockImplementation(async (_, id, label) => { const segment = summary.segments.find((s) => s.job_id === id)!; segment.label = label; segment.job.segment_label = label; return structuredClone(summary); });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:test"); static revokeObjectURL = vi.fn(); });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("has one document header, local tools and one original canvas, with no wizard or IDs in visible UI", async () => {
    await render();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")!.textContent).toBe("test-raster.tif · GR");
    expect(host.querySelectorAll('[data-testid="original-canvas"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(host.textContent).not.toContain("Collection"); expect(host.textContent).not.toContain("Continue to");
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(button("Procesar curva").disabled).toBe(true);
  });
  it("keeps crop drafts isolated and restores them when switching members, with unique sibling keys", async () => {
    const errors = vi.spyOn(console, "error");
    await render(); await input("#crop-x-left", "10");
    expect(button("Procesar curva").disabled).toBe(true);
    await selectSegment("second"); expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("0");
    await input("#crop-x-left", "20"); await selectSegment("first");
    expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("10");
    expect(host.querySelectorAll("#crop-x-left")).toHaveLength(1);
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    expect(errors.mock.calls.some((args) => args.some((value) => String(value).includes("same key")))).toBe(false);
  });
  it("changes view without leaving the curve and keeps the scan visible during calibration", async () => {
    await render(); await click("Calibrar");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("/digitize/curves/collection");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("view=cal");
    expect(host.querySelector('[data-testid="original-canvas"]')).not.toBeNull();
    await input("#cal-depth_top", "2600"); await selectSegment("second");
    expect((host.querySelector("#cal-depth_top") as HTMLInputElement).value).toBe("50");
    await selectSegment("first"); expect((host.querySelector("#cal-depth_top") as HTMLInputElement).value).toBe("2600");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });
  it("opts into saved-crop focus on selection/confirmed crop only, never numeric draft edits", async () => {
    await render(); expect(autofocus.focus).toHaveBeenCalledTimes(1);
    await input("#crop-x-left", "10"); expect(autofocus.focus).toHaveBeenCalledTimes(1);
    await click("Confirmar recorte"); expect(autofocus.focus).toHaveBeenCalledTimes(2);
    expect(autofocus.focus).toHaveBeenLastCalledWith(expect.objectContaining({ x_left: 10 }));
    await input("#cal-depth_top", "2600"); expect(autofocus.focus).toHaveBeenCalledTimes(2);
    await click("Recortar"); expect(autofocus.focus).toHaveBeenCalledTimes(2);
    await selectSegment("second"); expect(autofocus.focus).toHaveBeenCalledTimes(3);
    expect(autofocus.focus).toHaveBeenLastCalledWith(segmentJob("second").crop);
  });
  it("does not invent a new segment's depths, mnemonic or units", async () => {
    summary.segments[0].job = { ...segmentJob("first"), crop: null, calibration: null, quality: null, phase: "cropping" };
    await render(); await click("Calibrar");
    for (const id of ["cal-depth_top", "cal-depth_bottom", "cal-mnemonic", "cal-value-unit", "cal-depth-unit"]) expect((host.querySelector(`#${id}`) as HTMLInputElement).value).toBe("");
    expect(button("Guardar calibración").disabled).toBe(true);
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });
  it("requires explicit warning acceptance before a READY crop reset, preserving other member edits", async () => {
    summary.segments[1].job.edits = [{ kind: "discard", y0: 0, y1: 1 }];
    await render(); await click("Ajustar visualmente");
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Confirmar recorte");
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    await click("Confirmar recorte"); expect(digitizationGateway.setCrop).toHaveBeenCalledWith("first", expect.objectContaining({ x_left: 1 }));
    expect(summary.segments[1].job.edits).toHaveLength(1);
    expect(summary.segments[0].job.quality).toBeNull();
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("view=cal");
    expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("READY calibration is only reset on explicit confirmed save, not typing/autosave", async () => {
    await render(); await click("Calibrar"); await input("#cal-value_max", "200");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Guardar calibración"); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    await click("Guardar calibración");
    expect(digitizationGateway.setCrop).toHaveBeenCalledWith("first", segmentJob("first").crop);
    expect(digitizationGateway.setCalibration).toHaveBeenCalledWith("first", expect.objectContaining({ value_max: 200 }));
    expect(summary.segments[0].job.quality).toBeNull();
    expect(summary.segments[1].job.quality).not.toBeNull();
    expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("blocks mismatched mnemonic without overwriting another member", async () => {
    await render(); await click("Calibrar"); await input("#cal-mnemonic", "SP");
    expect(host.textContent).toContain("deben coincidir"); expect(button("Guardar calibración").disabled).toBe(true);
    expect(summary.segments[1].job.calibration!.mnemonic).toBe("GR"); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });
  it("copies only an explicitly confirmed scale draft, never depths or depth units", async () => {
    summary.segments[0].job.calibration!.value_max = 200;
    await render("/digitize/curves/collection?segment=second&view=cal");
    const select = host.querySelector('[aria-label="Tramo de origen de escala"]') as HTMLSelectElement;
    await act(async () => { select.value = "first"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Copiar escala al borrador");
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("150");
    await click("Copiar escala al borrador");
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("200");
    expect((host.querySelector("#cal-depth_top") as HTMLInputElement).value).toBe("50");
    expect((host.querySelector("#cal-depth_bottom") as HTMLInputElement).value).toBe("150");
    expect((host.querySelector("#cal-depth-unit") as HTMLSelectElement).value).toBe("FT");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
  });
  it("adds a procedural tramo from the original without a new job/upload wizard", async () => {
    vi.mocked(collectionGateway.addSegment).mockImplementation(async (_, label) => {
      const job = { ...segmentJob("third"), phase: "cropping" as const, crop: null, calibration: null, quality: null, segment_label: label };
      summary.segments.push({ job_id: "third", label, job }); return job;
    });
    await render(); await click("+ Añadir tramo");
    expect(collectionGateway.addSegment).toHaveBeenCalledWith("collection", "Tramo 3");
    expect(host.querySelector('[data-testid="original-canvas"]')!.getAttribute("data-job")).toBe("third");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toBe("/digitize/curves/collection?segment=third&view=crop");
    expect(host.querySelectorAll('[data-testid="original-canvas"]')).toHaveLength(1);
  });
  it("processes eligible members once and only through the curve header, without old segment/review URLs", async () => {
    summary.segments.forEach(({ job }) => { job.quality = null; job.phase = "calibrating"; });
    await render(); await click("Procesar curva");
    expect(vi.mocked(digitizationGateway.startSegmentation).mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
    expect(host.textContent).toContain("2/2 tramos con predicción");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("/digitize/curves/collection");
    expect(button("Procesar curva").disabled).toBe(true);
  });
  it("shows a processing failure and explicit retry, never approves missing prediction", async () => {
    summary.segments.forEach(({ job }) => { job.quality = null; job.phase = "calibrating"; });
    vi.mocked(digitizationGateway.startSegmentation).mockImplementationOnce(async (id) => replaceJob({ ...summary.segments.find((s) => s.job_id === id)!.job, phase: "failed", error: "Model failed" }));
    await render(); await click("Procesar curva");
    expect(host.textContent).toContain("Model failed"); expect(host.textContent).toContain("0/2 tramos con predicción");
    expect(digitizationGateway.startSegmentation).toHaveBeenCalledTimes(1);
    await click("Reintentar curva"); expect(host.textContent).toContain("2/2 tramos con predicción");
  });
  it("keeps correction strokes/undo isolated when switching members", async () => {
    await render("/digitize/curves/collection?segment=first&view=review");
    await click("Corregir trazo"); expect(digitizationGateway.setEdits).toHaveBeenLastCalledWith("first", expect.any(Array), 0);
    await selectSegment("second"); expect(button("Deshacer").disabled).toBe(true);
    await click("Corregir trazo"); expect(digitizationGateway.setEdits).toHaveBeenLastCalledWith("second", expect.any(Array), 0);
    await selectSegment("first"); await click("Deshacer");
    expect(digitizationGateway.setEdits).toHaveBeenLastCalledWith("first", [], 1);
    expect(summary.segments[1].job.edits).toHaveLength(1);
  });
  it("renames MAIN/REPEAT compactly without losing prediction or edits", async () => {
    summary.segments[0].job.edits = [{ kind: "discard", y0: 0, y1: 1 }];
    await render();
    await act(async () => (host.querySelector('[aria-label="Renombrar tramo"]') as HTMLButtonElement).click());
    await input('[aria-label="Nombre del tramo"]', "MAIN");
    await act(async () => (host.querySelector('[aria-label="Guardar nombre del tramo"]') as HTMLButtonElement).click()); await tick();
    expect(collectionGateway.renameSegment).toHaveBeenCalledWith("collection", "first", "MAIN");
    expect(host.querySelector("#select-segment-first")!.textContent).toContain("MAIN");
    expect(summary.segments[0].job.edits).toHaveLength(1); expect(summary.segments[0].job.quality).not.toBeNull();
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled(); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("legacy collection link redirects to one joint result with manual overlap choices and no member outputs", async () => {
    await render("/digitize/collections/collection");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toBe("/digitize/curves/collection?view=result");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(button("Descargar LAS").disabled).toBe(true); expect(button("Analizar curva").disabled).toBe(true);
    expect(host.querySelectorAll('button')).toSatisfy((buttons: NodeListOf<HTMLButtonElement>) => [...buttons].filter((b) => /Descargar|Download|Analizar|Analyze/.test(b.textContent ?? "")).length === 2);
    expect(host.querySelector('select[id^="overlap-"]')!.getAttribute("required")).not.toBeNull();
    expect(host.querySelector('select[id^="overlap-"]')!.getAttribute("value")).toBeNull();
    expect(digitizationGateway.exportLas).not.toHaveBeenCalled(); expect(digitizationGateway.sendToAnalysis).not.toHaveBeenCalled();
  });
});
