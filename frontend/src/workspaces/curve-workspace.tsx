import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Maximize, Minimize, Trash2 } from "lucide-react";
import { useWorkspaceFocus } from "../hooks/use-workspace-focus";
import { useShellStatus } from "../app-shell-context";
import { CurveSegmentEditor, hasInputChanges, readInputDraft, type CurveView, type SegmentDraft } from "../components/digitization/curve-segment-editor";
import { canProcess, identityIssue, processCurveQueue } from "../controllers/curve-queue-controller";
import { collectionQueryKey, useCollection } from "../hooks/use-collection";
import { jobQueryKey } from "../hooks/use-digitization-job";
import { flushCollectionEdits } from "../hooks/use-review-edits";
import type { CollectionSummary, JobSummary } from "../models/digitization-models";
import { collectionGateway } from "../services/collection-service";
import { digitizationGateway } from "../services/digitization-service";
import { CollectionSummaryPage } from "./collection-workspace";
import styles from "./curve-workspace.module.css";

const VIEWS: Array<[CurveView, string]> = [["crop", "Crop"], ["cal", "Calibrate"], ["review", "Review"], ["result", "Result"]];
function segmentStatus(job: JobSummary) {
  if (job.phase === "failed") return "Failed · retry required";
  if (job.phase === "segmenting") return `Processing ${job.progress?.windows_done ?? 0}/${job.progress?.windows_total ?? "…"}`;
  if (job.quality) return "Prediction ready · review";
  if (!job.crop) return "Select crop";
  if (!job.calibration) return "Calibrate";
  return "Ready to process";
}

export function CurveWorkspace() {
  const { collectionId } = useParams<{ collectionId: string }>();
  return collectionId ? <UnifiedCurve key={`curve:${collectionId}`} collectionId={collectionId} /> : null;
}

