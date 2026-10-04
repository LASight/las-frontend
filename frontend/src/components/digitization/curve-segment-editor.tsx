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
import styles from "../../workspaces/curve-workspace.module.css";
import { defaultCrop, normalizeCrop } from "./cropper/crop-rect";
import { trackToCrop } from "./cropper/detected-tracks";
import { TrackCropper } from "./cropper/track-cropper";
import { RasterViewport } from "./raster-viewport";

type CalibrationDraft = Record<keyof TrackCalibration, string>;
export type SegmentDraft = { crop: TrackCrop; touched: boolean; calibration: CalibrationDraft };
export type CurveView = "crop" | "cal" | "review" | "result";
const EMPTY_CALIBRATION: CalibrationDraft = { value_min: "", value_max: "", depth_top: "", depth_bottom: "", mnemonic: "", value_unit: "", depth_unit: "", scale: "linear" };
const cropFields = [["x_left", "crop-x-left", "Izquierda"], ["x_right", "crop-x-right", "Derecha"], ["y_top", "crop-y-top", "Arriba"], ["y_bottom", "crop-y-bottom", "Abajo"]] as const;
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
function draftKey(id: string) { return `digitization-input-draft:${API_BASE}:${id}`; }
export function readInputDraft(id: string): SegmentDraft | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftKey(id)) ?? "null") as SegmentDraft | null;
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
  const [selectedProposal, setSelectedProposal] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  useEffect(() => {
    drafts.set(job.job_id, draft); onDraftChange();
    try { localStorage.setItem(draftKey(job.job_id), JSON.stringify(draft)); setStorageError(null); }
    catch { setStorageError("No se pudo guardar el borrador local. Mantené esta página abierta."); }
  }, [draft, drafts, job.job_id]);

  const calibration = parseCalibration(draft.calibration);
  const validation = validateCalibration(calibration, job.crop ? job.crop.x_right - job.crop.x_left : 0);
  const compatible = identityIssue({ ...collection, segments: collection.segments.map((segment) => segment.job_id === job.job_id ? { ...segment, job: { ...job, calibration } } : segment) });
  const disabled = locked || job.phase === "segmenting";
  const cropChanged = JSON.stringify(draft.crop) !== JSON.stringify(job.crop);
  const calibrationChanged = JSON.stringify(draft.calibration) !== JSON.stringify(calibrationDraft(job.calibration));
  const save = useMutation({
    mutationFn: async (kind: "crop" | "cal") => {
      const latest = await digitizationGateway.getJob(job.job_id);
      if (latest.phase === "segmenting") throw new Error("Esperá a que termine el procesamiento de este tramo.");
      if ((latest.quality || (latest.edits?.length ?? 0) > 0) && !window.confirm("Cambiar este recorte o calibración eliminará la predicción y las correcciones de este tramo. Los otros tramos se conservan. ¿Continuar?")) return null;
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
  useEffect(() => { onBusyChange(save.isPending); return () => onBusyChange(false); }, [save.isPending, onBusyChange]);
  function updateCal(key: keyof TrackCalibration, value: string) {
    setDraft((previous) => ({ ...previous, calibration: { ...previous.calibration, [key]: value } }));
  }
  const busy = disabled || save.isPending;
  if (view === "review" && job.quality && job.phase !== "segmenting") return <SegmentReview key={`review:${job.job_id}`} job={job} collection={collection} locked={locked} />;
  const showCrop = view === "crop" || view === "review";
  return <div className={styles.editor}>
    <section className={styles.canvas}>
      <div className={styles.canvasTitle}><strong>Escaneo original · {collection.segments.find((s) => s.job_id === job.job_id)?.label}</strong><span className={styles.muted}>{draft.crop.x_right - draft.crop.x_left} × {draft.crop.y_bottom - draft.crop.y_top} px</span></div>
      <TrackCropper key={`cropper:${job.job_id}`} job={job} crop={draft.crop} compact focusSavedCropStart
        otherSelections={collection.segments.flatMap((segment) => segment.job_id !== job.job_id && segment.job.crop ? [{ id: segment.job_id, label: segment.label, crop: segment.job.crop }] : [])}
        onChange={(crop) => { if (!busy) setDraft((previous) => ({ ...previous, crop, touched: true })); }}
        detectedTracks={job.detection?.tracks ?? []} selectedTrackIndex={selectedProposal}
        onSelectTrack={(proposal) => { if (!busy) { setSelectedProposal(proposal.index); setDraft((previous) => ({ ...previous, crop: trackToCrop(proposal, job.raster), touched: true })); } }} />
      <details className={styles.help}><summary>Cómo seleccionar un tramo</summary><p>Mové y ajustá el rectángulo al tramo de la curva. Añadí sus continuaciones desde el rail. Las propuestas de layout son sólo recortes sugeridos: no leen profundidades ni prueban continuidad, y pueden omitir tramos.</p></details>
    </section>
    <aside className={styles.inspector}>
      <SegmentName job={job} collection={collection} disabled={busy} />
      <h2>{showCrop ? "Recorte del tramo" : "Calibración del tramo"}</h2>
      {view === "review" && <p className={styles.notice}>{job.phase === "failed" ? job.error : "Todavía no hay predicción. Guardá recorte y calibración, luego usá Procesar curva."}</p>}
      {job.quality && <p className={styles.notice}>Predicción conservada. Modificar datos no la cambia hasta guardar y confirmar el reset.</p>}
      {showCrop ? <>
        <p className={styles.muted}>Seleccioná el tramo sobre el escaneo y confirmá sus límites.</p>
        <details><summary className={styles.muted}>Límites precisos (px)</summary><div className={styles.fields}>
          {cropFields.map(([key, id, label]) => <label className={styles.field} key={`crop-field:${key}`} htmlFor={id}>{label}<input id={id} type="number" step="1" disabled={busy} value={draft.crop[key]} onChange={(event) => setDraft((previous) => ({ ...previous, touched: true, crop: normalizeCrop({ ...previous.crop, [key]: Number(event.target.value) }, job.raster) }))} /></label>)}
        </div></details>
        <button id="save-segment-crop" className={styles.primary} disabled={busy || !draft.touched || !cropChanged} onClick={() => save.mutate("crop")}>{save.isPending ? "Guardando…" : "Confirmar recorte"}</button>
        {!!job.crop && !cropChanged && <button className={styles.secondary} onClick={() => setView("cal")}>Calibrar este tramo</button>}
        <details className={styles.help}><summary>Propuestas de layout</summary>
          <p>{job.detection?.message ?? "Seleccioná manualmente el recorte."}</p>
          <button className={styles.secondary} disabled={busy || detection.isPending} onClick={() => detection.mutate()}>Reintentar detección</button>
        </details>
      </> : <>
        {!job.crop && <p className={styles.notice}>Confirmá primero el recorte.</p>}
        {cropChanged && <p className={styles.notice}>El recorte visible tiene cambios sin guardar. Confirmalos en Recortar antes de calibrar.</p>}
        <div className={styles.fields}>
          {([['value_min', 'Valor izquierdo'], ['value_max', 'Valor derecho'], ['depth_top', 'Profundidad superior'], ['depth_bottom', 'Profundidad inferior']] as const).map(([key, label]) => <label className={styles.field} key={`cal-field:${key}`} htmlFor={`cal-${key}`}>{label}<input id={`cal-${key}`} type="number" step="any" disabled={busy} value={draft.calibration[key]} onChange={(event) => updateCal(key, event.target.value)} /></label>)}
          <label className={styles.field} htmlFor="cal-scale">Escala<select id="cal-scale" disabled={busy} value={draft.calibration.scale} onChange={(e) => updateCal("scale", e.target.value)}><option value="linear">Lineal</option><option value="log">Logarítmica</option></select></label>
          <label className={styles.field} htmlFor="cal-depth-unit">Unidad profundidad<select id="cal-depth-unit" disabled={busy} value={draft.calibration.depth_unit} onChange={(e) => updateCal("depth_unit", e.target.value)}><option value="">Elegir…</option><option value="FT">FT</option><option value="M">M</option></select></label>
          <label className={styles.field} htmlFor="cal-mnemonic">Mnemónico<input id="cal-mnemonic" disabled={busy} value={draft.calibration.mnemonic} onChange={(e) => updateCal("mnemonic", e.target.value)} /></label>
          <label className={styles.field} htmlFor="cal-value-unit">Unidad curva<input id="cal-value-unit" disabled={busy} value={draft.calibration.value_unit} onChange={(e) => updateCal("value_unit", e.target.value)} /></label>
        </div>
        <p className={styles.muted}>Leé escala y profundidades en el escaneo. Cada tramo tiene su propia calibración; mnemónico y unidades deben coincidir.</p>
        {compatible && <p role="alert" className={styles.error}>{compatible}</p>}
        <button id="save-segment-calibration" className={styles.primary} disabled={busy || !job.crop || cropChanged || !validation.isValid || !calibration.depth_unit || !!compatible || !calibrationChanged} onClick={() => save.mutate("cal")}>{save.isPending ? "Guardando…" : "Guardar calibración"}</button>
        {calibrationChanged && <details className={styles.help}><summary>Validación</summary>{Object.entries(validation.errors).map(([key, message]) => <p key={`validation:${key}`}>{message}</p>)}</details>}
        <details className={styles.help}><summary>Copiar escala de otro tramo</summary>
          <select aria-label="Tramo de origen de escala" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Elegir tramo…</option>{collection.segments.filter((s) => s.job_id !== job.job_id && s.job.calibration).map((s) => <option key={`copy:${s.job_id}`} value={s.job_id}>{s.label}</option>)}</select>
          <button className={styles.secondary} disabled={busy || !copyFrom} onClick={() => {
            const source = collection.segments.find((s) => s.job_id === copyFrom)?.job.calibration;
            if (source && window.confirm("¿Copiar sólo escala, mnemónico y unidad de curva al borrador? Las profundidades y su unidad no se copian. Verificá la escala en este tramo antes de guardar.")) setDraft((previous) => ({ ...previous, calibration: { ...previous.calibration, value_min: String(source.value_min), value_max: String(source.value_max), scale: source.scale, mnemonic: source.mnemonic, value_unit: source.value_unit } }));
          }}>Copiar escala al borrador</button>
        </details>
      </>}
      {hasInputChanges(job, draft) && <p className={styles.muted}>Borrador sin guardar. No se aplica al procesar.</p>}
      {hasInputChanges(job, draft) && <button className={styles.secondary} disabled={busy} onClick={() => {
        if (window.confirm("¿Descartar sólo el borrador de recorte y calibración? La predicción y las correcciones guardadas se conservan.")) setDraft({ crop: job.crop ?? defaultCrop(job.raster), touched: !!job.crop, calibration: calibrationDraft(job.calibration) });
      }}>Descartar borrador</button>}
      {[save.error, detection.error, query.error].map((error, index) => error instanceof Error && <p key={`editor-error:${index}`} role="alert" className={styles.error}>{error.message}</p>)}
      {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
    </aside>
  </div>;
}

function SegmentReview({ job, collection, locked }: { job: JobSummary; collection: CollectionSummary; locked: boolean }) {
  const review = useCurveReview(job);
  const jump = useRef<((row: number) => void) | null>(null);
  return <div className={styles.editor}>
    <section className={styles.canvas}>
      {review.isLoading ? <p role="status">Cargando predicción…</p> : review.error ? <p role="alert" className={styles.error}>{review.error}</p> : <RasterViewport key={`raster:${job.job_id}`} job={job} x={review.x} gaps={review.gaps} tool={locked ? "inspect" : review.tool} showMask={review.showMask}
        onStroke={review.applyStroke} onDiscardRange={review.discardRange} registerJump={(fn) => { jump.current = fn; }} />}
    </section>
    <aside className={styles.inspector}>
      <SegmentName job={job} collection={collection} disabled={locked} />
      <h2>Revisar y corregir</h2>
      <div className={styles.tools}>{([["inspect", "Inspeccionar"], ["redraw", "Redibujar"], ["discard", "Descartar"]] as const).map(([tool, label]) => <button className={styles.secondary} key={`tool:${tool}`} aria-pressed={review.tool === tool} disabled={locked} onClick={() => review.setTool(tool)}>{label}</button>)}</div>
      <label className={styles.muted}><input type="checkbox" checked={review.showMask} onChange={(event) => review.setShowMask(event.target.checked)} /> Mostrar máscara</label>
      <span className={styles.muted}>{(job.quality!.coverage * 100).toFixed(0)}% cobertura · {review.edits.length} correcciones</span>
      <div className={styles.actions}><button className={styles.secondary} disabled={locked || !review.canUndo} onClick={review.undo}>Deshacer</button><button className={styles.secondary} disabled={locked || !review.canUndo} onClick={() => { if (window.confirm("¿Quitar las correcciones de este tramo y volver a la predicción original?")) review.reset(); }}>Restaurar predicción</button></div>
      <p role="status" className={styles.muted}>{review.isSaving ? "Guardando correcciones…" : review.hasUnsavedEdits ? "Correcciones sin guardar" : "Correcciones guardadas"}</p>
      {review.saveError && <div role="alert" className={styles.error}>{review.saveError}<button className={styles.secondary} onClick={() => void review.flushEdits().catch(() => {})}>Reintentar guardado</button><button className={styles.secondary} disabled={review.isSaving} onClick={() => { if (window.confirm("¿Descartar el borrador local y cargar las correcciones guardadas?")) void review.restoreSavedEdits(); }}>Cargar correcciones guardadas</button></div>}
      {!!review.gaps.length && <details className={styles.help}><summary>Huecos ({review.gaps.length})</summary>{review.gaps.slice(0, 50).map((gap) => <button className={styles.secondary} key={`review-gap:${gap.y0}`} onClick={() => jump.current?.(gap.y0)}>Filas {gap.y0} – {gap.y1}</button>)}</details>}
      <p className={styles.muted}>{review.status}</p>
      <details className={styles.help}><summary>Herramientas de revisión</summary><p>Redibujá sobre la tinta original. Descartar conserva NULL en esas profundidades. Las correcciones se guardan por tramo con control de revisión; no se exportan por separado.</p></details>
    </aside>
  </div>;
}

function SegmentName({ job, collection, disabled }: { job: JobSummary; collection: CollectionSummary; disabled: boolean }) {
  const client = useQueryClient();
  const label = collection.segments.find((segment) => segment.job_id === job.job_id)?.label ?? "Tramo";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);
  const rename = useMutation({
    mutationFn: () => collectionGateway.renameSegment(collection.collection_id, job.job_id, name.trim()),
    onSuccess: (summary) => {
      client.setQueryData(collectionQueryKey(collection.collection_id), summary);
      const updated = summary.segments.find((segment) => segment.job_id === job.job_id)?.job;
      if (updated) client.setQueryData(jobQueryKey(job.job_id), updated);
      void client.invalidateQueries({ queryKey: ["history"] });
      setEditing(false);
    },
  });
  return <div>
    {editing ? <div className={styles.actions}>
      <label className={styles.field}>Nombre del tramo<input aria-label="Nombre del tramo" autoFocus maxLength={160} disabled={rename.isPending} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim() && !rename.isPending) rename.mutate(); if (event.key === "Escape") setEditing(false); }} /></label>
      <button className={styles.secondary} aria-label="Guardar nombre del tramo" disabled={rename.isPending || !name.trim() || name.trim() === label} onClick={() => rename.mutate()}><Check size={14} /></button>
      <button className={styles.secondary} aria-label="Cancelar nombre del tramo" disabled={rename.isPending} onClick={() => setEditing(false)}><X size={14} /></button>
    </div> : <div className={styles.actions}><strong>{label}</strong><button className={styles.secondary} aria-label="Renombrar tramo" title="Renombrar tramo" disabled={disabled} onClick={() => { setName(label); rename.reset(); setEditing(true); }}><Pencil size={13} /></button></div>}
    {rename.error instanceof Error && <p role="alert" className={styles.error}>{rename.error.message}</p>}
  </div>;
}
