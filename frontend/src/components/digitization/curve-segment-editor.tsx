import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { validateCalibration } from "../../controllers/calibration-controller";
import { identityIssue } from "../../controllers/curve-queue-controller";
import { curveQueryKey, useCurveReview } from "../../hooks/use-curve-review";
import { jobQueryKey } from "../../hooks/use-digitization-job";
import { collectionQueryKey } from "../../hooks/use-collection";
import { flushCollectionEdits } from "../../hooks/use-review-edits";
import type { CollectionSummary, JobSummary, TrackCalibration, TrackCrop } from "../../models/digitization-models";
import { digitizationGateway } from "../../services/digitization-service";
import { collectionGateway } from "../../services/collection-service";
import { API_BASE } from "../../services/http-client";
import { accountDraftKey, getSessionScope, isCurrentSession } from "../../services/session-scope";
import { hasLegacyDraft, recoverLegacyDraft } from "../../services/legacy-draft-recovery";
import styles from "../../workspaces/curve-workspace.module.css";
import { defaultCrop, normalizeCrop } from "./cropper/crop-rect";
import { trackToCrop } from "./cropper/detected-tracks";
import { TrackCropper } from "./cropper/track-cropper";
import { RasterViewport } from "./raster-viewport";
import { CURVE_METADATA, curveMetadata } from "../../controllers/curve-metadata-controller";
import { MetadataCombobox } from "./metadata-combobox";
import { WorkspaceInspector } from "./workspace-inspector";
import { TrackHeading } from "./track-heading";
import { PredictionControls } from "./prediction-controls";
import { REVIEW_TOOLS } from "./review-tools";

type CalibrationDraft = Record<keyof TrackCalibration, string>;
export type SegmentDraft = { crop: TrackCrop; touched: boolean; calibration: CalibrationDraft };
export type CurveView = "crop" | "cal" | "review" | "result";
const EMPTY_CALIBRATION: CalibrationDraft = { value_min: "", value_max: "", depth_top: "", depth_bottom: "", mnemonic: "", value_unit: "", depth_unit: "", scale: "linear" };
const cropFields = [["x_left", "crop-x-left", "Left"], ["x_right", "crop-x-right", "Right"], ["y_top", "crop-y-top", "Top"], ["y_bottom", "crop-y-bottom", "Bottom"]] as const;
function calibrationDraft(cal: TrackCalibration | null): CalibrationDraft {
  return cal ? Object.fromEntries(Object.entries(cal).map(([key, value]) => [key, String(value)])) as CalibrationDraft : { ...EMPTY_CALIBRATION };
}
export function parseCalibration(draft: CalibrationDraft): TrackCalibration {
  return { ...draft, scale: draft.scale as TrackCalibration["scale"],
    value_min: draft.value_min.trim() ? Number(draft.value_min) : NaN,
    value_max: draft.value_max.trim() ? Number(draft.value_max) : NaN,
    depth_top: draft.depth_top.trim() ? Number(draft.depth_top) : NaN,
    depth_bottom: draft.depth_bottom.trim() ? Number(draft.depth_bottom) : NaN };
}
function draftKey(id: string) { return accountDraftKey("input", API_BASE, id); }
export function readInputDraft(id: string): SegmentDraft | undefined {
  const key = draftKey(id);
  try { return parseInputDraft(key ? localStorage.getItem(key) : null); } catch { return undefined; }
}
function parseInputDraft(raw: string | null): SegmentDraft | undefined {
  try {
    const parsed = JSON.parse(raw ?? "null") as SegmentDraft | null;
    if (parsed && parsed.crop && cropFields.every(([key]) => Number.isFinite(parsed.crop[key])) && typeof parsed.touched === "boolean" &&
      parsed.calibration && Object.keys(EMPTY_CALIBRATION).every((key) => typeof parsed.calibration[key as keyof TrackCalibration] === "string")) return parsed;
  } catch { /* Storage is best effort; never invent calibration. */ }
  return undefined;
}
export function hasInputChanges(job: JobSummary, draft?: SegmentDraft): boolean {
  return !!draft && ((draft.touched && JSON.stringify(draft.crop) !== JSON.stringify(job.crop)) ||
    JSON.stringify(draft.calibration) !== JSON.stringify(calibrationDraft(job.calibration)));
}

