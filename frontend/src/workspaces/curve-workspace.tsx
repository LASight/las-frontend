import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useShellStatus } from "../app-shell-context";
import { CurveSegmentEditor, hasInputChanges, readInputDraft, type CurveView, type SegmentDraft } from "../components/digitization/curve-segment-editor";
import { canProcess, identityIssue, processCurveQueue } from "../controllers/curve-queue-controller";
import { collectionQueryKey, useCollection } from "../hooks/use-collection";
import { jobQueryKey } from "../hooks/use-digitization-job";
import type { CollectionSummary, JobSummary } from "../models/digitization-models";
import { collectionGateway } from "../services/collection-service";
import { digitizationGateway } from "../services/digitization-service";
import { CollectionSummaryPage } from "./collection-workspace";
import styles from "./curve-workspace.module.css";

const VIEWS: Array<[CurveView, string]> = [["crop", "Recortar"], ["cal", "Calibrar"], ["review", "Revisar"], ["result", "Resultado"]];
function segmentStatus(job: JobSummary) {
  if (job.phase === "failed") return "Falló · reintentar";
  if (job.phase === "segmenting") return `Procesando ${job.progress?.windows_done ?? 0}/${job.progress?.windows_total ?? "…"}`;
  if (job.quality) return "Predicción lista · revisar";
  if (!job.crop) return "Seleccionar recorte";
  if (!job.calibration) return "Calibrar";
  return "Listo para procesar";
}

export function CurveWorkspace() {
  const { collectionId } = useParams<{ collectionId: string }>();
  return collectionId ? <UnifiedCurve key={`curve:${collectionId}`} collectionId={collectionId} /> : null;
}

function UnifiedCurve({ collectionId }: { collectionId: string }) {
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
      if (changed) throw new Error(`${changed.label}: guardá o descartá el borrador antes de procesar.`);
      await processCurveQueue(latest, digitizationGateway, publish,
        () => new Promise((resolve) => setTimeout(resolve, 1200)), abort.current.signal);
    },
    onSettled: () => { void query.refetch(); },
  });
  const add = useMutation({
    mutationFn: async () => {
      const labels = new Set(collection?.segments.map((s) => s.label));
      let index = (collection?.segments.length ?? 0) + 1; while (labels.has(`Tramo ${index}`)) index++;
      const job = await collectionGateway.addSegment(collectionId, `Tramo ${index}`);
      publish(job);
      const latest = await collectionGateway.get(collectionId);
      client.setQueryData(collectionQueryKey(collectionId), latest);
      return job;
    },
    onSuccess: (job) => { select(job.job_id, "crop"); void client.invalidateQueries({ queryKey: ["history"] }); },
  });
  const pending = collection?.segments.filter(({ job }) => canProcess(job)).length ?? 0;
  const running = !!collection?.segments.some(({ job }) => job.phase === "segmenting");
  const identity = collection ? identityIssue(collection) : null;
  const unsaved = collection?.segments.filter(({ job }) => hasInputChanges(job, drafts.current.get(job.job_id) ?? readInputDraft(job.job_id))) ?? [];
  const busy = queue.isPending || add.isPending || inputBusy;
  const completed = collection?.segments.filter(({ job }) => !!job.quality && job.phase !== "failed").length ?? 0;
  useShellStatus(collection ? `${collection.title} · ${completed}/${collection.segments.length} tramos con predicción` : "Cargando curva…", busy || running || query.isPending);
  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><h1>{collection?.segments[0]?.job.file_name ?? collection?.title ?? "Cargando escaneo…"}{collection?.segments[0]?.job.calibration ? ` · ${collection.segments[0].job.calibration.mnemonic}` : ""}</h1><span className={styles.muted}>Un documento · una curva · una salida {collection ? `· ${completed}/${collection.segments.length} tramos con predicción` : ""}</span></div>
      <button id="process-curve" className={styles.primary} disabled={!collection || busy || !!query.error || !!identity || !!unsaved.length || (!pending && !running)} onClick={() => queue.mutate()}>{queue.isPending ? "Procesando curva…" : running ? "Seguir procesamiento" : queue.error ? "Reintentar curva" : "Procesar curva"}</button>
    </header>
    {query.error instanceof Error && <p role="alert" className={styles.error}>{query.error.message} <button className={styles.secondary} onClick={() => void query.refetch()}>Reintentar carga</button></p>}
    {identity && <p role="alert" className={styles.error}>{identity}</p>}
    {!!unsaved.length && <p className={styles.notice}>Borradores sin guardar: {unsaved.map((s) => s.label).join(", ")}. Confirmá sus datos antes de procesar. Los resultados guardados no se modifican automáticamente.</p>}
    {[queue.error, add.error].map((error, index) => error instanceof Error && <p role="alert" className={styles.error} key={`workspace-error:${index}`}>{error.message}</p>)}
    {collection && <div className={styles.layout}>
      <aside className={styles.rail} aria-label="Tramos de la curva">
        <h2>Tramos</h2>
        {collection.segments.map((segment) => <button key={`rail:${segment.job_id}`} className={styles.segment} id={`select-segment-${segment.job_id}`} aria-current={segment.job_id === selected?.job_id} disabled={inputBusy} onClick={() => select(segment.job_id, view === "result" ? "crop" : view)}>
          <strong>{segment.label}</strong><small>{segmentStatus(segment.job)}</small>
          <small>{segment.job.calibration ? `${segment.job.calibration.depth_top} – ${segment.job.calibration.depth_bottom} ${segment.job.calibration.depth_unit}` : "Rango por definir"}</small>
          {segment.job.phase === "segmenting" && <progress aria-label={`Progreso ${segment.label}`} value={segment.job.progress?.windows_done ?? 0} max={segment.job.progress?.windows_total || 1} />}
          {segment.job.phase === "failed" && <small className={styles.error}>{segment.job.error}</small>}
        </button>)}
        <button id="add-curve-segment" className={styles.secondary} disabled={busy || running} onClick={() => add.mutate()}>{add.isPending ? "Añadiendo…" : "+ Añadir tramo"}</button>
        <details className={styles.help}><summary>Sobre los tramos</summary><p>Seleccioná todas las continuaciones manualmente sobre el mismo escaneo. Sus profundidades y escalas son independientes. Procesar curva sólo ejecuta tramos calibrados sin predicción, uno por vez.</p></details>
      </aside>
      <section className={styles.surface}>
        <nav className={styles.tabs} role="tablist" aria-label="Herramientas de la curva">{VIEWS.map(([id, label]) => <button key={`view:${id}`} id={`curve-view-${id}`} role="tab" aria-selected={view === id} disabled={inputBusy} onClick={() => selected && select(selected.job_id, id)}>{label}</button>)}</nav>
        {view === "result" ? <CollectionSummaryPage key={`result:${collectionId}`} collectionId={collectionId} /> : selected && <CurveSegmentEditor key={`editor:${selected.job_id}`} initialJob={selected.job} collection={collection} view={view} drafts={drafts.current} onDraftChange={onDraftChange} onBusyChange={setInputBusy}
          locked={queue.isPending || running || add.isPending} onSaved={publish} setView={(next) => select(selected.job_id, next)} />}
      </section>
    </div>}
  </main>;
}
