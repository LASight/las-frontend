import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import styles from "../components/digitization/steps/step-layout.module.css";
import unifiedStyles from "./curve-workspace.module.css";
import { CombinedCurvePlot } from "../components/digitization/combined-curve-plot";
import {
  EMPTY_OVERLAP_DRAFT, collectionIssues, collectionOutputIssue,
  readOverlapDraft, reconcileOverlapDraft, unresolvedOverlaps,
} from "../controllers/collection-controller";
import { collectionQueryKey, useCollection } from "../hooks/use-collection";
import { flushCollectionEdits } from "../hooks/use-review-edits";
import { EMPTY_LAS_HEADER, type CollectionExportRequest, type LasHeaderFields } from "../models/digitization-models";
import { collectionGateway } from "../services/collection-service";
import { API_BASE, ApiError } from "../services/http-client";
import { accountDraftKey, getSessionScope, isCurrentSession } from "../services/session-scope";
import { hasLegacyDraft, recoverLegacyDraft } from "../services/legacy-draft-recovery";
import { identityIssue } from "../controllers/curve-queue-controller";

const HEADER_LABELS: Record<keyof LasHeaderFields, string> = {
  well: "Well name", company: "Company", field_name: "Field", location: "Location",
  county: "County", state: "State", country: "Country", api: "API number", uwi: "Unique well ID",
};

function readOutputPreferences(raw: string | null): { header: LasHeaderFields; step: number } | null {
  try {
    const saved = JSON.parse(raw ?? "null");
    if (saved && Number.isFinite(saved.step) && saved.header && Object.keys(EMPTY_LAS_HEADER).every((key) => typeof saved.header[key] === "string")) return saved;
  } catch { /* Never invent well metadata from corrupt storage. */ }
  return null;
}

export function CollectionWorkspace() {
  const { collectionId } = useParams<{ collectionId: string }>();
  return collectionId ? <Navigate to={`/digitize/curves/${encodeURIComponent(collectionId)}?view=result`} replace /> : null;
}

