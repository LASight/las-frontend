import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import appStyles from "../app.module.css";
import { useShellStatus } from "../app-shell-context";
import { SectionPanel } from "../components/section-panel";
import styles from "../components/digitization/steps/step-layout.module.css";
import exportStyles from "../components/digitization/steps/export-step.module.css";
import {
  EMPTY_OVERLAP_DRAFT, collectionIssues, collectionOutputIssue,
  readOverlapDraft, reconcileOverlapDraft, unresolvedOverlaps,
} from "../controllers/collection-controller";
import { stepForPhase } from "../controllers/digitization-job-controller";
import { collectionQueryKey, useCollection } from "../hooks/use-collection";
import { jobQueryKey } from "../hooks/use-digitization-job";
import { flushCollectionEdits } from "../hooks/use-review-edits";
import { EMPTY_LAS_HEADER, type CollectionExportRequest, type CollectionSummary, type LasHeaderFields } from "../models/digitization-models";
import { collectionGateway } from "../services/collection-service";
import { API_BASE, ApiError } from "../services/http-client";

const HEADER_LABELS: Record<keyof LasHeaderFields, string> = {
  well: "Well name", company: "Company", field_name: "Field", location: "Location",
  county: "County", state: "State", country: "Country", api: "API number", uwi: "Unique well ID",
};

export function CollectionWorkspace() {
  const { collectionId } = useParams<{ collectionId: string }>();
  return collectionId ? <CollectionSummaryPage key={collectionId} collectionId={collectionId} /> : null;
}

