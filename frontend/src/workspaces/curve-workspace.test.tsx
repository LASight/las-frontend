import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSummary, TrackCrop } from "../models/digitization-models";
import { collectionGateway } from "../services/collection-service";
import { digitizationGateway } from "../services/digitization-service";
import { accountDraftKey, endAccountSession, setSessionAccount } from "../services/session-scope";
import { API_BASE } from "../services/http-client";
import { readInputDraft } from "../components/digitization/curve-segment-editor";
import { collectionFixture, segmentJob } from "../test-fixtures/collection-fixtures";
import { CollectionWorkspace } from "./collection-workspace";
import { CurveWorkspace } from "./curve-workspace";

vi.mock("../app-shell-context", () => ({ useShellStatus: vi.fn() }));
vi.mock("../services/collection-service", () => ({ collectionGateway: { get: vi.fn(), addSegment: vi.fn(), detachSegment: vi.fn(), renameSegment: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn() } }));
vi.mock("../services/digitization-service", () => ({ digitizationGateway: { getJob: vi.fn(), getCurve: vi.fn(), setEdits: vi.fn(), setCrop: vi.fn(), setCalibration: vi.fn(), startSegmentation: vi.fn(), detectTracks: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn() } }));
const autofocus = vi.hoisted(() => ({ focus: vi.fn() }));
vi.mock("../components/digitization/cropper/track-cropper", async () => {
  const { useSavedCropFocus } = await import("../components/digitization/cropper/use-saved-crop-focus");
  const viewport = { width: 564, height: 520 };
  return { TrackCropper: ({ job, crop, onChange, focusSavedCropStart = false }: { job: JobSummary; crop: TrackCrop; onChange: (crop: TrackCrop) => void; focusSavedCropStart?: boolean }) => {
    useSavedCropFocus({ enabled: focusSavedCropStart, jobId: job.job_id, savedCrop: job.crop, viewport, focus: autofocus.focus });
    return <div data-testid="original-canvas" data-job={job.job_id}><output>{crop.x_left}</output><button onClick={() => onChange({ ...crop, x_left: crop.x_left + 1 })}>Adjust visually</button></div>;
  } };
});
vi.mock("../components/digitization/raster-viewport", () => ({ RasterViewport: ({ job, onStroke }: { job: JobSummary; onStroke: (samples: Array<{ row: number; x: number }>) => void }) => <div data-testid="review-canvas" data-job={job.job_id}><button onClick={() => onStroke([{ row: 0, x: job.job_id === "first" ? 10 : 20 }, { row: 1, x: 30 }])}>Correct trace</button></div> }));

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
function button(text: string) { const result = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text); expect(result).toBeDefined(); return result!; }
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
    setSessionAccount("account-a");
    document.body.style.overflow = "";
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
    vi.mocked(collectionGateway.detachSegment).mockImplementation(async (_, id) => {
      summary.segments = summary.segments.filter((segment) => segment.job_id !== id);
      summary.overlaps = summary.overlaps.filter((overlap) => !overlap.job_ids.includes(id));
      return structuredClone(summary);
    });
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
    expect(button("Process curve").disabled).toBe(true);
  });
  it("keeps crop drafts isolated and restores them when switching members, with unique sibling keys", async () => {
    const errors = vi.spyOn(console, "error");
    await render(); await input("#crop-x-left", "10");
    expect(button("Process curve").disabled).toBe(true);
    await selectSegment("second"); expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("0");
    await input("#crop-x-left", "20"); await selectSegment("first");
    expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("10");
    expect(host.querySelectorAll("#crop-x-left")).toHaveLength(1);
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    expect(errors.mock.calls.some((args) => args.some((value) => String(value).includes("same key")))).toBe(false);
  });
  it("changes view without leaving the curve and keeps the scan visible during calibration", async () => {
    await render(); await click("Calibrate");
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
    await click("Confirm crop"); expect(autofocus.focus).toHaveBeenCalledTimes(2);
    expect(autofocus.focus).toHaveBeenLastCalledWith(expect.objectContaining({ x_left: 10 }));
    await input("#cal-depth_top", "2600"); expect(autofocus.focus).toHaveBeenCalledTimes(2);
    await click("Crop"); expect(autofocus.focus).toHaveBeenCalledTimes(2);
    await selectSegment("second"); expect(autofocus.focus).toHaveBeenCalledTimes(3);
    expect(autofocus.focus).toHaveBeenLastCalledWith(segmentJob("second").crop);
  });
  it("does not invent a new segment's depths, mnemonic or units", async () => {
    summary.segments[0].job = { ...segmentJob("first"), crop: null, calibration: null, quality: null, phase: "cropping" };
    await render(); await click("Calibrate");
    for (const id of ["cal-depth_top", "cal-depth_bottom", "cal-mnemonic", "cal-value-unit", "cal-depth-unit"]) expect((host.querySelector(`#${id}`) as HTMLInputElement).value).toBe("");
    expect(button("Save calibration").disabled).toBe(true);
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });
  it("requires explicit warning acceptance before a READY crop reset, preserving other member edits", async () => {
    summary.segments[1].job.edits = [{ kind: "discard", y0: 0, y1: 1 }];
    await render(); await click("Adjust visually");
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Confirm crop");
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    await click("Confirm crop"); expect(digitizationGateway.setCrop).toHaveBeenCalledWith("first", expect.objectContaining({ x_left: 1 }));
    expect(summary.segments[1].job.edits).toHaveLength(1);
    expect(summary.segments[0].job.quality).toBeNull();
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("view=cal");
    expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("READY calibration is only reset on explicit confirmed save, not typing/autosave", async () => {
    await render(); await click("Calibrate"); await input("#cal-value_max", "200");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Save calibration"); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    await click("Save calibration");
    expect(digitizationGateway.setCrop).toHaveBeenCalledWith("first", segmentJob("first").crop);
    expect(digitizationGateway.setCalibration).toHaveBeenCalledWith("first", expect.objectContaining({ value_max: 200 }));
    expect(summary.segments[0].job.quality).toBeNull();
    expect(summary.segments[1].job.quality).not.toBeNull();
    expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("blocks mismatched mnemonic without overwriting another member", async () => {
    await render(); await click("Calibrate"); await input("#cal-mnemonic", "SP");
    expect(host.textContent).toContain("must match"); expect(button("Save calibration").disabled).toBe(true);
    expect(summary.segments[1].job.calibration!.mnemonic).toBe("GR"); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });
  it("copies only an explicitly confirmed scale draft, never depths or depth units", async () => {
    summary.segments[0].job.calibration!.value_max = 200;
    await render("/digitize/curves/collection?segment=second&view=cal");
    const select = host.querySelector('[aria-label="Scale source segment"]') as HTMLSelectElement;
    await act(async () => { select.value = "first"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Copy scale to draft");
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("150");
    await click("Copy scale to draft");
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("200");
    expect((host.querySelector("#cal-depth_top") as HTMLInputElement).value).toBe("50");
    expect((host.querySelector("#cal-depth_bottom") as HTMLInputElement).value).toBe("150");
    expect((host.querySelector("#cal-depth-unit") as HTMLSelectElement).value).toBe("FT");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
  });
  it("copies only declared identity after confirmation, keeping every segment's anchors independent", async () => {
    summary.segments[0].job = { ...segmentJob("first"), calibration: null, quality: null, phase: "calibrating" };
    await render(); await click("Calibrate");
    await input("#cal-value_min", "20"); await input("#cal-depth_top", "3000");
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Use curve identity");
    expect((host.querySelector("#cal-mnemonic") as HTMLInputElement).value).toBe("");
    await click("Use curve identity");
    expect((host.querySelector("#cal-mnemonic") as HTMLInputElement).value).toBe("GR");
    expect((host.querySelector("#cal-value-unit") as HTMLInputElement).value).toBe("GAPI");
    expect((host.querySelector("#cal-depth-unit") as HTMLSelectElement).value).toBe("FT");
    expect((host.querySelector("#cal-value_min") as HTMLInputElement).value).toBe("20");
    expect((host.querySelector("#cal-depth_top") as HTMLInputElement).value).toBe("3000");
    expect((host.querySelector("#cal-depth_bottom") as HTMLInputElement).value).toBe("");
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
  });

  it("keeps calibration drafts and the source canvas mounted when the inspector is collapsed", async () => {
    await render(); await click("Calibrate"); await input("#cal-value_max", "215");
    await act(async () => (host.querySelector('[aria-label="Collapse inspector"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-testid="original-canvas"]')).not.toBeNull();
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("215");
    await act(async () => (host.querySelector('[aria-label="Expand inspector"]') as HTMLButtonElement).click());
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("215");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });

  it("keeps saved track readouts separate from uncommitted calibration edits", async () => {
    await render(); await click("Calibrate"); await input("#cal-value_max", "215");
    const heading = host.querySelector('[aria-label="Saved track calibration"]')!;
    expect(heading.textContent).toContain("GR"); expect(heading.textContent).toContain("GAPI");
    expect(heading.textContent).not.toContain("215");
  });

  it("enters/exits focus without remounting the editor, changing the segment or discarding calibration drafts", async () => {
    document.body.style.overflow = "clip";
    await render(); await click("Calibrate"); await input("#cal-value_max", "215");
    const canvas = host.querySelector('[data-testid="original-canvas"]');
    const field = host.querySelector<HTMLInputElement>("#cal-value_max")!;
    await click("Focus view");
    expect(host.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="original-canvas"]')).toBe(canvas);
    expect(host.querySelector("#cal-value_max")).toBe(field); expect(field.value).toBe("215");
    expect(document.body.style.overflow).toBe("hidden");
    expect((host.querySelector("#focus-view-segment") as HTMLSelectElement).value).toBe("first");
    const toggle = host.querySelector<HTMLButtonElement>("#curve-focus-view")!;
    await act(async () => toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.querySelector('[data-testid="original-canvas"]')).toBe(canvas);
    expect(field.value).toBe("215"); expect(document.activeElement).toBe(toggle); expect(document.body.style.overflow).toBe("clip");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
    document.body.style.overflow = "";
  });

  it("leaves Escape to input/combobox editing, keeps focus across local tabs, and restores overflow on unmount", async () => {
    await render(); await click("Calibrate"); await click("Focus view");
    const field = host.querySelector<HTMLInputElement>("#cal-mnemonic")!;
    await act(async () => { field.focus(); field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click("Crop"); expect(button("Exit focus view")).toBeDefined();
    await click("Calibrate"); expect(button("Exit focus view")).toBeDefined();
    await act(async () => root.render(<p>Unmounted workspace</p>)); expect(document.body.style.overflow).toBe("");
  });

  it("keeps prediction display preferences and correction state unchanged through focus changes", async () => {
    await render("/digitize/curves/collection?segment=first&view=review");
    const canvas = host.querySelector('[data-testid="review-canvas"]');
    const prediction = [...host.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent?.includes("Show prediction"))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => prediction.click());
    const opacity = host.querySelector<HTMLInputElement>('[aria-label="Prediction opacity"]')!;
    await input('[aria-label="Prediction opacity"]', "0");
    await click("Focus view"); await click("Exit focus view");
    expect(host.querySelector('[data-testid="review-canvas"]')).toBe(canvas); expect(prediction.checked).toBe(false); expect(opacity.value).toBe("0");
    expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    await click("Correct trace"); expect(digitizationGateway.setEdits).toHaveBeenCalledWith("first", expect.any(Array), 0);
  });

  it("retains access to segment selection in focus view, changing it only on explicit input", async () => {
    await render(); await click("Focus view");
    const select = host.querySelector<HTMLSelectElement>("#focus-view-segment")!;
    expect(select.value).toBe("first");
    await act(async () => { select.value = "second"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
    expect(host.querySelector('[data-testid="original-canvas"]')!.getAttribute("data-job")).toBe("second");
    expect(button("Exit focus view")).toBeDefined(); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus inside focus view rather than in the covered global navigation", async () => {
    await render(); await click("Focus view");
    const summaries = [...host.querySelectorAll<HTMLElement>("summary")]; const last = summaries[summaries.length - 1];
    await act(async () => { last.focus(); last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(host.querySelector("#focus-view-segment"));
    const background = document.createElement("button"); document.body.append(background);
    await act(async () => background.focus()); expect(document.activeElement).toBe(host.querySelector("#curve-focus-view")); background.remove();
    await click("Exit focus view"); expect(document.body.style.overflow).toBe("");
  });

  it("adds a procedural segment from the original without a new job/upload wizard", async () => {
    vi.mocked(collectionGateway.addSegment).mockImplementation(async (_, label) => {
      const job = { ...segmentJob("third"), phase: "cropping" as const, crop: null, calibration: null, quality: null, segment_label: label };
      summary.segments.push({ job_id: "third", label, job }); return job;
    });
    await render(); await click("+ Add segment");
    expect(collectionGateway.addSegment).toHaveBeenCalledWith("collection", "Segment 3");
    expect(host.querySelector('[data-testid="original-canvas"]')!.getAttribute("data-job")).toBe("third");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toBe("/digitize/curves/collection?segment=third&view=crop");
    expect(host.querySelectorAll('[data-testid="original-canvas"]')).toHaveLength(1);
  });
  it("requires confirmation and preserves the selected draft when removal is cancelled", async () => {
    await render(); await input("#crop-x-left", "10");
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Remove segment");
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(summary.segments[0].label));
    expect(collectionGateway.detachSegment).not.toHaveBeenCalled();
    expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("10");
    expect(summary.segments).toHaveLength(2);
  });
  it("detaches an accidental unprocessed segment, keeps other saved work and selects a remaining segment", async () => {
    summary.segments[1].job = { ...segmentJob("second"), crop: null, calibration: null, quality: null, phase: "cropping" };
    const original = structuredClone(summary.segments[0]);
    await render("/digitize/curves/collection?segment=second&view=crop&extra=keep");
    await click("Remove segment");
    expect(collectionGateway.detachSegment).toHaveBeenCalledWith("collection", "second");
    expect(summary.segments).toEqual([original]);
    expect(host.querySelector('[data-testid="original-canvas"]')!.getAttribute("data-job")).toBe("first");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("segment=first&view=crop&extra=keep");
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled(); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
    expect(button("Remove segment").disabled).toBe(true);
  });
  it("can detach the first processed member without resetting the remaining member or its local draft", async () => {
    await render("/digitize/curves/collection?segment=second&view=cal");
    await input("#cal-value_max", "215"); await selectSegment("first");
    const remaining = structuredClone(summary.segments[1]); await click("Remove segment");
    expect(summary.segments).toEqual([remaining]);
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("215");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("segment=second&view=cal");
    expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
  });
  it("never offers removal of the final member", async () => {
    summary.segments = summary.segments.slice(0, 1); summary.overlaps = [];
    await render(); expect(button("Remove segment").disabled).toBe(true);
    expect(button("Remove segment").title).toContain("at least one segment");
    expect(collectionGateway.detachSegment).not.toHaveBeenCalled();
  });
  it("disables removal while a member is processing and rechecks fresh server state before detaching", async () => {
    summary.segments[1].job.phase = "segmenting";
    await render(); expect(button("Remove segment").disabled).toBe(true);
    summary.segments[1].job.phase = "reviewing"; await act(async () => client.setQueryData(["digitization", "collection", "collection"], structuredClone(summary))); await tick();
    expect(button("Remove segment").disabled).toBe(false);
    summary.segments[1].job.phase = "segmenting"; await click("Remove segment");
    expect(collectionGateway.detachSegment).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Wait for processing to finish");
  });
  it("shows removal errors without navigating away or losing the target draft", async () => {
    await render(); await input("#crop-x-left", "10");
    vi.mocked(collectionGateway.detachSegment).mockRejectedValueOnce(new Error("Removal unavailable"));
    await click("Remove segment");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Removal unavailable");
    expect(summary.segments).toHaveLength(2);
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("segment=first");
    expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("10");
  });
  it("removes the selected member from focus view without exiting focus", async () => {
    await render(); await click("Focus view"); await click("Remove segment");
    expect(host.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect((host.querySelector("#focus-view-segment") as HTMLSelectElement).value).toBe("second");
    expect(button("Exit focus view")).toBeDefined();
  });
  it("locks selection, edits and competing structural actions while removal is pending", async () => {
    let finish!: (value: typeof summary) => void;
    vi.mocked(collectionGateway.detachSegment).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await click("Remove segment");
    expect(button("Removing…").disabled).toBe(true); expect(button("+ Add segment").disabled).toBe(true);
    expect((host.querySelector("#select-segment-second") as HTMLButtonElement).disabled).toBe(true);
    expect(button("Crop").disabled).toBe(true); expect(button("Confirm crop").disabled).toBe(true);
    const updated = structuredClone(summary); updated.segments = updated.segments.slice(1); updated.overlaps = [];
    summary = updated; await act(async () => finish(updated)); await tick();
    expect(host.querySelector('[data-testid="original-canvas"]')!.getAttribute("data-job")).toBe("second");
  });
  it("locks result export during removal and removal during result export", async () => {
    summary.overlaps = [];
    let finishRemoval!: (value: typeof summary) => void;
    vi.mocked(collectionGateway.detachSegment).mockImplementationOnce(() => new Promise((resolve) => { finishRemoval = resolve; }));
    await render("/digitize/curves/collection?segment=first&view=result"); await click("Remove segment");
    expect(button("Download LAS").disabled).toBe(true); expect(button("Analyze curve").disabled).toBe(true);
    const updated = structuredClone(summary); updated.segments = updated.segments.slice(1); summary = updated;
    await act(async () => finishRemoval(updated)); await tick();
    summary.segments.push({ job_id: "third", label: "Third", job: segmentJob("third") });
    await act(async () => client.setQueryData(["digitization", "collection", "collection"], structuredClone(summary))); await tick();
    let finishExport!: (value: { text: string; fileName: string }) => void;
    vi.mocked(collectionGateway.exportLas).mockImplementationOnce(() => new Promise((resolve) => { finishExport = resolve; }));
    await click("Download LAS"); expect(button("Remove segment").disabled).toBe(true);
    await act(async () => finishExport({ text: "~Version", fileName: "qa.las" })); await tick();
    expect(button("Remove segment").disabled).toBe(false);
  });
  it("processes eligible members once and only through the curve header, without old segment/review URLs", async () => {
    summary.segments.forEach(({ job }) => { job.quality = null; job.phase = "calibrating"; });
    await render(); await click("Process curve");
    expect(vi.mocked(digitizationGateway.startSegmentation).mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
    expect(host.textContent).toContain("2/2 segments with predictions");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toContain("/digitize/curves/collection");
    expect(button("Process curve").disabled).toBe(true);
  });
  it("shows a processing failure and explicit retry, never approves missing prediction", async () => {
    summary.segments.forEach(({ job }) => { job.quality = null; job.phase = "calibrating"; });
    vi.mocked(digitizationGateway.startSegmentation).mockImplementationOnce(async (id) => replaceJob({ ...summary.segments.find((s) => s.job_id === id)!.job, phase: "failed", error: "Model failed" }));
    await render(); await click("Process curve");
    expect(host.textContent).toContain("Model failed"); expect(host.textContent).toContain("0/2 segments with predictions");
    expect(digitizationGateway.startSegmentation).toHaveBeenCalledTimes(1);
    await click("Retry curve"); expect(host.textContent).toContain("2/2 segments with predictions");
  });
  it("keeps correction strokes/undo isolated when switching members", async () => {
    await render("/digitize/curves/collection?segment=first&view=review");
    await click("Correct trace"); expect(digitizationGateway.setEdits).toHaveBeenLastCalledWith("first", expect.any(Array), 0);
    await selectSegment("second"); expect(button("Undo").disabled).toBe(true);
    await click("Correct trace"); expect(digitizationGateway.setEdits).toHaveBeenLastCalledWith("second", expect.any(Array), 0);
    await selectSegment("first"); await click("Undo");
    expect(digitizationGateway.setEdits).toHaveBeenLastCalledWith("first", [], 1);
    expect(summary.segments[1].job.edits).toHaveLength(1);
  });
  it("renames MAIN/REPEAT compactly without losing prediction or edits", async () => {
    summary.segments[0].job.edits = [{ kind: "discard", y0: 0, y1: 1 }];
    await render();
    await act(async () => (host.querySelector('[aria-label="Rename segment"]') as HTMLButtonElement).click());
    await input('[aria-label="Segment name"]', "MAIN");
    await act(async () => (host.querySelector('[aria-label="Save segment name"]') as HTMLButtonElement).click()); await tick();
    expect(collectionGateway.renameSegment).toHaveBeenCalledWith("collection", "first", "MAIN");
    expect(host.querySelector("#select-segment-first")!.textContent).toContain("MAIN");
    expect(summary.segments[0].job.edits).toHaveLength(1); expect(summary.segments[0].job.quality).not.toBeNull();
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled(); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled(); expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("legacy collection link redirects to one joint result with manual overlap choices and no member outputs", async () => {
    await render("/digitize/collections/collection");
    expect(host.querySelector('[data-testid="location"]')!.textContent).toBe("/digitize/curves/collection?view=result");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(button("Download LAS").disabled).toBe(true); expect(button("Analyze curve").disabled).toBe(true);
    expect(host.querySelectorAll('button')).toSatisfy((buttons: NodeListOf<HTMLButtonElement>) => [...buttons].filter((b) => /Download|Analyze/.test(b.textContent ?? "")).length === 2);
    expect(host.querySelector('select[id^="overlap-"]')!.getAttribute("required")).not.toBeNull();
    expect(host.querySelector('select[id^="overlap-"]')!.getAttribute("value")).toBeNull();
    expect(digitizationGateway.exportLas).not.toHaveBeenCalled(); expect(digitizationGateway.sendToAnalysis).not.toHaveBeenCalled();
  });

  it("cold-loads a running member and mounts usable review when collection polling completes it", async () => {
    summary.segments[0].job.phase = "segmenting"; summary.segments[0].job.quality = null;
    await render("/digitize/curves/collection?segment=first&view=review");
    expect(host.querySelector('[data-testid="review-canvas"]')).toBeNull();
    summary.segments[0].job = segmentJob("first");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    await tick();
    expect(host.querySelector('[data-testid="review-canvas"]')).not.toBeNull();
    await click("Correct trace");
    expect(digitizationGateway.setEdits).toHaveBeenCalledWith("first", expect.any(Array), 0);
    expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });

  it("does not reset calibration drafts or the mounted canvas on collection refresh", async () => {
    await render("/digitize/curves/collection?segment=first&view=cal");
    await input("#cal-value_max", "215");
    const canvas = host.querySelector('[data-testid="original-canvas"]');
    const focusCalls = autofocus.focus.mock.calls.length;
    await act(async () => { await client.refetchQueries({ queryKey: ["digitization", "collection", "collection"] }); });
    await tick();
    expect(host.querySelector('[data-testid="original-canvas"]')).toBe(canvas);
    expect(autofocus.focus).toHaveBeenCalledTimes(focusCalls);
    expect((host.querySelector("#cal-value_max") as HTMLInputElement).value).toBe("215");
    expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });

  it("does not let an older individual job response relock a completed collection member", async () => {
    summary.segments[0].job.phase = "segmenting"; summary.segments[0].job.quality = null;
    const stale = structuredClone(summary.segments[0].job);
    let finish!: (value: JobSummary) => void;
    vi.mocked(digitizationGateway.getJob).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render("/digitize/curves/collection?segment=first&view=review");
    summary.segments[0].job = segmentJob("first");
    await act(async () => { await client.refetchQueries({ queryKey: ["digitization", "collection", "collection"] }); });
    await tick();
    expect(host.querySelector('[data-testid="review-canvas"]')).not.toBeNull();
    await act(async () => finish(stale)); await tick();
    expect(host.querySelector('[data-testid="review-canvas"]')).not.toBeNull();
    await click("Correct trace"); expect(digitizationGateway.setEdits).toHaveBeenCalled();
  });

  it("locks removal, add, selection and inputs until a pending rename settles", async () => {
    let finish!: (value: typeof summary) => void;
    vi.mocked(collectionGateway.renameSegment).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => (host.querySelector('[aria-label="Rename segment"]') as HTMLButtonElement).click());
    await input('[aria-label="Segment name"]', "MAIN");
    await act(async () => (host.querySelector('[aria-label="Save segment name"]') as HTMLButtonElement).click());
    await tick();
    expect(button("Remove segment").disabled).toBe(true); expect(button("+ Add segment").disabled).toBe(true);
    expect((host.querySelector('[aria-label="Segment name"]') as HTMLInputElement).disabled).toBe(true);
    expect((host.querySelector('[aria-label="Save segment name"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[aria-label="Cancel segment name"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector("#select-segment-second") as HTMLButtonElement).disabled).toBe(true);
    summary.segments[0].label = "MAIN";
    await act(async () => finish(structuredClone(summary))); await tick();
    expect(button("Remove segment").disabled).toBe(false);
    await click("Remove segment");
    expect(summary.segments.map(({ job_id }) => job_id)).toEqual(["second"]);
  });

  it("does not reinstall a stale rename summary after external detachment", async () => {
    let finish!: (value: typeof summary) => void;
    const stale = structuredClone(summary);
    vi.mocked(collectionGateway.renameSegment).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => (host.querySelector('[aria-label="Rename segment"]') as HTMLButtonElement).click());
    await input('[aria-label="Segment name"]', "MAIN");
    await act(async () => (host.querySelector('[aria-label="Save segment name"]') as HTMLButtonElement).click()); await tick();
    summary.segments = summary.segments.slice(1); summary.overlaps = []; summary.revision = "externally-detached";
    await act(async () => client.setQueryData(["digitization", "collection", "collection"], structuredClone(summary)));
    stale.segments[0].label = "MAIN";
    await act(async () => finish(stale)); await tick();
    expect(host.querySelector("#select-segment-first")).toBeNull();
    expect(client.getQueryData<typeof summary>(["digitization", "collection", "collection"])?.segments.map(({ job_id }) => job_id)).toEqual(["second"]);
  });

  it("keeps A's input draft private and restores it when A signs in again", async () => {
    await render(); await input("#crop-x-left", "10");
    const key = accountDraftKey("input", API_BASE, "first")!;
    const raw = localStorage.getItem(key);
    endAccountSession(); setSessionAccount("account-b");
    expect(readInputDraft("first")).toBeUndefined(); expect(localStorage.getItem(key)).toBe(raw);
    endAccountSession(); setSessionAccount("account-a");
    expect(readInputDraft("first")?.crop.x_left).toBe(10);
  });

  it("requires explicit verified recovery of older input drafts and leaves the original intact", async () => {
    const key = `digitization-input-draft:${API_BASE}:first`;
    const calibration = Object.fromEntries(Object.entries(summary.segments[0].job.calibration!).map(([field, value]) => [field, String(value)]));
    const raw = JSON.stringify({ crop: { ...summary.segments[0].job.crop, x_left: 10 }, touched: true, calibration });
    localStorage.setItem(key, raw); await render();
    expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("0");
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    await click("Recover older input draft");
    expect((host.querySelector("#crop-x-left") as HTMLInputElement).value).toBe("10");
    expect(localStorage.getItem(key)).toBe(raw); expect(readInputDraft("first")?.crop.x_left).toBe(10);
    expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
  });
});