export function CurveSegmentEditor({ initialJob, collection, view, drafts, onDraftChange, onSaved, setView, locked, onBusyChange }: {
  initialJob: JobSummary; collection: CollectionSummary; view: CurveView;
  drafts: Map<string, SegmentDraft>; onDraftChange: () => void;
  onSaved: (job: JobSummary) => void; setView: (view: CurveView) => void; locked: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const session = getSessionScope();
  const inputDraftKey = draftKey(initialJob.job_id);
  const query = useQuery({ queryKey: jobQueryKey(initialJob.job_id), queryFn: () => digitizationGateway.getJob(initialJob.job_id),
    initialData: initialJob, refetchInterval: (q) => ["pending", "running"].includes(q.state.data?.detection?.status ?? "") ? 500 : false });
  // Collection polling carries worker state, whereas the job query carries
  // detection. Prefer its fresher prediction/configuration when available.
  const job = query.data ?? initialJob;
  const [draft, setDraft] = useState<SegmentDraft>(() => {
    const cached = drafts.get(job.job_id);
    if (cached) return cached;
    const stored = readInputDraft(job.job_id);
    if (stored) return stored;
    return { crop: job.crop ?? defaultCrop(job.raster), touched: !!job.crop, calibration: calibrationDraft(job.calibration) };
  });
  const [storageError, setStorageError] = useState<string | null>(null);
  const [legacyRecoveryBusy, setLegacyRecoveryBusy] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  useEffect(() => {
    drafts.set(job.job_id, draft); onDraftChange();
    if (!inputDraftKey || !isCurrentSession(session)) return;
    // A pristine viewer need not create a draft. This also leaves room for
    // explicit verified recovery without overwriting an existing owned draft.
    try {
      if (!hasInputChanges(job, draft) && localStorage.getItem(inputDraftKey) === null) return;
      localStorage.setItem(inputDraftKey, JSON.stringify(draft)); setStorageError(null);
    }
    catch { setStorageError("The local draft could not be saved. Keep this page open."); }
  }, [draft, drafts, job.job_id, inputDraftKey, session]);

  const calibration = parseCalibration(draft.calibration);
  const validation = validateCalibration(calibration, job.crop ? job.crop.x_right - job.crop.x_left : 0);
  const compatible = identityIssue({ ...collection, segments: collection.segments.map((segment) => segment.job_id === job.job_id ? { ...segment, job: { ...job, calibration } } : segment) });
  const disabled = locked || job.phase === "segmenting";
  const cropChanged = JSON.stringify(draft.crop) !== JSON.stringify(job.crop);
  const calibrationChanged = JSON.stringify(draft.calibration) !== JSON.stringify(calibrationDraft(job.calibration));
  const save = useMutation({
    mutationFn: async (kind: "crop" | "cal") => {
      const latest = await digitizationGateway.getJob(job.job_id);
      if (latest.phase === "segmenting") throw new Error("Wait for this segment to finish processing.");
      if ((latest.quality || (latest.edits?.length ?? 0) > 0) && !window.confirm("Changing this crop or calibration will remove this segment's prediction and corrections. Other segments are preserved. Continue?")) return null;
      await flushCollectionEdits(client, [latest]);
      // The calibration endpoint alone retains the old arrays. Explicitly
      // invalidate through crop before changing a processed calibration.
      if (kind === "cal" && latest.quality) {
        const reset = await digitizationGateway.setCrop(job.job_id, latest.crop!);
        onSaved(reset);
        client.removeQueries({ queryKey: curveQueryKey(job.job_id) });
      }
      return kind === "crop" ? digitizationGateway.setCrop(job.job_id, draft.crop) : digitizationGateway.setCalibration(job.job_id, calibration);
    },
    onSuccess: (saved, kind) => {
      if (!saved) return;
      onSaved(saved);
      client.removeQueries({ queryKey: curveQueryKey(saved.job_id) });
      setDraft((previous) => ({ ...previous, crop: saved.crop ?? previous.crop, touched: true,
        calibration: kind === "cal" ? calibrationDraft(saved.calibration) : previous.calibration }));
      if (kind === "crop") setView("cal");
    },
    onError: () => { void query.refetch(); },
  });
  const detection = useMutation({ mutationFn: () => digitizationGateway.detectTracks(job.job_id), onSuccess: onSaved });
  useEffect(() => { onBusyChange(save.isPending || renameBusy || legacyRecoveryBusy); }, [save.isPending, renameBusy, legacyRecoveryBusy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  function updateCal(key: keyof TrackCalibration, value: string) {
    setDraft((previous) => ({ ...previous, calibration: { ...previous.calibration, [key]: value } }));
  }
  const busy = disabled || save.isPending || renameBusy || legacyRecoveryBusy;
  const identitySource = collection.segments.find((segment) => segment.job_id !== job.job_id && segment.job.calibration);
  if (view === "review" && job.quality && job.phase !== "segmenting") return <SegmentReview key={`review:${job.job_id}`} job={job} collection={collection} locked={locked || save.isPending} onRenameBusyChange={setRenameBusy} />;
  const showCrop = view === "crop" || view === "review";
  return <div className={styles.editor}>
    <section className={styles.canvas}>
      <div className={styles.canvasTitle}><strong>Original scan · {collection.segments.find((s) => s.job_id === job.job_id)?.label}</strong><span className={styles.muted}>{draft.crop.x_right - draft.crop.x_left} × {draft.crop.y_bottom - draft.crop.y_top} px</span></div>
      <TrackHeading calibration={job.calibration} />
      <TrackCropper key={`cropper:${job.job_id}`} job={job} crop={draft.crop} compact focusSavedCropStart disabled={busy}
        otherSelections={collection.segments.flatMap((segment) => segment.job_id !== job.job_id && segment.job.crop ? [{ id: segment.job_id, label: segment.label, crop: segment.job.crop }] : [])}
        onChange={(crop) => { if (!busy) setDraft((previous) => ({ ...previous, crop, touched: true })); }}
        detectedTracks={job.detection?.tracks ?? []} selectedTrackIndex={selectedProposal}
        onSelectTrack={(proposal) => { if (!busy) { setSelectedProposal(proposal.index); setDraft((previous) => ({ ...previous, crop: trackToCrop(proposal, job.raster), touched: true })); } }} />
      <details className={styles.help}><summary>Crop selection</summary><p>Move and resize the rectangle around this curve segment. Add continuations from the segment rail. Layout proposals do not read depth, establish continuity or identify every segment. The track header shows saved calibration, not unsaved draft values.</p></details>
    </section>
    <WorkspaceInspector>
      <SegmentName job={job} collection={collection} disabled={disabled || save.isPending} onBusyChange={setRenameBusy} />
      <h2>{showCrop ? "Segment crop" : "Segment calibration"}</h2>
      {view === "review" && <p className={styles.notice}>{job.phase === "failed" ? job.error : "No prediction yet. Save crop and calibration, then use Process curve."}</p>}
      {job.quality && <p className={styles.notice}>Prediction preserved. Input changes take effect only after an explicit, confirmed save.</p>}
      {showCrop ? <>
        <p className={styles.muted}>Select this segment on the scan and confirm its bounds.</p>
        <details><summary className={styles.muted}>Precise bounds (px)</summary><div className={styles.fields}>
          {cropFields.map(([key, id, label]) => <label className={styles.field} key={`crop-field:${key}`} htmlFor={id}>{label}<input id={id} type="number" step="1" disabled={busy} value={draft.crop[key]} onChange={(event) => setDraft((previous) => ({ ...previous, touched: true, crop: normalizeCrop({ ...previous.crop, [key]: Number(event.target.value) }, job.raster) }))} /></label>)}
        </div></details>
        <button id="save-segment-crop" className={styles.primary} disabled={busy || !draft.touched || !cropChanged} onClick={() => save.mutate("crop")}>{save.isPending ? "Saving…" : "Confirm crop"}</button>
        {!!job.crop && !cropChanged && <button className={styles.secondary} onClick={() => setView("cal")}>Calibrate segment</button>}
        <details className={styles.help}><summary>Layout proposals</summary>
          <p>{job.detection?.message ?? "Select the crop manually."}</p>
          <button className={styles.secondary} disabled={busy || detection.isPending} onClick={() => detection.mutate()}>Retry detection</button>
        </details>
      </> : <>
        {!job.crop && <p className={styles.notice}>Confirm the crop first.</p>}
        {cropChanged && <p className={styles.notice}>The visible crop has unsaved changes. Confirm them in Crop before calibrating.</p>}
        <h2>Curve identity</h2>
        <div className={styles.field}><label htmlFor="cal-mnemonic">Curve / mnemonic</label><MetadataCombobox id="cal-mnemonic" label="Curve mnemonic" disabled={busy} value={draft.calibration.mnemonic} onChange={(value) => updateCal("mnemonic", value)} choices={CURVE_METADATA} /></div>
        <div className={styles.field}><label htmlFor="cal-value-unit">Value unit</label><MetadataCombobox id="cal-value-unit" label="Value unit" disabled={busy} value={draft.calibration.value_unit} onChange={(value) => updateCal("value_unit", value)} choices={curveMetadata(draft.calibration.mnemonic)?.units ?? []} /></div>
        {identitySource && <button id="use-curve-identity" className={styles.secondary} disabled={busy} onClick={() => {
          const source = identitySource.job.calibration!;
          if (window.confirm(`Use ${source.mnemonic} (${source.value_unit}), depth unit ${source.depth_unit}, from ${identitySource.label}? Only mnemonic and units are copied to this draft. Crop, scale bounds, scale type and depth values remain unchanged. Verify these units against the source before saving.`)) setDraft((previous) => ({ ...previous, calibration: { ...previous.calibration, mnemonic: source.mnemonic, value_unit: source.value_unit, depth_unit: source.depth_unit } }));
        }}>Use curve identity</button>}
        <h2>Scale and depth anchors</h2>
        <div className={styles.fields}>
          {([['value_min', 'Left value'], ['value_max', 'Right value'], ['depth_top', 'Top depth'], ['depth_bottom', 'Bottom depth']] as const).map(([key, label]) => <label className={styles.field} key={`cal-field:${key}`} htmlFor={`cal-${key}`}>{label}<input id={`cal-${key}`} type="number" step="any" disabled={busy} value={draft.calibration[key]} onChange={(event) => updateCal(key, event.target.value)} /></label>)}
          <label className={styles.field} htmlFor="cal-scale">Scale<select id="cal-scale" disabled={busy} value={draft.calibration.scale} onChange={(e) => updateCal("scale", e.target.value)}><option value="linear">Linear</option><option value="log">Logarithmic</option></select></label>
          <label className={styles.field} htmlFor="cal-depth-unit">Depth unit<select id="cal-depth-unit" disabled={busy} value={draft.calibration.depth_unit} onChange={(e) => updateCal("depth_unit", e.target.value)}><option value="">Choose…</option><option value="FT">FT</option><option value="M">M</option></select></label>
        </div>
        <p className={styles.muted}>Read scale and depths from this segment. Shared mnemonic and units; independent anchors.</p>
        {compatible && <p role="alert" className={styles.error}>{compatible}</p>}
        <button id="save-segment-calibration" className={styles.primary} disabled={busy || !job.crop || cropChanged || !validation.isValid || !calibration.depth_unit || !!compatible || !calibrationChanged} onClick={() => save.mutate("cal")}>{save.isPending ? "Saving…" : "Save calibration"}</button>
        {calibrationChanged && <details className={styles.help}><summary>Validation</summary>{Object.entries(validation.errors).map(([key, message]) => <p key={`validation:${key}`}>{message}</p>)}</details>}
        <details className={styles.help}><summary>Copy scale from another segment</summary>
          <select aria-label="Scale source segment" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Choose segment…</option>{collection.segments.filter((s) => s.job_id !== job.job_id && s.job.calibration).map((s) => <option key={`copy:${s.job_id}`} value={s.job_id}>{s.label}</option>)}</select>
          <button className={styles.secondary} disabled={busy || !copyFrom} onClick={() => {
            const source = collection.segments.find((s) => s.job_id === copyFrom)?.job.calibration;
            if (source && window.confirm("Copy only scale, mnemonic and value unit to this draft? Depth values and depth unit are not copied. Verify the scale on this segment before saving.")) setDraft((previous) => ({ ...previous, calibration: { ...previous.calibration, value_min: String(source.value_min), value_max: String(source.value_max), scale: source.scale, mnemonic: source.mnemonic, value_unit: source.value_unit } }));
          }}>Copy scale to draft</button>
        </details>
      </>}
      <details className={styles.help}><summary>Metadata guidance</summary><p>Curve families and unit options are operator-declared suggestions, not model identification or automatic calibration. Use Other / custom by typing the exact source mnemonic or unit. Recommendations never set bounds, depths or units automatically. Model capabilities are unchanged.</p></details>
      {hasInputChanges(job, draft) && <p className={styles.muted}>Unsaved input draft. Not used for processing.</p>}
      {hasInputChanges(job, draft) && <button className={styles.secondary} disabled={busy} onClick={() => {
        if (window.confirm("Discard only this crop/calibration draft? Saved predictions and corrections are preserved.")) setDraft({ crop: job.crop ?? defaultCrop(job.raster), touched: !!job.crop, calibration: calibrationDraft(job.calibration) });
      }}>Discard draft</button>}
      {[save.error, detection.error, query.error].map((error, index) => error instanceof Error && <p key={`editor-error:${index}`} role="alert" className={styles.error}>{error.message}</p>)}
      {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
      {hasLegacyDraft("input", job.job_id) && <button className={styles.secondary} disabled={busy || hasInputChanges(job, draft)} onClick={async () => {
        if (!window.confirm("Recover this older crop/calibration draft after verifying access to this segment? Saved results are unchanged. The original local draft is kept; an existing account draft is never overwritten.")) return;
        setLegacyRecoveryBusy(true);
        try {
          const raw = await recoverLegacyDraft("input", job.job_id, () => digitizationGateway.getJob(job.job_id), (value) => !!parseInputDraft(value));
          if (isCurrentSession(session)) setDraft(parseInputDraft(raw)!);
        } catch (error) { if (isCurrentSession(session)) setStorageError(error instanceof Error ? error.message : "Draft recovery failed."); }
        finally { if (isCurrentSession(session)) setLegacyRecoveryBusy(false); }
      }}>Recover older input draft</button>}
    </WorkspaceInspector>
  </div>;
}

function SegmentReview({ job, collection, locked, onRenameBusyChange }: { job: JobSummary; collection: CollectionSummary; locked: boolean; onRenameBusyChange: (busy: boolean) => void }) {
  const review = useCurveReview(job);
  const jump = useRef<((row: number) => void) | null>(null);
  return <div className={styles.editor}>
    <section className={styles.canvas}>
      <TrackHeading calibration={job.calibration} />
      {review.isLoading ? <p role="status">Loading prediction…</p> : review.error ? <p role="alert" className={styles.error}>{review.error}</p> : <RasterViewport key={`raster:${job.job_id}`} job={job} x={review.x} edits={review.edits} gaps={review.gaps} tool={locked ? "inspect" : review.tool} showMask={review.showMask} showPrediction={review.showPrediction} predictionOpacity={review.predictionOpacity}
        onStroke={(samples) => { if (!locked) review.applyStroke(samples); }} onDiscardRange={(y0, y1) => { if (!locked) review.discardRange(y0, y1); }} registerJump={(fn) => { jump.current = fn; }} />}
    </section>
    <WorkspaceInspector>
      <SegmentName job={job} collection={collection} disabled={locked} onBusyChange={onRenameBusyChange} />
      <h2>Review and correct</h2>
      <div className={styles.tools}>{REVIEW_TOOLS.map(({ id, label, icon: Icon, hint }) => <button type="button" title={hint} className={styles.secondary} key={`tool:${id}`} aria-pressed={review.tool === id} disabled={locked} onClick={() => review.setTool(id)}><Icon size={14} aria-hidden="true" /> {label}</button>)}</div>
      <PredictionControls showPrediction={review.showPrediction} onShowPredictionChange={review.setShowPrediction} predictionOpacity={review.predictionOpacity} onPredictionOpacityChange={review.setPredictionOpacity} />
      <label className={styles.muted}><input type="checkbox" checked={review.showMask} onChange={(event) => review.setShowMask(event.target.checked)} /> Show model mask</label>
      <span className={styles.muted}>{(job.quality!.coverage * 100).toFixed(1)}% recovered rows · {review.edits.length} corrections</span>
      <div className={styles.actions}><button className={styles.secondary} disabled={locked || !review.canUndo} onClick={review.undo}>Undo</button><button className={styles.secondary} disabled={locked || !review.canUndo} onClick={() => { if (window.confirm("Remove this segment's corrections and restore the original prediction?")) review.reset(); }}>Restore prediction</button></div>
      <p role="status" className={styles.muted}>{review.isSaving ? "Saving corrections…" : review.hasUnsavedEdits ? "Unsaved corrections" : "Corrections saved"}</p>
      {review.hasLegacyDraft && <button className={styles.secondary} disabled={locked || review.isSaving || review.hasUnsavedEdits} onClick={() => {
        if (window.confirm("Recover older local corrections after verifying access to this segment? Their original revision is retained; conflicts require an explicit decision. The original local draft is kept, and an account draft is never overwritten.")) void review.recoverLegacyEdits();
      }}>Recover older corrections</button>}
      {review.saveError && <div role="alert" className={styles.error}>{review.saveError}<button className={styles.secondary} onClick={() => void review.flushEdits().catch(() => {})}>Retry saving</button><button className={styles.secondary} disabled={review.isSaving} onClick={() => { if (window.confirm("Discard the local draft and load the saved corrections?")) void review.restoreSavedEdits(); }}>Load saved corrections</button></div>}
      {!!review.gaps.length && <details className={styles.help}><summary>NULL intervals ({review.gaps.length})</summary>{review.gaps.slice(0, 50).map((gap) => <button className={styles.secondary} key={`review-gap:${gap.y0}`} onClick={() => jump.current?.(gap.y0)}>Rows {gap.y0} – {gap.y1}</button>)}</details>}
      <p className={styles.muted}>{review.status}</p>
      <details className={styles.help}><summary>Review tools</summary><p>Pan / Inspect travels without editing. Redraw follows the original ink; Mark missing sets an explicit depth interval to NULL, never erasing the TIFF. Space + drag or middle mouse temporarily pans. Scroll travels, Shift + scroll moves horizontally, and Ctrl/Cmd + scroll or pinch zooms. Escape cancels an active gesture before exiting focus view. Corrections are saved per segment with revision checks, never exported separately. Recovered rows are not accuracy or confidence.</p></details>
    </WorkspaceInspector>
  </div>;
}

function SegmentName({ job, collection, disabled, onBusyChange }: { job: JobSummary; collection: CollectionSummary; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const client = useQueryClient();
  const label = collection.segments.find((segment) => segment.job_id === job.job_id)?.label ?? "Segment";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);
  const rename = useMutation({
    mutationFn: () => collectionGateway.renameSegment(collection.collection_id, job.job_id, name.trim()),
    onSuccess: async () => {
      // A rename response is a snapshot, not authority over membership. Never
      // install it: another client may have detached a member in the meantime.
      await client.invalidateQueries({ queryKey: collectionQueryKey(collection.collection_id) });
      void client.invalidateQueries({ queryKey: ["history"] });
      setEditing(false);
    },
  });
  useEffect(() => { onBusyChange(rename.isPending); }, [rename.isPending, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const formLocked = disabled || rename.isPending;
  return <div>
    {editing ? <div className={styles.actions}>
      <label className={styles.field}>Segment name<input aria-label="Segment name" autoFocus maxLength={160} disabled={formLocked} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (formLocked) return; if (event.key === "Enter" && name.trim()) rename.mutate(); if (event.key === "Escape") setEditing(false); }} /></label>
      <button className={styles.secondary} aria-label="Save segment name" title="Save segment name" disabled={formLocked || !name.trim() || name.trim() === label} onClick={() => rename.mutate()}><Check size={14} /></button>
      <button className={styles.secondary} aria-label="Cancel segment name" title="Cancel segment name" disabled={formLocked} onClick={() => setEditing(false)}><X size={14} /></button>
    </div> : <div className={styles.actions}><strong>{label}</strong><button className={styles.secondary} aria-label="Rename segment" title="Rename segment" disabled={disabled} onClick={() => { setName(label); rename.reset(); setEditing(true); }}><Pencil size={13} /></button></div>}
    {rename.error instanceof Error && <p role="alert" className={styles.error}>{rename.error.message}</p>}
  </div>;
}