export function CollectionSummaryPage({ collectionId, locked = false, onBusyChange }: { collectionId: string; locked?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useCollection(collectionId);
  const collection = query.data;
  const session = getSessionScope();
  const storageKey = accountDraftKey("collection", API_BASE, collectionId);
  const [draft, setDraft] = useState(() => {
    try { return readOverlapDraft(storageKey ? localStorage.getItem(storageKey) : null); }
    catch { return EMPTY_OVERLAP_DRAFT; }
  });
  const [storageError, setStorageError] = useState<string | null>(null);
  const outputKey = accountDraftKey("output", API_BASE, collectionId);
  const [preferences] = useState(() => {
    try {
      const saved = readOutputPreferences(outputKey ? localStorage.getItem(outputKey) : null);
      if (saved) return saved;
    } catch { /* Never fill unknown well metadata. */ }
    return { header: { ...EMPTY_LAS_HEADER }, step: 0.5 };
  });
  const [header, setHeader] = useState<LasHeaderFields>(preferences.header);
  const [step, setStep] = useState(preferences.step);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  useEffect(() => {
    if (!outputKey || !isCurrentSession(session)) return;
    try {
      if (step === .5 && Object.values(header).every((value) => value === "") && localStorage.getItem(outputKey) === null) return;
      localStorage.setItem(outputKey, JSON.stringify({ header, step })); setPreferencesError(null);
    }
    catch { setPreferencesError("The output draft could not be saved locally. Keep this page open."); }
  }, [outputKey, header, step, session]);
  const [preview, setPreview] = useState<string | null>(null);
  // Validate synchronously as well as on persistence: a refetch must not leave a
  // one-render window where an obsolete choice can be exported.
  const currentDraft = collection ? reconcileOverlapDraft(draft, collection.overlaps) : draft;
  useEffect(() => {
    if (!collection) return;
    const next = reconcileOverlapDraft(draft, collection.overlaps);
    if (JSON.stringify(next) !== JSON.stringify(draft)) setDraft(next);
    if (!storageKey || !isCurrentSession(session)) return;
    try {
      if (!Object.keys(next.choices).length && localStorage.getItem(storageKey) === null) return;
      localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(null);
    }
    catch { setStorageError("Overlap draft could not be saved locally. Keep this page open until export."); }
  }, [collection, draft, storageKey, session]);

  async function prepare(request: CollectionExportRequest) {
    if (!collection) throw new Error("Curve unavailable.");
    await flushCollectionEdits(client, collection.segments.map(({ job }) => job));
    const latest = await collectionGateway.get(collectionId);
    client.setQueryData(collectionQueryKey(collectionId), latest);
    if (latest.revision !== request.expected_revision) {
      throw new Error("Curve changed. Review the updated segments and overlaps before exporting again.");
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
  const outputBusy = download.isPending || analyze.isPending || recoveryBusy;
  useEffect(() => { onBusyChange?.(outputBusy); return () => onBusyChange?.(false); }, [outputBusy, onBusyChange]);
  const busy = locked || outputBusy;
  const issues = collection ? collectionIssues(collection) : [];
  const outputIssue = collection ? collectionOutputIssue(collection, step) : null;
  const missing = collection ? unresolvedOverlaps(collection, currentDraft.choices) : [];
  const disabled = !collection || busy || query.isFetching || !!query.error || !!issues.length || !!outputIssue || !!missing.length;
  const request: CollectionExportRequest = {
    header, step, overlap_choices: currentDraft.choices, expected_revision: collection?.revision,
  };
  async function recoverOlder(kind: "collection" | "output") {
    if (!window.confirm("Recover this older local result draft after verifying access to the curve? The original local draft is kept. An account-scoped draft is never overwritten; overlaps still require current valid choices.")) return;
    setRecoveryBusy(true);
    try {
      const raw = await recoverLegacyDraft(kind, collectionId, () => collectionGateway.get(collectionId),
        (value) => kind === "collection" ? readOverlapDraft(value) !== EMPTY_OVERLAP_DRAFT : readOutputPreferences(value) !== null);
      if (!isCurrentSession(session)) return;
      if (kind === "collection") setDraft(readOverlapDraft(raw));
      else { const recovered = readOutputPreferences(raw)!; setHeader(recovered.header); setStep(recovered.step); }
    } catch (error) { if (isCurrentSession(session)) setPreferencesError(error instanceof Error ? error.message : "Draft recovery failed."); }
    finally { if (isCurrentSession(session)) setRecoveryBusy(false); }
  }
  const ranges = collection && !identityIssue(collection) ? collection.segments.filter(({ job }) => !!job.calibration).slice().sort((a, b) => a.job.calibration!.depth_top - b.job.calibration!.depth_top) : [];
  const gaps: Array<[number, number]> = [];
  let bottom: number | undefined;
  for (const { job } of ranges) {
    const cal = job.calibration!;
    if (bottom !== undefined && cal.depth_top > bottom) gaps.push([bottom, cal.depth_top]);
    bottom = Math.max(bottom ?? cal.depth_bottom, cal.depth_bottom);
  }

  return <div className={unifiedStyles.result}>
    <section>
      <h2>Result · {collection?.title ?? "Loading…"}</h2>
      <button type="button" className={unifiedStyles.secondary} disabled={busy || query.isFetching} onClick={() => void query.refetch()}>Refresh result</button>
      {query.isPending && <p role="status">Loading curve…</p>}
      {query.error instanceof Error && <p role="alert" className={styles.error}>{query.error.message}</p>}
      {collection && <>
        <p role="status">{issues.length ? "Segments need attention" : "Segments ready, compatible mnemonic and units"}</p>
        {issues.length > 0 && <ul>{issues.map((issue) => <li key={issue} className={styles.error}>{issue}</li>)}</ul>}
        <table className={unifiedStyles.ranges}><thead><tr><th>Segment</th><th>Depth</th><th title="Rows recovered by the model; not a measure of accuracy or trace identity.">Recovered rows</th></tr></thead><tbody>
          {collection.segments.map((segment) => <tr key={`range:${segment.job_id}`}><td>{segment.label}</td><td>{segment.job.calibration ? `${segment.job.calibration.depth_top} – ${segment.job.calibration.depth_bottom} ${segment.job.calibration.depth_unit}` : "Uncalibrated"}</td><td>{segment.job.quality ? `${(segment.job.quality.coverage * 100).toFixed(1)}%` : "Pending"}</td></tr>)}
        </tbody></table>
        <p className={unifiedStyles.muted}>Recovered rows are not accuracy. Review the trace against the scan.</p>
        {gaps.map(([top, end]) => <p className={unifiedStyles.notice} key={`gap:${top}:${end}`}>Gap {top} – {end}: preserved as NULL.</p>)}
        <CombinedCurvePlot collection={collection} />
      </>}
    </section>

    {collection && <>
      <aside className={unifiedStyles.resultInspector}>
      <section><h2>Overlaps</h2>
        <p className={unifiedStyles.muted}>Choose the segment to keep in each interval. No averaging or automatic choice.</p>
        {!collection.overlaps.length && <p className={unifiedStyles.muted}>No overlaps.</p>}
        {collection.overlaps.map((overlap) => <div className={styles.field} key={overlap.conflict_id}>
          <label className={styles.label} htmlFor={`overlap-${overlap.conflict_id}`}>{overlap.depth_top} – {overlap.depth_bottom} {collection.segments[0]?.job.calibration?.depth_unit} · keep</label>
          <select id={`overlap-${overlap.conflict_id}`} className={styles.input} required disabled={busy} value={currentDraft.choices[overlap.conflict_id] ?? ""} onChange={(event) => {
            setDraft({ ...currentDraft, choices: { ...currentDraft.choices, [overlap.conflict_id]: event.target.value } });
          }}>
            <option value="">Choose segment…</option>
            {overlap.job_ids.map((jobId) => <option value={jobId} key={`choice:${overlap.conflict_id}:${jobId}`}>{collection.segments.find((segment) => segment.job_id === jobId)?.label ?? "Segment unavailable"}</option>)}
          </select>
        </div>)}
        {missing.length > 0 && <p className={styles.notice}>{missing.length} overlap choice(s) required before downloading or analyzing.</p>}
        {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
      </section>

      <details className={unifiedStyles.help}><summary>LAS header (optional)</summary>
        <p>Leave unknown fields blank. The file name is not used as a well name.</p>
        <div className={styles.fieldGrid}>{(Object.keys(HEADER_LABELS) as Array<keyof LasHeaderFields>).map((key) => <div className={styles.field} key={key}>
          <label className={styles.label} htmlFor={`collection-header-${key}`}>{HEADER_LABELS[key]}</label>
          <input id={`collection-header-${key}`} className={styles.input} disabled={busy} value={header[key]} onChange={(event) => setHeader({ ...header, [key]: event.target.value })} />
        </div>)}</div>
      </details>

      <section><h2>One curve · one output</h2>
        {hasLegacyDraft("collection", collectionId) && <button className={unifiedStyles.secondary} disabled={busy} onClick={() => void recoverOlder("collection")}>Recover older overlap draft</button>}
        {hasLegacyDraft("output", collectionId) && <button className={unifiedStyles.secondary} disabled={busy} onClick={() => void recoverOlder("output")}>Recover older output draft</button>}
        <p className={unifiedStyles.muted}>{collection.segments[0]?.job.calibration?.mnemonic} ({collection.segments[0]?.job.calibration?.value_unit}) · Increasing depth, NULL gaps.</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="collection-depth-step">Depth step ({collection.segments[0]?.job.calibration?.depth_unit ?? "uncalibrated"})</label>
          <input id="collection-depth-step" className={styles.input} type="number" min="0" step="any" disabled={busy} value={step} onChange={(event) => setStep(Number(event.target.value))} />
        </div>
        {outputIssue && <p role="alert" className={styles.error}>{outputIssue}</p>}
        {preferencesError && <p role="alert" className={styles.error}>{preferencesError}</p>}
        {[download.error, analyze.error].map((error, index) => error instanceof Error && <p role="alert" className={styles.error} key={index}>{error.message}</p>)}
        <div className={styles.actions}>
          <button type="button" className={unifiedStyles.secondary} disabled={disabled} onClick={() => analyze.mutate(request)}>{analyze.isPending ? "Analyzing…" : "Analyze curve"}</button>
          <button type="button" className={unifiedStyles.primary} disabled={disabled} onClick={() => download.mutate(request)}>{download.isPending ? "Generating…" : "Download LAS"}</button>
        </div>
      </section>
      {preview && <details open><summary>LAS preview</summary><pre className={unifiedStyles.preview}>{preview.split("\n").slice(0, 40).join("\n")}</pre></details>}
      </aside>
    </>}
  </div>;
}
