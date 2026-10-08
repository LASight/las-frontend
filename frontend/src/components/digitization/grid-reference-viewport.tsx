import { useEffect, useMemo, useRef, useState } from "react";
import type { GridDraft, ReferenceSide } from "../../controllers/grid-alignment-controller";
import type { GridAlignmentPreview, GridPoint, JobSummary } from "../../models/digitization-models";
import { useLodTiles } from "./cropper/use-lod-tiles";
import { usePanZoom, ZOOM_STEP } from "./cropper/use-pan-zoom";
import { screenToImage } from "./cropper/viewport-transform";
import { useTemporaryPan } from "./cropper/use-temporary-pan";
import { GridAlignmentComparison } from "./grid-alignment-comparison";
import styles from "./grid-alignment.module.css";

/** White working-raster tiles are never transformed or edited here. Reference
 * placement is a one-shot explicit click mode; ordinary navigation cannot place. */
export function GridReferenceViewport({ job, draft, target, placing, disabled, guided = false, preview, onPlace, onCancelPlace, onMoveReference }: {
  job: JobSummary; draft: GridDraft; target: { index: number; side: ReferenceSide }; placing: boolean; disabled: boolean;
  onPlace: (point: GridPoint) => void; onCancelPlace: () => void;
  guided?: boolean; preview?: GridAlignmentPreview | null;
  onMoveReference?: (index: number, side: ReferenceSide, point: GridPoint) => void;
}) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ id: number; start: GridPoint; place: boolean; moved: boolean; adjust?: { index: number; side: ReferenceSide } } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustPoint, setAdjustPoint] = useState<{ index: number; side: ReferenceSide; point: GridPoint } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [placementError, setPlacementError] = useState<string | null>(null);
  const image = useMemo(() => ({ width: job.raster.width, height: job.raster.height }), [job.raster.width, job.raster.height]);
  const pan = usePanZoom({ image, viewport: size, targetRef: host, wheel: "pan" });
  const temporary = useTemporaryPan(host);
  const focused = useRef(false), lastLine = useRef(target.index);
  const selectedDepth = draft.anchors[target.index]?.depth;
  const lastDepth = useRef(selectedDepth);
  const savedPoints = !!job.alignment && draft.geometry_revision === job.geometry_revision && draft.depth_unit === job.alignment.depth_unit && draft.anchors.length === job.alignment.anchors.length && draft.anchors.every((a, i) => {
    const saved = job.alignment!.anchors[i];
    return a.left.confirmed && a.right.confirmed && Number(a.depth) === saved.depth && (["left", "right"] as const).every((side) => Number(a[side].x) === saved[side].x && Number(a[side].y) === saved[side].y);
  });
  useEffect(() => { setPlacementError(null); }, [placing, target.index, target.side]);
  function lineRow(index: number) {
    const a = draft.anchors[index];
    const y = a ? [a.left.y, a.right.y].filter((v) => v.trim()).map(Number).filter(Number.isFinite) : [];
    if (y.length) return y.reduce((sum, v) => sum + v, 0) / y.length;
    // Navigation hint only, never a placed/confirmed reference or invented depth.
    const top = job.crop?.y_top ?? 0, span = (job.crop?.y_bottom ?? image.height) - top;
    const fraction = a?.depth.trim() && job.calibration ? (Number(a.depth) - job.calibration.depth_top) / (job.calibration.depth_bottom - job.calibration.depth_top) : .5;
    return top + (Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : .5) * span;
  }
  useEffect(() => {
    if (!guided || !size.width || !size.height) return;
    if (!focused.current) { focused.current = true; if (job.crop) pan.focusRegionStart(job.crop); lastLine.current = target.index; lastDepth.current = selectedDepth; }
    else if (lastLine.current !== target.index || lastDepth.current !== selectedDepth) { lastLine.current = target.index; lastDepth.current = selectedDepth; pan.centerOnRow(lineRow(target.index)); }
  }, [guided, size.width, size.height, target.index, selectedDepth, job.crop, pan.focusRegionStart, pan.centerOnRow]);
  const tiles = useLodTiles({ jobId: job.job_id, image, view: pan.view, viewport: size, revision: job.geometry_revision });
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: Math.max(240, entry.contentRect.height) }); });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { gesture.current = null; setAdjustPoint(null); pan.endPan(); if (placing || disabled || preview) setAdjusting(false); }, [placing, disabled, preview, target.index, target.side, job.job_id, job.geometry_revision, draft.geometry_revision, pan.endPan]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d"); if (!context || !canvas.current || !size.width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.current.width = Math.round(size.width * dpr); canvas.current.height = Math.round(size.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.fillStyle = "#e9edf2"; context.fillRect(0, 0, size.width, size.height);
    const { scale, tx, ty } = pan.view;
    context.imageSmoothingEnabled = scale < 1;
    for (const tile of tiles.tiles) context.drawImage(tile.bitmap, tile.x0 * scale + tx, tile.y0 * scale + ty, (tile.x1 - tile.x0) * scale, (tile.y1 - tile.y0) * scale);
    if (job.crop) {
      context.strokeStyle = "#687786"; context.lineWidth = 1; context.setLineDash([5, 5]);
      context.strokeRect(job.crop.x_left * scale + tx, job.crop.y_top * scale + ty, (job.crop.x_right - job.crop.x_left) * scale, (job.crop.y_bottom - job.crop.y_top) * scale);
    }
    for (let index = 0; index < draft.anchors.length; index++) {
      const anchor = draft.anchors[index];
      const points = (["left", "right"] as const).map((side) => adjustPoint?.index === index && adjustPoint.side === side ? { ...anchor[side], x: String(adjustPoint.point.x), y: String(adjustPoint.point.y) } : anchor[side]);
      if (guided && !points.some((p) => p.confirmed)) continue;
      const validPoint = (p: typeof anchor.left) => !!p.x.trim() && !!p.y.trim() && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));
      if (!guided && !points.every(validPoint)) continue;
      context.strokeStyle = points.every((p) => p.confirmed) ? "#1958b7" : "#a96716";
      context.lineWidth = 2; context.setLineDash(points.every((p) => p.confirmed) ? [] : [6, 4]); context.beginPath();
      if (points.every(validPoint) && (!guided || points.every((p) => p.confirmed))) { points.forEach((p, i) => { const x = Number(p.x) * scale + tx, y = Number(p.y) * scale + ty; if (!i) context.moveTo(x, y); else context.lineTo(x, y); }); context.stroke(); } context.setLineDash([]);
      points.forEach((p, i) => {
        if (!validPoint(p)) return;
        if (guided && !p.confirmed) return;
        const x = Number(p.x) * scale + tx, y = Number(p.y) * scale + ty;
        context.beginPath(); context.arc(x, y, target.index === index && target.side === (i ? "right" : "left") ? 7 : 5, 0, Math.PI * 2); context.stroke();
        context.fillStyle = "#ffffff"; context.fillRect(x + 9, y - 13, 100, 18); context.fillStyle = context.strokeStyle; context.font = "12px sans-serif";
        context.fillText(`${anchor.depth} ${draft.depth_unit} · ${i ? "R" : "L"}`, x + 11, y);
      });
    }
  }, [size, pan.view, tiles.tiles, job.crop, draft, target, guided, adjustPoint]);
  const local = (event: React.PointerEvent) => { const rect = host.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const jump = (index: number) => {
    const a = draft.anchors[index]; if (!a) return;
    pan.centerOnRow(lineRow(index));
  };
  return <div>
    {preview && <GridAlignmentComparison job={job} preview={preview} />}
    <div hidden={!!preview}>
    {adjusting && <div className={styles.guide} role="status">Adjust points · drag a marked circle. Release to keep the draft change; Escape cancels the drag. Nothing is saved yet.</div>}
    {guided && <div className={styles.guide} role="status" aria-live="polite"><strong>{preview ? "Check the preview before saving" : placing && !disabled ? `Click ${target.side.toUpperCase()} · ${draft.anchors[target.index]?.depth || "selected depth"} ${draft.depth_unit}` : savedPoints ? job.quality ? "Inspect the saved grid alignment" : "Alignment saved — next: Process curve" : "Mark the printed grid — not the curve"}</strong><span>{preview ? "Depth lines should be horizontal and the two scale edges straight. This preview is not saved." : placing && !disabled ? `Use the ${target.side} end of this depth line. ${target.side === "left" ? "Then click its right end." : "This completes the line."} Escape stops marking; Space + drag pans.` : savedPoints ? job.quality ? "These points are already used by the prediction. Open an Edit line section only if you need to change them." : "Choose Done — return to calibration, then Process curve above and Review. Your original scan is kept." : "Choose a depth line in the panel, then Mark both edges. Zoom in to see the intersections clearly."}</span></div>}
    <div className={styles.toolbar}>
      <strong>Original · working raster</strong>
      <button type="button" onClick={() => pan.zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">−</button><button type="button" onClick={() => pan.zoomBy(ZOOM_STEP)} aria-label="Zoom in">+</button>
      <button type="button" onClick={() => pan.zoomTo(1)}>1:1</button><button type="button" onClick={pan.fitWidth}>Fit width</button><button type="button" onClick={pan.fitHeight}>Whole document</button>
       {job.crop && <button type="button" onClick={() => pan.focusRegionStart(job.crop!)}>Focus enclosing crop</button>}
       {onMoveReference && <button type="button" disabled={disabled || placing || !!preview || !draft.anchors.some((a) => a.left.confirmed || a.right.confirmed)} aria-pressed={adjusting} onClick={() => { setAdjusting(!adjusting); setAdjustPoint(null); gesture.current = null; }}> {adjusting ? "Finish adjusting" : "Adjust marked points"}</button>}
      <button type="button" onClick={() => jump(0)}>Top line</button><button type="button" onClick={() => jump(Math.floor((draft.anchors.length - 1) / 2))}>Middle line</button><button type="button" onClick={() => jump(draft.anchors.length - 1)}>Bottom line</button><button type="button" onClick={() => jump(target.index)}>Selected reference</button>
    </div>
    <p className={styles.hint}>{placing && !disabled ? `Set reference: click printed ${target.side.toUpperCase()} scale on line ${target.index + 1}. Escape cancels.` : "Pan / Inspect · drag to travel; scroll to pan; Ctrl/Cmd + scroll to zoom."}</p>
    {job.preprocess?.applied.length ? <p className={styles.hint}>References use the preprocessed working raster, not the exact uploaded image. The uploaded source is unchanged.</p> : null}
     {placementError && <p role="alert" className={styles.prompt}>{placementError}</p>}
     <div ref={host} className={`${styles.host} ${guided ? styles.guidedHost : ""}`} onPointerEnter={temporary.onPointerEnter} onPointerLeave={temporary.onPointerLeave}>
       <canvas ref={canvas} className={styles.canvas} tabIndex={preview ? -1 : 0} aria-hidden={!!preview} role="region" aria-label="Grid reference canvas" style={{ cursor: adjusting ? "move" : placing && !disabled ? "crosshair" : "grab" }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
           const start = local(event), place = placing && !disabled && !preview && event.button === 0 && !temporary.pressed.current;
           let adjust: { index: number; side: ReferenceSide } | undefined;
           if (adjusting && !disabled && !preview && event.button === 0 && !temporary.pressed.current) {
             let nearest = 13;
             draft.anchors.forEach((a, index) => (["left", "right"] as const).forEach((side) => {
               const p = a[side], distance = Math.hypot(Number(p.x)*pan.view.scale+pan.view.tx-start.x, Number(p.y)*pan.view.scale+pan.view.ty-start.y);
               if (p.confirmed && distance < nearest) { nearest = distance; adjust = { index, side }; }
             }));
           }
           gesture.current = { id: event.pointerId, start, place: place && !adjusting, moved: false, adjust }; if (!place && !adjust) pan.beginPan(start);
        }}
         onPointerMove={(event) => { const g = gesture.current; if (!g || g.id !== event.pointerId) return; const p = local(event); if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 4) g.moved = true; if (g.adjust) setAdjustPoint({ ...g.adjust, point: screenToImage(p, pan.view) }); else if (!g.place) pan.panTo(p); }}
        onPointerUp={(event) => {
           const g = gesture.current; if (!g || g.id !== event.pointerId) return; gesture.current = null; pan.endPan();
           setAdjustPoint(null);
           if (g.adjust && g.moved && !disabled && !preview) {
             const p = screenToImage(local(event), pan.view), crop = job.crop;
             if (p.x < 0 || p.x >= image.width || p.y < 0 || p.y >= image.height || (crop && (p.x < crop.x_left || p.x > crop.x_right || p.y < crop.y_top || p.y > crop.y_bottom))) setPlacementError("Point not moved: keep it inside the saved crop. Nothing was changed.");
             else { setPlacementError(null); onMoveReference?.(g.adjust.index, g.adjust.side, p); }
           }
           if (g.place && !g.moved && !disabled && !preview) {
             const p = screenToImage(local(event), pan.view);
             if (guided && job.crop && (p.x < job.crop.x_left || p.x > job.crop.x_right || p.y < job.crop.y_top || p.y > job.crop.y_bottom)) setPlacementError("That point is outside the saved crop. Click inside the dashed rectangle, or return to Crop to enlarge it.");
             else if (p.x >= 0 && p.y >= 0 && p.x < image.width && p.y < image.height) { setPlacementError(null); onPlace(p); }
           }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
         onPointerCancel={() => { gesture.current = null; setAdjustPoint(null); pan.endPan(); }} onLostPointerCapture={() => { gesture.current = null; setAdjustPoint(null); pan.endPan(); }}
         onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); gesture.current = null; setAdjustPoint(null); pan.endPan(); onCancelPlace(); } }} />
      {tiles.error && <p role="alert" className={styles.tileError}>{tiles.error} <button onClick={tiles.retry}>Retry tiles</button></p>}
       {tiles.isLoading && <span className={styles.loading}>Loading tiles…</span>}
      </div>
    </div>
  </div>;
}
