import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fillEmptyGridMetadata, initialGridDraft, parseGridDraft, validateGridDraft, type GridDraft } from "../controllers/grid-alignment-controller";
import type { GridAlignmentPreview, JobSummary } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE, ApiError } from "../services/http-client";
import { accountDraftKey, getSessionScope, isCurrentSession } from "../services/session-scope";
import { curveQueryKey } from "./use-curve-review";
import { flushCollectionEdits } from "./use-review-edits";

export function alignmentDraftKey(job: JobSummary) {
  return accountDraftKey("alignment", API_BASE, `${job.job_id}:working-raster:${encodeURIComponent(job.geometry_revision ?? "unsupported")}`);
}

function readDraft(job: JobSummary) {
  try { const key = alignmentDraftKey(job); return parseGridDraft(key ? localStorage.getItem(key) : null, job.geometry_revision ?? "") ?? initialGridDraft(job); }
  catch { return initialGridDraft(job); }
}

export function useGridAlignment(job: JobSummary, onSaved: (job: JobSummary) => void) {
  const client = useQueryClient();
  const session = getSessionScope();
  const [draft, setDraft] = useState(() => readDraft(job));
  const draftRef = useRef(draft); draftRef.current = draft;
  const undoStack = useRef<GridDraft[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [draftOwner, setDraftOwner] = useState(() => ({ session, jobId: job.job_id }));
  const [preview, setPreview] = useState<GridAlignmentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const saveLock = useRef(false);
  const latestJob = useRef(job); latestJob.current = job;
  const metadataJob = useRef(job);
  const supported = !!job.geometry_revision && !!digitizationGateway.previewAlignment && !!digitizationGateway.saveAlignment && !!digitizationGateway.deleteAlignment;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setPreview(null); setPreviewing(false); undoStack.current = []; setCanUndo(false); }, [job.geometry_revision, job.job_id, session]);
  useEffect(() => {
    if (draftOwner.session !== session || draftOwner.jobId !== job.job_id) {
      generation.current++; setPreview(null); setDraft(readDraft(job)); setDraftOwner({ session, jobId: job.job_id }); setError(null); setSaving(false);
    }
  }, [session, job.job_id, draftOwner]);
  const update = useCallback((change: (previous: GridDraft) => GridDraft) => {
    const before = draftRef.current, next = change(before);
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    undoStack.current = [...undoStack.current.slice(-49), before]; setCanUndo(true);
    generation.current++; setPreview(null); setPreviewing(false); setError(null); draftRef.current = next; setDraft(next);
  }, []);
  function undo() {
    if (saving || draftOwner.session !== session || draftOwner.jobId !== job.job_id || draft.geometry_revision !== job.geometry_revision) return;
    const previous = undoStack.current.pop(); if (!previous) return;
    generation.current++; setPreview(null); setPreviewing(false); setError(null); draftRef.current = previous; setDraft(previous); setCanUndo(undoStack.current.length > 0);
    return previous;
  }
  useEffect(() => {
    const before = metadataJob.current; metadataJob.current = job;
    if (draftOwner.session !== session || draftOwner.jobId !== job.job_id || before.job_id !== job.job_id) return;
    // The hook also exists during upload/crop/calibration. Its untouched initial
    // suggestions must follow those saved inputs, not become stale empty anchors.
    // A changed/marked draft is never silently moved to another working frame.
    const pristine = !before.alignment && !job.alignment && !draft.anchors.some((a) => a.left.confirmed || a.right.confirmed)
      && JSON.stringify(draft) === JSON.stringify(initialGridDraft(before));
    const next = pristine ? initialGridDraft(job) : fillEmptyGridMetadata(draft, job);
    if (JSON.stringify(next) === JSON.stringify(draft)) return;
    if (next !== draft) { undoStack.current = []; setCanUndo(false); generation.current++; setPreview(null); draftRef.current = next; setDraft(next); }
    // React to calibration arrival/cold load, not each keystroke: a deliberate
    // blank in Advanced remains an editable user draft, not an auto-filled loop.
  }, [job.calibration?.depth_top, job.calibration?.depth_bottom, job.calibration?.depth_unit, job.alignment, job.geometry_revision, job.job_id, session, draftOwner, update]);
  useEffect(() => {
    const key = alignmentDraftKey(job);
    if (!key || !isCurrentSession(session) || draftOwner.session !== session || draftOwner.jobId !== job.job_id || draft.geometry_revision !== job.geometry_revision) return;
    try { localStorage.setItem(key, JSON.stringify(draft)); }
    catch { setError("The reference draft could not be saved locally. Keep this page open."); }
  }, [draft, job.job_id, job.geometry_revision, session, draftOwner]);

  const validation = validateGridDraft(draft, job);
  async function refreshConflict(err: unknown, stillCurrent: () => boolean) {
    if (!(err instanceof ApiError) || err.status !== 409) return;
    try {
      const latest = await digitizationGateway.getJob(job.job_id);
      if (mounted.current && isCurrentSession(session) && stillCurrent()) onSaved(latest);
    } catch { /* Retain the draft/error when the authorized reload also fails. */ }
  }
  async function requestPreview() {
    const spec = validation.spec;
    if (!supported || !spec || saving || draftOwner.session !== session || job.phase === "segmenting" || ["pending", "running"].includes(job.detection?.status ?? "")) return;
    const ticket = ++generation.current;
    const revision = job.geometry_revision!;
    setPreviewing(true); setError(null); setPreview(null);
    try {
      const result = await digitizationGateway.previewAlignment!(job.job_id, { ...spec, expected_geometry_revision: revision });
      if (mounted.current && isCurrentSession(session) && ticket === generation.current && latestJob.current.geometry_revision === revision) setPreview(result);
    } catch (err) {
      if (mounted.current && isCurrentSession(session) && ticket === generation.current) {
        setError(err instanceof Error ? err.message : "Preview failed.");
        await refreshConflict(err, () => ticket === generation.current);
      }
    } finally { if (mounted.current && ticket === generation.current) setPreviewing(false); }
  }

  async function save(remove = false) {
    const spec = validation.spec;
    if (!supported || (!remove && !spec) || saveLock.current || draftOwner.session !== session || job.phase === "segmenting" || ["pending", "running"].includes(job.detection?.status ?? "")) return;
    if (!window.confirm(remove
      ? "Disable grid alignment?\n\nThe old rectangular crop depth mapping will be restored. This segment’s current prediction, corrections and LAS will be archived. Process it again before exporting. The original scan and other segments are kept."
      : "Save grid alignment?\n\nChanged points archive this segment’s prediction, corrections and LAS, then clear its active result. Run Process curve again. Unchanged points keep your work. The original scan and other segments are kept.")) return;
    saveLock.current = true;
    generation.current++; setPreview(null); setPreviewing(false); setSaving(true); setError(null);
    const revision = job.geometry_revision!;
    try {
      let latest = await digitizationGateway.getJob(job.job_id);
      const check = () => {
        if (!isCurrentSession(session)) throw new Error("Session changed. The original account's reference draft is retained.");
        if (latest.geometry_revision !== revision) throw new Error("Source geometry changed (409). Reload the segment and references before saving.");
        if (latest.phase === "segmenting") throw new Error("Wait for processing to finish before changing geometry.");
        if (["pending", "running"].includes(latest.detection?.status ?? "")) throw new Error("Wait for detection to finish before changing geometry.");
      };
      check();
      await flushCollectionEdits(client, [latest]);
      latest = await digitizationGateway.getJob(job.job_id); check();
      if (latest.edits_revision === undefined) throw new Error("This server does not provide revision-safe alignment. Upgrade the digitization API.");
      // Calibration is checked again after flushing: no request based on a
      // stale calibration draft may silently reinterpret the saved depths.
      if (!remove) {
        const current = validateGridDraft(draft, latest);
        if (!current.spec) throw new Error(current.errors.join(" "));
      }
      const guard = { expected_geometry_revision: revision, expected_edits_revision: latest.edits_revision, acknowledge_reset: true };
      const saved = remove ? await digitizationGateway.deleteAlignment!(job.job_id, guard) : await digitizationGateway.saveAlignment!(job.job_id, { ...spec!, ...guard });
      if (!mounted.current || !isCurrentSession(session)) return;
      if (saved.geometry_revision !== revision) client.removeQueries({ queryKey: curveQueryKey(job.job_id) });
      onSaved(saved); undoStack.current = []; setCanUndo(false); setDraft(initialGridDraft(saved));
    } catch (err) { if (mounted.current && isCurrentSession(session)) { setError(err instanceof Error ? err.message : "Grid alignment could not be saved."); await refreshConflict(err, () => true); } }
    finally { saveLock.current = false; if (mounted.current && isCurrentSession(session)) setSaving(false); }
  }
  function cancelPreview() { generation.current++; setPreview(null); setPreviewing(false); }
  function reloadReferences() { update(() => readDraft(job)); undoStack.current = []; setCanUndo(false); }
  return { draft, update, undo, canUndo, preview, previewing, saving, error, validation, supported, requestPreview, save, cancelPreview, reloadReferences };
}
