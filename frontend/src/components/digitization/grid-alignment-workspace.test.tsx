import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionSummary, JobSummary } from "../../models/digitization-models";
import { initialGridDraft } from "../../controllers/grid-alignment-controller";
import { alignmentDraftKey } from "../../hooks/use-grid-alignment";
import { curveQueryKey } from "../../hooks/use-curve-review";
import { digitizationGateway } from "../../services/digitization-service";
import { collectionGateway } from "../../services/collection-service";
import { setSessionAccount } from "../../services/session-scope";
import { gridAlignment, gridJob, gridPreview } from "../../test-fixtures/grid-alignment-fixtures";
import { CurveWorkspace } from "../../workspaces/curve-workspace";

vi.mock("../../app-shell-context", () => ({ useShellStatus: vi.fn() }));
vi.mock("../../services/collection-service", () => ({ collectionGateway: { get: vi.fn(), addSegment: vi.fn(), detachSegment: vi.fn(), renameSegment: vi.fn(), exportLas: vi.fn(), sendToAnalysis: vi.fn() } }));
vi.mock("../../services/digitization-service", () => ({ digitizationGateway: { getJob: vi.fn(), getCurve: vi.fn(), setEdits: vi.fn(), setCrop: vi.fn(), setCalibration: vi.fn(), startSegmentation: vi.fn(), detectTracks: vi.fn(), previewAlignment: vi.fn(), saveAlignment: vi.fn(), deleteAlignment: vi.fn() } }));
vi.mock("./cropper/track-cropper", () => ({ TrackCropper: () => <div data-testid="crop-view">Original scan</div> }));
vi.mock("./cropper/use-lod-tiles", () => ({ useLodTiles: () => ({ tiles: [], error: null, isLoading: false, retry: vi.fn() }) }));
vi.mock("./scan-minimap", () => ({ ScanMinimap: () => null }));
let host: HTMLDivElement, root: Root, client: QueryClient, summary: CollectionSummary;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function tick() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/digitize/curves/collection?segment=grid&view=cal"]}><Routes><Route path="/digitize/curves/:collectionId" element={<CurveWorkspace />} /></Routes></MemoryRouter></QueryClientProvider>)); await tick(); }
function button(text: string) { const target = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text); expect(target, text).toBeDefined(); return target!; }
async function click(text: string) { const target = button(text); expect(target.disabled).toBe(false); await act(async () => target.click()); await tick(); }
async function input(label: string, value: string) { const target = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; expect(target).not.toBeNull(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value); target.dispatchEvent(new Event("input", { bubbles: true })); }); await tick(); }
const member = () => summary.segments[0].job;
describe("manual alignment calibration workflow and workspace interlocks", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); localStorage.clear(); setSessionAccount("grid-operator"); document.body.style.overflow = "";
    summary = { collection_id: "collection", source_job_id: "grid", title: "Manual grid", revision: "collection-v1", segments: [{ job_id: "grid", label: "First segment", job: gridJob() }, { job_id: "second", label: "Continuation", job: { ...gridJob(), job_id: "second", segment_label: "Continuation" } }], overlaps: [], issues: [] };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal("ResizeObserver", class { constructor(private cb: ResizeObserverCallback) {} observe(target: Element) { this.cb([{ target, contentRect: { width: 500, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
    vi.mocked(collectionGateway.get).mockImplementation(async () => structuredClone(summary));
    vi.mocked(digitizationGateway.getJob).mockImplementation(async (id) => structuredClone(summary.segments.find((s) => s.job_id === id)!.job));
    vi.mocked(digitizationGateway.previewAlignment!).mockResolvedValue(gridPreview);
    vi.mocked(digitizationGateway.saveAlignment!).mockImplementation(async () => {
      const job = { ...member(), alignment: gridAlignment, geometry_revision: "geometry-aligned", alignment_history_count: 1, quality: null, edits: [], edits_revision: 1, phase: "calibrating" as const }; summary.segments[0].job = job; return structuredClone(job);
    });
    vi.mocked(digitizationGateway.getCurve).mockResolvedValue({ y0: 0, y1: 200, stride: 1, x: Array(200).fill(50), observed: Array(200).fill(true) });
    vi.mocked(digitizationGateway.startSegmentation).mockImplementation(async (id) => ({ ...summary.segments.find((s) => s.job_id === id)!.job, phase: "reviewing", quality: { coverage: 1, n_rows: 200, n_unrecovered: 0, n_wraps: 0 } }));
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function ownedConfirmedDraft() { localStorage.setItem(alignmentDraftKey(member())!, JSON.stringify({ ...initialGridDraft(gridJob(true)), geometry_revision: member().geometry_revision })); }
  it("adds intermediate lines in arbitrary input order, selects the same line and blocks duplicate/outside depths early", async () => {
    await render(); await click("Align grid… (optional)");
    await click("Add intermediate depth line"); await input("Intermediate line depth","180");
    await click("Add intermediate depth line"); await input("Intermediate line depth","125");
    let d=JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!);
    expect(d.anchors.map((a:{depth:string})=>a.depth)).toEqual(["100","125","180","200"]); expect(host.querySelector<HTMLInputElement>('[aria-label="Intermediate line depth"]')!.value).toBe("125");
    await input("Intermediate line depth","180"); expect(host.textContent).toContain("A reference already exists at 180 FT"); expect(button("Mark both edges").disabled).toBe(true);
    await input("Intermediate line depth","210"); expect(host.textContent).toContain("Use a printed depth between 100 and 200 FT"); expect(button("Mark both edges").disabled).toBe(true);
    await input("Intermediate line depth","120"); expect(button("Mark both edges").disabled).toBe(false);
    await click("Undo last change"); expect(host.querySelector<HTMLInputElement>('[aria-label="Intermediate line depth"]')!.value).toBe("210");
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("orders a legacy draft explicitly while retaining all depth/point pairs and undoing as one action", async () => {
    const d=initialGridDraft(member()); d.anchors=[100,180,125,160,200].map(depth=>({ depth:String(depth),left:{x:"20",y:String(30+(depth-100)*2),confirmed:true},right:{x:"120",y:String(30+(depth-100)*2),confirmed:true} }));
    localStorage.setItem(alignmentDraftKey(member())!,JSON.stringify(d)); await render(); await click("Align grid… (optional)"); await click("Order lines by depth");
    const sorted=JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!); expect(sorted.anchors.map((a:{depth:string})=>a.depth)).toEqual(["100","125","160","180","200"]);
    expect(sorted.anchors[1]).toEqual(d.anchors[2]); expect(button("Preview alignment").disabled).toBe(false);
    await click("Undo last change"); expect(JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!)).toEqual(d); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("enables the guided crosshair after saving calibration on a freshly mounted segment", async () => {
    summary.segments[0].job = { ...gridJob(), calibration: null };
    vi.mocked(digitizationGateway.setCalibration).mockImplementation(async (_, calibration) => {
      const job = { ...member(), calibration }; summary.segments[0].job = job; return structuredClone(job);
    });
    await render(); const cal = gridJob().calibration!;
    for (const [id, value] of [["cal-value_min", cal.value_min], ["cal-value_max", cal.value_max], ["cal-depth_top", cal.depth_top], ["cal-depth_bottom", cal.depth_bottom], ["cal-mnemonic", cal.mnemonic], ["cal-value-unit", cal.value_unit]] as const) {
      const field = host.querySelector<HTMLInputElement>(`#${id}`)!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, String(value)); field.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    await act(async () => { const unit = host.querySelector<HTMLSelectElement>("#cal-depth-unit")!; unit.value = "FT"; unit.dispatchEvent(new Event("change", { bubbles: true })); }); await tick();
    await click("Save calibration"); await click("Align grid… (optional)");
    expect(host.textContent).toContain("Top line · 100 FT"); expect(host.textContent).toContain("Bottom line · 200 FT");
    expect(button("Mark both edges").disabled).toBe(false); await click("Mark both edges");
    expect(host.querySelector<HTMLCanvasElement>('canvas[aria-label="Grid reference canvas"]')!.style.cursor).toBe("crosshair");
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  async function point(x: number, y: number) {
    const canvas = host.querySelector<HTMLCanvasElement>('canvas[aria-label="Grid reference canvas"]')!;
    Object.assign(canvas, { setPointerCapture: () => {}, hasPointerCapture: () => true, releasePointerCapture: () => {} });
    for (const type of ["pointerdown", "pointerup"]) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      await act(async () => canvas.dispatchEvent(event));
    }
    await tick();
  }
  it("guides four source clicks without opening or typing advanced coordinates", async () => {
    await render(); await click("Align grid… (optional)");
    const advanced = [...host.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent === "Advanced coordinates & settings")!;
    expect(advanced.open).toBe(false); expect(host.textContent).toContain("Mark the printed grid — not the curve");
    const canvas = host.querySelector('canvas[aria-label="Grid reference canvas"]');
    await click("Mark both edges"); await point(50, 90);
    expect(host.textContent).toContain("Click RIGHT · 100 FT");
    const draft = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!);
    expect(draft.anchors[0].left.confirmed).toBe(true); expect(draft.anchors[0].right.confirmed).toBe(false);
    expect(button("Confirm and save alignment").disabled).toBe(true);
    await point(380, 90); expect(button("Next: bottom line")).toBeDefined();
    await click("Next: bottom line"); await click("Mark both edges"); await point(50, 180); await point(380, 180);
    expect(button("Preview alignment").disabled).toBe(false); expect(button("Confirm and save alignment").disabled).toBe(false);
    expect(advanced.open).toBe(false); expect(host.querySelector('canvas[aria-label="Grid reference canvas"]')).toBe(canvas);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("re-marking clears both draft confirmations and Escape never adopts the second old point", async () => {
    ownedConfirmedDraft(); await render(); await click("Align grid… (optional)"); await click("Re-mark both edges");
    let draft = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!);
    expect(draft.anchors[0].left.confirmed).toBe(false); expect(draft.anchors[0].right.confirmed).toBe(false);
    await point(50, 90);
    await act(async () => host.querySelector('canvas[aria-label="Grid reference canvas"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await tick(); draft = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!);
    expect(draft.anchors[0].right.confirmed).toBe(false); expect(button("Confirm and save alignment").disabled).toBe(true);
    expect(button("Pan / Inspect").getAttribute("aria-pressed")).toBe("true"); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("can stop to navigate and then resume the right edge without losing the left point", async () => {
    await render(); await click("Align grid… (optional)"); await click("Mark both edges"); await point(50, 90);
    const before = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!).anchors[0].left;
    await click("Stop marking / pan"); await click("Mark right edge"); await point(380, 90);
    const after = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!).anchors[0];
    expect(after.left).toEqual(before); expect(after.right.confirmed).toBe(true);
    expect(button("Next: bottom line")).toBeDefined(); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("rejects an out-of-crop guided click with visible recovery guidance, without storing it", async () => {
    await render(); await click("Align grid… (optional)"); await click("Mark both edges"); await point(1, 90);
    expect(host.textContent).toContain("That point is outside the saved crop");
    const draft = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!);
    expect(draft.anchors[0].left.confirmed).toBe(false); expect(draft.anchors[0].right.confirmed).toBe(false);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("adds a guided intermediate line with no fabricated depth or coordinates", async () => {
    await render(); await click("Align grid… (optional)"); await click("Add intermediate depth line");
    const draft = JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!);
    expect(draft.anchors[1]).toEqual({ depth: "", left: { x: "", y: "", confirmed: false }, right: { x: "", y: "", confirmed: false } });
    expect(button("Mark both edges").disabled).toBe(true);
    await input("Intermediate line depth", "150"); expect(button("Mark both edges").disabled).toBe(false);
    await click("Remove selected intermediate line"); expect(host.querySelectorAll("fieldset")).toHaveLength(2);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("compares a large preview without replacing the source canvas or saving", async () => {
    ownedConfirmedDraft(); await render(); await click("Align grid… (optional)");
    const canvas = host.querySelector('canvas[aria-label="Grid reference canvas"]'); await click("Preview alignment");
    expect(host.querySelector('img[alt="Unsaved aligned grid preview"]')).not.toBeNull();
    await click("Compare with original scan"); expect(host.querySelector('img[alt="Unsaved aligned grid preview"]')).toBeNull();
    expect(host.querySelector('canvas[aria-label="Grid reference canvas"]')).toBe(canvas);
    await click("Show straightened preview"); await click("Back to marking points");
    expect(host.querySelector('canvas[aria-label="Grid reference canvas"]')).toBe(canvas); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("opens an optional manual workflow with explicitly unconfirmed suggested references", async () => {
    await render(); await click("Align grid… (optional)");
    expect(host.textContent).toContain("Unconfirmed references — place on printed grid"); expect(host.querySelectorAll("fieldset")).toHaveLength(2);
    expect(button("Confirm and save alignment").disabled).toBe(true); expect(button("Preview alignment").disabled).toBe(true);
    expect(button("Pan / Inspect").getAttribute("aria-pressed")).toBe("true"); expect(button("Set reference").getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Reference to place"]')!.options).toHaveLength(4);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
  });
  it("supports custom fractional X/Y and requires explicit re-confirmation after editing", async () => {
    ownedConfirmedDraft(); await render(); await click("Align grid… (optional)"); expect(button("Confirm and save alignment").disabled).toBe(false);
    await input("Line 1 left X", "20.25"); expect(button("Confirm and save alignment").disabled).toBe(true);
    const first = host.querySelector("fieldset")!; const confirm = [...first.querySelectorAll("button")].find((b) => b.textContent === "Confirm LEFT coordinates")!;
    await act(async () => confirm.click()); await tick(); expect(button("Confirm and save alignment").disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(alignmentDraftKey(member())!)!).anchors[0].left).toEqual({ x: "20.25", y: "30", confirmed: true });
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("adds only empty intermediate lines, deletes them explicitly and enforces 32 maximum", async () => {
    await render(); await click("Align grid… (optional)"); await click("Add known depth line below");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 2 depth"]')!.value).toBe(""); expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 2 left X"]')!.value).toBe("");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Reference to place"]')!.options).toHaveLength(6);
    await click("Delete intermediate line"); expect(host.querySelectorAll("fieldset")).toHaveLength(2);
    for (let i = 0; i < 30; i++) await click("Add known depth line below");
    expect(host.querySelectorAll("fieldset")).toHaveLength(32); expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "Add known depth line below").every((b) => b.disabled)).toBe(true);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("retains reference draft/canvas through focus changes without adopting geometry or remounting", async () => {
    await render(); await click("Align grid… (optional)"); const canvas = host.querySelector('canvas[aria-label="Grid reference canvas"]');
    await input("Line 1 left X", "25.5"); await click("Focus view"); expect(host.querySelector('canvas[aria-label="Grid reference canvas"]')).toBe(canvas);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 1 left X"]')!.value).toBe("25.5"); await click("Exit focus view"); expect(host.querySelector('canvas[aria-label="Grid reference canvas"]')).toBe(canvas);
    expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled();
  });
  it("never uses preview or cancelled confirmation as a saved geometry change", async () => {
    ownedConfirmedDraft(); await render(); await click("Align grid… (optional)"); await click("Preview alignment");
    expect(host.querySelector('img[alt="Unsaved aligned grid preview"]')).not.toBeNull(); expect(host.textContent).toContain("100 × 200 canonical px");
    vi.mocked(window.confirm).mockReturnValue(false); await click("Confirm and save alignment"); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.setEdits).not.toHaveBeenCalled(); expect(member().alignment).toBeNull();
    await click("Cancel / return to calibration"); expect(member().alignment).toBeNull(); expect(localStorage.getItem(alignmentDraftKey(member())!)).not.toBeNull();
  });
  it("blocks saving when precise input is invalid without rewriting user values", async () => {
    ownedConfirmedDraft(); await render(); await click("Align grid… (optional)"); await input("Line 2 depth", "99");
    expect(button("Confirm and save alignment").disabled).toBe(true); expect(button("Preview alignment").disabled).toBe(true); expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 2 depth"]')!.value).toBe("99");
  });
  it("requires saving calibration changes before aligning, including mismatched endpoints", async () => {
    ownedConfirmedDraft(); await render(); const top = host.querySelector<HTMLInputElement>("#cal-depth_top")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(top, "101"); top.dispatchEvent(new Event("input", { bubbles: true })); }); await tick();
    await click("Align grid… (optional)"); expect(host.textContent).toContain("Save your calibration draft before aligning"); expect(button("Confirm and save alignment").disabled).toBe(true); expect(button("Preview alignment").disabled).toBe(true);
  });
  it("locks processing, result/export navigation, membership and rename during geometry save", async () => {
    ownedConfirmedDraft(); const pending = deferred<JobSummary>(); vi.mocked(digitizationGateway.saveAlignment!).mockReturnValue(pending.promise);
    await render(); await click("Align grid… (optional)"); await click("Focus view"); await click("Confirm and save alignment");
    for (const id of ["process-curve", "remove-curve-segment", "add-curve-segment", "curve-view-result", "select-segment-second"]) expect(host.querySelector<HTMLButtonElement>(`#${id}`)!.disabled, id).toBe(true);
    expect(host.querySelector<HTMLSelectElement>("#focus-view-segment")!.disabled).toBe(true); expect(host.querySelector('button[aria-label="Rename segment"]')).toBeNull();
    expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled(); expect(collectionGateway.exportLas).not.toHaveBeenCalled(); expect(collectionGateway.detachSegment).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ...member(), alignment: gridAlignment, geometry_revision: "geometry-aligned", alignment_history_count: 1 }); }); await tick();
    expect(host.querySelector<HTMLButtonElement>("#curve-view-result")!.disabled).toBe(false); expect(host.textContent).toContain("1 preserved geometry version");
  });
  it("keeps reference drafts per member without affecting another segment's corrections", async () => {
    summary.segments[1].job.edits = [{ kind: "discard", y0: 0, y1: 2 }];
    await render(); await click("Align grid… (optional)"); await input("Line 1 left X", "33"); await click("Cancel / return to calibration");
    await act(async () => host.querySelector<HTMLButtonElement>("#select-segment-second")!.click()); await tick(); await click("Align grid… (optional)");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 1 left X"]')!.value).toBe("10"); await click("Cancel / return to calibration");
    await act(async () => host.querySelector<HTMLButtonElement>("#select-segment-grid")!.click()); await tick(); await click("Align grid… (optional)");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 1 left X"]')!.value).toBe("33"); expect(summary.segments[1].job.edits).toHaveLength(1); expect(digitizationGateway.setEdits).not.toHaveBeenCalled();
  });
  it("reopened saved alignment uses printed reference positions, not crop margins", async () => {
    summary.segments[0].job = gridJob(true); await render(); await click("Align grid… (optional)");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 1 left Y"]')!.value).toBe("30"); expect(host.querySelector<HTMLInputElement>('input[aria-label="Line 3 right Y"]')!.value).toBe("220");
    expect(host.textContent).toContain("Saved alignment"); expect(host.textContent).not.toContain("Unconfirmed references — place on printed grid");
    expect(host.textContent).toContain("Inspect the saved grid alignment"); expect(button("Confirm and save alignment").disabled).toBe(true);
    expect(button("Done — return to calibration")).toBeDefined(); expect(digitizationGateway.startSegmentation).not.toHaveBeenCalled();
  });
  it("Process curve ignores optional unsaved reference drafts and never implicitly saves them", async () => {
    await render(); await click("Align grid… (optional)"); expect(button("Confirm and save alignment").disabled).toBe(true);
    await click("Process curve");
    expect(digitizationGateway.startSegmentation).toHaveBeenCalledTimes(2); expect(digitizationGateway.saveAlignment).not.toHaveBeenCalled(); expect(digitizationGateway.previewAlignment).not.toHaveBeenCalled();
    expect(summary.segments.every((s) => s.job.alignment === null)).toBe(true);
  });
  it("revision-aware calibration delegates archival to the server instead of a no-op identity recrop", async () => {
    summary.segments[0].job = gridJob(true); const previous = structuredClone(member());
    client.setQueryData(curveQueryKey("grid", previous.geometry_revision), { x: [1, 2] });
    vi.mocked(digitizationGateway.setCalibration).mockImplementation(async (_, calibration) => {
      const job = { ...previous, calibration, quality: null, edits: [], edits_revision: 1, phase: "calibrating" as const, alignment_history_count: 2 }; summary.segments[0].job = job; return job;
    });
    await render(); const input = host.querySelector<HTMLInputElement>("#cal-value_max")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "200"); input.dispatchEvent(new Event("input", { bubbles: true })); }); await tick();
    vi.mocked(window.confirm).mockReturnValueOnce(false); await click("Save calibration"); expect(digitizationGateway.setCalibration).not.toHaveBeenCalled();
    await click("Save calibration"); expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("archive"));
    expect(digitizationGateway.setCalibration).toHaveBeenCalledWith("grid", expect.objectContaining({ value_max: 200 })); expect(digitizationGateway.setCrop).not.toHaveBeenCalled();
    expect(member().alignment).toEqual(previous.alignment); expect(member().quality).toBeNull(); expect(client.getQueryData(curveQueryKey("grid", previous.geometry_revision))).toBeUndefined();
  });
});
