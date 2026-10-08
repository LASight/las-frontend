import { useEffect, useMemo, useRef, useState } from "react";
import type { GridAlignmentPreview, JobSummary } from "../../models/digitization-models";
import { comparisonSourceView } from "../../controllers/alignment-comparison-controller";
import { usePanZoom, ZOOM_STEP } from "./cropper/use-pan-zoom";
import { useLodTiles } from "./cropper/use-lod-tiles";
import styles from "./grid-alignment.module.css";

/** Read-only shared canonical camera: switching views never loses the depth. */
export function GridAlignmentComparison({ job, preview }: { job: JobSummary; preview: GridAlignmentPreview }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [original, setOriginal] = useState(false);
  const gesture = useRef<number | null>(null), fitted = useRef(false);
  const image = useMemo(() => ({ width: preview.alignment.width, height: preview.alignment.height }), [preview.alignment.width, preview.alignment.height]);
  const pan = usePanZoom({ image, viewport: size, targetRef: host, wheel: "pan" });
  const sourceView = comparisonSourceView(preview.alignment, pan.view, size);
  const sourceImage = useMemo(() => ({ width: job.raster.width, height: job.raster.height }), [job.raster.width, job.raster.height]);
  const tiles = useLodTiles({ jobId: original ? job.job_id : undefined, image: sourceImage, view: sourceView, viewport: size, revision: job.geometry_revision });
  useEffect(() => { if (!host.current) return; const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(host.current); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!fitted.current && size.width && size.height) { fitted.current = true; pan.fitHeight(); } }, [size, pan.fitHeight]);
  useEffect(() => {
    gesture.current = null; pan.endPan();
  }, [original, pan.endPan]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d"); if (!ctx || !canvas.current) return;
    const dpr = window.devicePixelRatio || 1; canvas.current.width = Math.round(size.width*dpr); canvas.current.height = Math.round(size.height*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle = "#e9edf2"; ctx.fillRect(0,0,size.width,size.height);
    if (original) for (const tile of tiles.tiles) ctx.drawImage(tile.bitmap, tile.x0*sourceView.scale+sourceView.tx, tile.y0*sourceView.scale+sourceView.ty, (tile.x1-tile.x0)*sourceView.scale, (tile.y1-tile.y0)*sourceView.scale);
  }, [original, size, tiles.tiles, sourceView.scale, sourceView.tx, sourceView.ty]);
  const row = Math.max(0, Math.min(image.height, (size.height/2-pan.view.ty)/pan.view.scale));
  const depth = preview.alignment.anchors[0].depth + row/image.height*(preview.alignment.anchors.at(-1)!.depth-preview.alignment.anchors[0].depth);
  return <section aria-label="Alignment preview comparison">
    <div className={styles.guide} role="status"><strong>{original ? "Original scan · read only" : "Aligned preview · not saved"}</strong><span>Compare the printed lines between your references. The marked lines are straight by construction; this is not a curve-accuracy check.</span></div>
    <div className={styles.toolbar}>
      <button type="button" aria-pressed={original} onClick={() => setOriginal(!original)}>{original ? "Show straightened preview" : "Compare with original scan"}</button>
      <button type="button" aria-label="Zoom out preview" onClick={() => pan.zoomBy(1/ZOOM_STEP)}>−</button>
      <button type="button" onClick={() => pan.zoomBy(ZOOM_STEP)}>Enlarge preview</button>
      <button type="button" onClick={pan.fitHeight}>Fit preview</button>
    </div>
    <p className={styles.hint}>Same depth center: <strong>{depth.toFixed(2)} {preview.alignment.depth_unit}</strong> · matched track-width zoom. Drag / scroll to travel; Ctrl/Cmd + scroll to zoom.</p>
    <div ref={host} className={`${styles.host} ${styles.guidedHost}`} role="region" aria-label="Read-only alignment comparison" tabIndex={0}
      onPointerDown={(event) => { if (event.button !== 0 && event.button !== 1) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = event.pointerId; const rect = event.currentTarget.getBoundingClientRect(); pan.beginPan({ x:event.clientX-rect.left, y:event.clientY-rect.top }); }}
      onPointerMove={(event) => { if (gesture.current !== event.pointerId) return; const rect = event.currentTarget.getBoundingClientRect(); pan.panTo({ x:event.clientX-rect.left, y:event.clientY-rect.top }); }}
      onPointerUp={(event) => { gesture.current = null; pan.endPan(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { gesture.current = null; pan.endPan(); }} onLostPointerCapture={() => { gesture.current = null; pan.endPan(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { gesture.current = null; pan.endPan(); } }}>
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      {!original && <img className={styles.comparisonImage} style={{ left:pan.view.tx, top:pan.view.ty, width:image.width*pan.view.scale, height:image.height*pan.view.scale }} alt="Unsaved aligned grid preview" draggable={false} src={`data:image/png;base64,${preview.preview_png_base64}`} />}
      {original && tiles.isLoading && <span className={styles.loading}>Loading tiles…</span>}
      {original && tiles.error && <p role="alert" className={styles.tileError}>{tiles.error}<button type="button" onClick={tiles.retry}>Retry tiles</button></p>}
    </div>
    <p className={styles.hint}>Preview is a bounded overview ({preview.preview_width} × {preview.preview_height} px). Enlarging does not add detail. Original tiles retain source detail; stretching and shear mean the two views are not pixel-for-pixel identical.</p>
  </section>;
}