export function CollectionSummaryPage({ collectionId }: { collectionId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useCollection(collectionId);
  const collection = query.data;
  const storageKey = `digitization-collection-draft:${API_BASE}:${collectionId}`;
  const [draft, setDraft] = useState(() => {
    try { return readOverlapDraft(localStorage.getItem(storageKey)); }
    catch { return EMPTY_OVERLAP_DRAFT; }
  });
  const [storageError, setStorageError] = useState<string | null>(null);
  const [header, setHeader] = useState<LasHeaderFields>({ ...EMPTY_LAS_HEADER });
  const [step, setStep] = useState(0.5);
  const [preview, setPreview] = useState<string | null>(null);
  // Validate synchronously as well as on persistence: a refetch must not leave a
  // one-render window where an obsolete choice can be exported.
  const currentDraft = collection ? reconcileOverlapDraft(draft, collection.overlaps) : draft;
  useEffect(() => {
    if (!collection) return;
    const next = reconcileOverlapDraft(draft, collection.overlaps);
    if (JSON.stringify(next) !== JSON.stringify(draft)) setDraft(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(null); }
    catch { setStorageError("Overlap draft could not be saved locally. Keep this page open until export."); }
  }, [collection, draft, storageKey]);

  async function prepare(request: CollectionExportRequest) {
    if (!collection) throw new Error("Collection unavailable.");
    await flushCollectionEdits(client, collection.segments.map(({ job }) => job));
    const latest = await collectionGateway.get(collectionId);
    client.setQueryData(collectionQueryKey(collectionId), latest);
    if (latest.revision !== request.expected_revision) {
      throw new Error("Collection changed. Review the updated segments and overlaps before exporting again.");
    }
    const issues = collectionIssues(latest);
    const outputIssue = collectionOutputIssue(latest, request.step);
    if (issues.length || outputIssue || unresolvedOverlaps(latest, request.overlap_choices).length) {
      throw new Error(issues[0] ?? outputIssue ?? "Choose a valid segment for every overlap.");
    }
    return request;
  }
  function refreshOnConflict(error: Error) {
    // Show the error; refresh but NEVER retry/choose/average on behalf of the user.
    if (error instanceof ApiError && error.isConflict) void query.refetch();
  }
  const download = useMutation({
    mutationFn: async (request: CollectionExportRequest) => collectionGateway.exportLas(collectionId, await prepare(request)),
    onError: refreshOnConflict,
    onSuccess: ({ text, fileName }) => {
      setPreview(text);
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = fileName;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      void client.invalidateQueries({ queryKey: ["history"] });
      void query.refetch();
    },
  });
  const analyze = useMutation({
    mutationFn: async (request: CollectionExportRequest) => collectionGateway.sendToAnalysis(collectionId, await prepare(request)),
    onError: refreshOnConflict,
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["history"] });
      navigate(`/analysis?analysis=${encodeURIComponent(result.analysis_id)}`);
    },
  });
  const busy = download.isPending || analyze.isPending;
  const issues = collection ? collectionIssues(collection) : [];
  const outputIssue = collection ? collectionOutputIssue(collection, step) : null;
  const missing = collection ? unresolvedOverlaps(collection, currentDraft.choices) : [];
  const disabled = !collection || busy || query.isFetching || !!query.error || !!issues.length || !!outputIssue || !!missing.length;
  const request: CollectionExportRequest = {
    header, step, overlap_choices: currentDraft.choices, expected_revision: collection?.revision,
  };
  useShellStatus(collection ? `${collection.title} — ${collection.segments.length} independent segments.` : "Loading collection…", busy || query.isFetching);

  return <main className={appStyles.mainBody}>
    <SectionPanel title={collection?.title ?? "Collection summary"}>
      <p className={styles.intro}>One curve, independently calibrated segments from one original raster, including page breaks within that image. Review each segment with its normal wizard. Layout proposals do not prove continuity or read depths; no whole-image OCR or new multi-frame TIFF import.</p>
      <button type="button" className={styles.secondaryBtn} disabled={busy || query.isFetching} onClick={() => void query.refetch()}>Refresh collection</button>
      {query.isPending && <p role="status">Loading collection…</p>}
      {query.error instanceof Error && <p role="alert" className={styles.error}>{query.error.message}</p>}
      {collection && <>
        <p role="status">{issues.length ? "Segments need attention" : "All segments ready with matching mnemonic and units"}</p>
        {issues.length > 0 && <ul>{issues.map((issue) => <li key={issue} className={styles.error}>{issue}</li>)}</ul>}
        {collection.segments.map((segment) => <SegmentRow key={segment.job_id} segment={segment} collection={collection} busy={busy} />)}
        <p className={styles.hint}>Open any segment to add a continuation from the original. Saved edits, tiles and curves are kept by job ID, never by the active selection.</p>
      </>}
    </SectionPanel>

    {collection && <>
      <SectionPanel title="Overlaps — explicit segment choice required">
        <p className={styles.intro}>Choose which segment to keep for EACH interval. No averaging, automatic priority or default selection. Gaps between segments remain NULL; no interpolation across page separations.</p>
        {!collection.overlaps.length && <p>No overlaps reported for the current configuration.</p>}
        {collection.overlaps.map((overlap) => <div className={styles.field} key={overlap.conflict_id}>
          <label className={styles.label} htmlFor={`overlap-${overlap.conflict_id}`}>{overlap.depth_top} – {overlap.depth_bottom} {collection.segments[0]?.job.calibration?.depth_unit} — keep segment</label>
          <select id={`overlap-${overlap.conflict_id}`} className={styles.input} required disabled={busy} value={currentDraft.choices[overlap.conflict_id] ?? ""} onChange={(event) => {
            setDraft({ ...currentDraft, choices: { ...currentDraft.choices, [overlap.conflict_id]: event.target.value } });
          }}>
            <option value="">Choose a segment explicitly…</option>
            {overlap.job_ids.map((jobId) => <option value={jobId} key={jobId}>{collection.segments.find((segment) => segment.job_id === jobId)?.label ?? jobId}</option>)}
          </select>
        </div>)}
        {missing.length > 0 && <p className={styles.notice}>{missing.length} overlap choice(s) still required. Export and analysis are disabled.</p>}
        {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
      </SectionPanel>

      <SectionPanel title="Optional LAS header">
        <p className={styles.intro}>Leave unknown fields blank. The collection title is not used as an invented well name.</p>
        <div className={styles.fieldGrid}>{(Object.keys(HEADER_LABELS) as Array<keyof LasHeaderFields>).map((key) => <div className={styles.field} key={key}>
          <label className={styles.label} htmlFor={`collection-header-${key}`}>{HEADER_LABELS[key]}</label>
          <input id={`collection-header-${key}`} className={styles.input} disabled={busy} value={header[key]} onChange={(event) => setHeader({ ...header, [key]: event.target.value })} />
        </div>)}</div>
      </SectionPanel>

      <SectionPanel title="Combined output">
        <p>{collection.segments[0]?.job.calibration?.mnemonic} ({collection.segments[0]?.job.calibration?.value_unit}) — common units required. Uniform increasing depth; missing values and segment gaps remain NULL. Backend checks revision and output size.</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="collection-depth-step">Depth step ({collection.segments[0]?.job.calibration?.depth_unit ?? "not calibrated"})</label>
          <input id="collection-depth-step" className={styles.input} type="number" min="0" step="any" disabled={busy} value={step} onChange={(event) => setStep(Number(event.target.value))} />
        </div>
        {outputIssue && <p role="alert" className={styles.error}>{outputIssue}</p>}
        {[download.error, analyze.error].map((error, index) => error instanceof Error && <p role="alert" className={styles.error} key={index}>{error.message}</p>)}
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} disabled={disabled} onClick={() => analyze.mutate(request)}>{analyze.isPending ? "Analyzing…" : "Analyze collection in LASight"}</button>
          <button type="button" className={styles.primaryBtn} disabled={disabled} onClick={() => download.mutate(request)}>{download.isPending ? "Building…" : "Download combined LAS"}</button>
        </div>
      </SectionPanel>
    </>}
    {preview && <SectionPanel title="Combined LAS preview"><p className={styles.hint}>First 40 lines of the downloaded file.</p><pre className={exportStyles.preview}>{preview.split("\n").slice(0, 40).join("\n")}</pre></SectionPanel>}
  </main>;
}