function UnifiedCurve({ collectionId }: { collectionId: string }) {
  const focus = useWorkspaceFocus();
  const client = useQueryClient();
  const query = useCollection(collectionId);
  const collection = query.data;
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view");
  const view: CurveView = VIEWS.some(([id]) => id === requestedView) ? requestedView as CurveView : "crop";
  const selected = collection?.segments.find((s) => s.job_id === params.get("segment")) ?? collection?.segments[0];
  const drafts = useRef(new Map<string, SegmentDraft>());
  const [, redrawDrafts] = useState(0);
  const onDraftChange = useCallback(() => redrawDrafts((n) => n + 1), []);
  const [inputBusy, setInputBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const select = (jobId: string, nextView: CurveView = view) => {
    setParams({ segment: jobId, view: nextView });
  };
  const publish = useCallback((job: JobSummary) => {
    client.setQueryData(jobQueryKey(job.job_id), job);
    client.setQueryData<CollectionSummary>(collectionQueryKey(collectionId), (previous) => previous ? {
      ...previous, segments: previous.segments.map((segment) => segment.job_id === job.job_id ? { ...segment, job } : segment),
    } : previous);
  }, [client, collectionId]);
  const queue = useMutation({
    mutationFn: async () => {
      abort.current = new AbortController();
      const latest = await collectionGateway.get(collectionId);
      client.setQueryData(collectionQueryKey(collectionId), latest);
      const changed = latest.segments.find(({ job }) => hasInputChanges(job, drafts.current.get(job.job_id) ?? readInputDraft(job.job_id)));
      if (changed) throw new Error(`${changed.label}: save or discard the draft before processing.`);
      await processCurveQueue(latest, digitizationGateway, publish,
        () => new Promise((resolve) => setTimeout(resolve, 1200)), abort.current.signal);
    },
    onSettled: () => { void query.refetch(); },
  });
  const add = useMutation({
    mutationFn: async () => {
      const labels = new Set(collection?.segments.map((s) => s.label));
      let index = (collection?.segments.length ?? 0) + 1; while (labels.has(`Segment ${index}`)) index++;
      const job = await collectionGateway.addSegment(collectionId, `Segment ${index}`);
      publish(job);
      const latest = await collectionGateway.get(collectionId);
      client.setQueryData(collectionQueryKey(collectionId), latest);
      return job;
    },
    onSuccess: (job) => { select(job.job_id, "crop"); void client.invalidateQueries({ queryKey: ["history"] }); },
  });
  const remove = useMutation({
    mutationFn: async (jobId: string) => {
      const latest = await collectionGateway.get(collectionId);
      client.setQueryData(collectionQueryKey(collectionId), latest);
      const index = latest.segments.findIndex((segment) => segment.job_id === jobId);
      if (index < 0) throw new Error("This segment is no longer in the curve. Reload the segments.");
      if (latest.segments.length <= 1) throw new Error("Keep at least one segment in the curve.");
      if (latest.segments.some(({ job }) => job.phase === "segmenting")) throw new Error("Wait for processing to finish before removing a segment.");
      // Detach only after this member's pending review edits are durable. Keep
      // its local input drafts and saved job; this is not a destructive delete.
      const job = await digitizationGateway.getJob(jobId);
      await flushCollectionEdits(client, [job]);
      const updated = await collectionGateway.detachSegment(collectionId, jobId);
      return { updated, jobId, nextId: updated.segments[Math.min(index, updated.segments.length - 1)]?.job_id };
    },
    onSuccess: ({ updated, jobId, nextId }) => {
      client.setQueryData(collectionQueryKey(collectionId), updated);
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        if (nextId) next.set("segment", nextId); else next.delete("segment");
        return next;
      });
      void client.invalidateQueries({ queryKey: jobQueryKey(jobId) });
      void client.invalidateQueries({ queryKey: ["history"] });
      void query.refetch();
    },
    onError: () => { void query.refetch(); },
  });
  const pending = collection?.segments.filter(({ job }) => canProcess(job)).length ?? 0;
  const running = !!collection?.segments.some(({ job }) => job.phase === "segmenting");
  const identity = collection ? identityIssue(collection) : null;
  const unsaved = collection?.segments.filter(({ job }) => hasInputChanges(job, drafts.current.get(job.job_id) ?? readInputDraft(job.job_id))) ?? [];
  const busy = queue.isPending || add.isPending || remove.isPending || inputBusy;
  const completed = collection?.segments.filter(({ job }) => !!job.quality && job.phase !== "failed").length ?? 0;
  useShellStatus(collection ? `${collection.title} · ${completed}/${collection.segments.length} segments with predictions` : "Loading curve…", busy || running || query.isPending);
  return <main ref={focus.workspaceRef} className={`${styles.workspace} ${focus.focused ? styles.focusView : ""}`} role={focus.focused ? "dialog" : undefined} aria-modal={focus.focused ? true : undefined} aria-label={focus.focused ? "Curve focus view" : undefined}>
    <header className={styles.header}>
      <div><h1>{collection?.segments[0]?.job.file_name ?? collection?.title ?? "Loading scan…"}{collection?.segments[0]?.job.calibration ? ` · ${collection.segments[0].job.calibration.mnemonic}` : ""}</h1><span className={styles.muted}>One document · one curve · one output {collection ? `· ${completed}/${collection.segments.length} segments with predictions` : ""}</span></div>
      <div className={styles.headerActions}>
        <label className={styles.focusSegment} hidden={!focus.focused}>Segment<select id="focus-view-segment" aria-label="Focus view segment" disabled={inputBusy || remove.isPending} value={selected?.job_id ?? ""} onChange={(event) => select(event.target.value, view === "result" ? "crop" : view)}>{collection?.segments.map((segment) => <option key={`focus-segment:${segment.job_id}`} value={segment.job_id}>{segment.label} · {segmentStatus(segment.job)}</option>)}</select></label>
        <button id="remove-curve-segment" type="button" className={`${styles.secondary} ${styles.removeSegment}`} disabled={!selected || busy || running || query.isFetching || !!query.error || (collection?.segments.length ?? 0) <= 1} title={(collection?.segments.length ?? 0) <= 1 ? "Keep at least one segment in the curve." : `Remove ${selected?.label ?? "the selected segment"} from this curve; saved work is retained.`} onClick={() => {
          if (selected && window.confirm(`Remove "${selected.label}" from this curve?\n\nIt will no longer be included in future joint LAS exports or analyses. The original scan, saved segment work and other segments are kept. Existing exports and analyses are not changed.`)) remove.mutate(selected.job_id);
        }}><Trash2 size={14} aria-hidden="true" /> {remove.isPending ? "Removing…" : "Remove segment"}</button>
        <button id="process-curve" className={styles.primary} disabled={!collection || busy || !!query.error || !!identity || !!unsaved.length || (!pending && !running)} onClick={() => queue.mutate()}>{queue.isPending ? "Processing curve…" : running ? "Resume processing" : queue.error ? "Retry curve" : "Process curve"}</button>
        <button id="curve-focus-view" ref={focus.toggleRef} type="button" className={styles.secondary} aria-pressed={focus.focused} title={focus.focused ? "Exit focus view (Escape outside input fields)" : "Expand this workspace within the window; no browser fullscreen permission needed"} onClick={() => focus.setFocused(!focus.focused)}>{focus.focused ? <Minimize size={14} aria-hidden="true" /> : <Maximize size={14} aria-hidden="true" />} {focus.focused ? "Exit focus view" : "Focus view"}</button>
      </div>
    </header>
    {query.error instanceof Error && <p role="alert" className={styles.error}>{query.error.message} <button className={styles.secondary} onClick={() => void query.refetch()}>Retry loading</button></p>}
    {identity && <p role="alert" className={styles.error}>{identity}</p>}
    {!!unsaved.length && <p className={styles.notice}>Unsaved drafts: {unsaved.map((s) => s.label).join(", ")}. Confirm inputs before processing. Saved results are not changed automatically.</p>}
    {[queue.error, add.error, remove.error].map((error, index) => error instanceof Error && <p role="alert" className={styles.error} key={`workspace-error:${index}`}>{error.message}</p>)}
    {collection && <div className={styles.layout}>
      <aside className={styles.rail} aria-label="Curve segments">
        <h2>Segments</h2>
        {collection.segments.map((segment) => <button key={`rail:${segment.job_id}`} className={styles.segment} id={`select-segment-${segment.job_id}`} aria-current={segment.job_id === selected?.job_id} disabled={inputBusy || remove.isPending} onClick={() => select(segment.job_id, view === "result" ? "crop" : view)}>
          <strong>{segment.label}</strong><small>{segmentStatus(segment.job)}</small>
          <small>{segment.job.calibration ? `${segment.job.calibration.depth_top} – ${segment.job.calibration.depth_bottom} ${segment.job.calibration.depth_unit}` : "Range not specified"}</small>
          {segment.job.phase === "segmenting" && <progress aria-label={`Progress ${segment.label}`} value={segment.job.progress?.windows_done ?? 0} max={segment.job.progress?.windows_total || 1} />}
          {segment.job.phase === "failed" && <small className={styles.error}>{segment.job.error}</small>}
        </button>)}
        <button id="add-curve-segment" className={styles.secondary} disabled={busy || running} onClick={() => add.mutate()}>{add.isPending ? "Adding…" : "+ Add segment"}</button>
        <details className={styles.help}><summary>About segments</summary><p>Select every continuation manually on the same scan. Each segment has its own scale and depth range. Process curve runs calibrated segments without predictions, one at a time.</p></details>
      </aside>
      <section className={styles.surface}>
        <nav className={styles.tabs} role="tablist" aria-label="Curve tools">{VIEWS.map(([id, label]) => <button key={`view:${id}`} id={`curve-view-${id}`} role="tab" aria-selected={view === id} disabled={inputBusy || remove.isPending} onClick={() => selected && select(selected.job_id, id)}>{label}</button>)}</nav>
        {view === "result" ? <CollectionSummaryPage key={`result:${collectionId}`} collectionId={collectionId} locked={remove.isPending} onBusyChange={setInputBusy} /> : selected && <CurveSegmentEditor key={`editor:${selected.job_id}`} initialJob={selected.job} collection={collection} view={view} drafts={drafts.current} onDraftChange={onDraftChange} onBusyChange={setInputBusy}
          locked={queue.isPending || running || add.isPending || remove.isPending} onSaved={publish} setView={(next) => select(selected.job_id, next)} />}
      </section>
    </div>}
  </main>;
}