function SegmentRow({ segment, collection, busy }: {
  segment: CollectionSummary["segments"][number]; collection: CollectionSummary; busy: boolean;
}) {
  const client = useQueryClient();
  const [label, setLabel] = useState(segment.label);
  useEffect(() => setLabel(segment.label), [segment.label]);
  const update = useMutation({
    mutationFn: (action: "rename" | "detach") => action === "rename"
      ? collectionGateway.renameSegment(collection.collection_id, segment.job_id, label.trim())
      : collectionGateway.detachSegment(collection.collection_id, segment.job_id),
    onSuccess: (result) => {
      client.setQueryData(collectionQueryKey(result.collection_id), result);
      void client.invalidateQueries({ queryKey: jobQueryKey(segment.job_id) });
      void client.invalidateQueries({ queryKey: ["history"] });
    },
  });
  return <div className={styles.field}>
    <Link to={`/digitize/${encodeURIComponent(segment.job_id)}/${stepForPhase(segment.job.phase)}`}>{segment.label} — {segment.job.phase}</Link>
    <p className={styles.hint}>{segment.job.calibration ? `${segment.job.calibration.depth_top} – ${segment.job.calibration.depth_bottom} ${segment.job.calibration.depth_unit}; ${segment.job.calibration.mnemonic} (${segment.job.calibration.value_unit})` : "Not calibrated"}</p>
    <div className={styles.actions}>
      <label htmlFor={`segment-label-${segment.job_id}`}>Segment label</label>
      <input id={`segment-label-${segment.job_id}`} className={styles.input} disabled={busy || update.isPending} value={label} onChange={(event) => setLabel(event.target.value)} />
      <button type="button" className={styles.secondaryBtn} disabled={busy || update.isPending || !label.trim() || label.trim() === segment.label} onClick={() => update.mutate("rename")}>Rename</button>
      <button type="button" className={styles.secondaryBtn} disabled={busy || update.isPending || collection.segments.length <= 1} onClick={() => {
        if (window.confirm(`Detach ${segment.label}? Its saved job will remain in My Files.`)) update.mutate("detach");
      }}>Detach (keep saved job)</button>
    </div>
    {update.error instanceof Error && <p role="alert" className={styles.error}>{update.error.message}</p>}
  </div>;
}
