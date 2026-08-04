import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { JobSummary, TrackCrop } from "../../../models/digitization-models";
import { ScanMinimap } from "../scan-minimap";
import styles from "./track-cropper.module.css";
import {
  CORNER_HANDLES,
  EDGE_HANDLES,
  type CropHandle,
  cropToScreen,
  cursorForHandle,
  hitTestHandle,
  moveCrop,
  normalizeCrop,
  resizeCrop,
} from "./crop-rect";
import { useLodTiles } from "./use-lod-tiles";
import { ZOOM_STEP, usePanZoom } from "./use-pan-zoom";
import type { Point } from "./viewport-transform";
import { screenToImage } from "./viewport-transform";

/**
 * The crop editor: pan and zoom a raster of any size, bound one track exactly.
 *
 * The MVP digitizes one user-cropped track at a time. That is a scope decision
 * (thesis §1.5.2 puts automatic track detection and OCR out of scope) and also a
 * correctness one: the model trained on single GR tracks, and a whole
 * multi-track scan is a domain shift that produces confident nonsense.
 *
 * Which makes the crop the one input the pipeline cannot recover from, and the
 * reason this is a real editor rather than two draggable lines on a thumbnail.
 * Track edges are a few pixels wide on a raster tens of thousands of pixels
 * tall; picking them needs zoom past 1:1, and the previous whole-log strip
 * offered a third of a source pixel per screen pixel.
 *
 * **The crop is stored in image pixels** (see `crop-rect`), so panning and
 * zooming never disturb it. The user can zoom into the left edge, nudge it to
 * the column, pan away to check the right edge, and the left one is exactly
 * where they left it.
 *
 * No bitmap is produced here. The step submits four numbers and the backend
 * crops the original raster — cropping client-side would mean decoding a
 * 150-megapixel image just to throw most of it away.
 */

type Props = {
  job: JobSummary;
  crop: TrackCrop;
  onChange: (crop: TrackCrop) => void;
};

/** Arrow-key nudge, in image pixels. Shift multiplies it. */
const NUDGE_PX = 1;
const NUDGE_COARSE_PX = 25;

type Drag =
  | { kind: "pan" }
  | { kind: "crop"; handle: CropHandle; lastImagePoint: Point };

export function TrackCropper({ job, crop, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [hoverHandle, setHoverHandle] = useState<CropHandle | null>(null);
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
  const [visibleRows, setVisibleRows] = useState<{ y0: number; y1: number } | null>(
    null
  );

  const image = useMemo(
    () => ({ width: job.raster.width, height: job.raster.height }),
    [job.raster.width, job.raster.height]
  );

  const pan = usePanZoom({ image, viewport, targetRef: stageRef });
  const { view } = pan;

  const { tiles, error, isLoading } = useLodTiles({
    jobId: job.job_id,
    image,
    view,
    viewport,
  });

  // ---- Measurement ------------------------------------------------------
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- Draw -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.width <= 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    context.fillStyle = "#e9edf2";
    context.fillRect(0, 0, viewport.width, viewport.height);

    // Past 1:1 the browser's smoothing turns a hard bilevel edge into a gradient
    // and it stops being possible to say which column a handle sits on.
    context.imageSmoothingEnabled = view.scale < 1;

    // `tiles` arrives coarsest-first, so a sharp tile always lands on top of the
    // blurry stand-in it replaces and a half-loaded zoom never shows background.
    for (const tile of tiles) {
      const x = tile.x0 * view.scale + view.tx;
      const y = tile.y0 * view.scale + view.ty;
      context.drawImage(
        tile.bitmap,
        x,
        y,
        (tile.x1 - tile.x0) * view.scale,
        (tile.y1 - tile.y0) * view.scale
      );
    }
  }, [tiles, view, viewport]);

  // ---- Keep the minimap's window marker in step --------------------------
  useEffect(() => {
    if (viewport.height <= 0) return;
    setVisibleRows({
      y0: Math.max(0, screenToImage({ x: 0, y: 0 }, view).y),
      y1: Math.min(image.height, screenToImage({ x: 0, y: viewport.height }, view).y),
    });
  }, [view, viewport.height, image.height]);

  // ---- Pointer ----------------------------------------------------------
  const localPoint = useCallback((event: React.PointerEvent): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const point = localPoint(event);
    const handle = hitTestHandle(crop, point, view);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (handle) {
      dragRef.current = {
        kind: "crop",
        handle,
        lastImagePoint: screenToImage(point, view),
      };
      setActiveHandle(handle);
    } else {
      dragRef.current = { kind: "pan" };
      pan.beginPan(point);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = localPoint(event);
    const drag = dragRef.current;

    if (!drag) {
      // Only on an actual change: a pointermove fires at the display refresh
      // rate, and setting state unconditionally would re-render the stage sixty
      // times a second just to move the cursor across empty space.
      const next = hitTestHandle(crop, point, view);
      setHoverHandle((current) => (current === next ? current : next));
      return;
    }

    if (drag.kind === "pan") {
      pan.panTo(point);
      return;
    }

    const imagePoint = screenToImage(point, view);
    if (drag.handle === "move") {
      onChange(
        moveCrop(
          crop,
          {
            x: imagePoint.x - drag.lastImagePoint.x,
            y: imagePoint.y - drag.lastImagePoint.y,
          },
          image
        )
      );
      // Track the pointer in image space, not the crop: rounding the crop to
      // whole pixels each frame would otherwise swallow sub-pixel movement and
      // the rectangle would lag behind a slow drag at high zoom.
      drag.lastImagePoint = imagePoint;
    } else {
      onChange(resizeCrop(crop, drag.handle, imagePoint, image));
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragRef.current?.kind === "pan") pan.endPan();
    dragRef.current = null;
    setActiveHandle(null);
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    pan.zoomBy(ZOOM_STEP, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  /** Where a handle currently sits, in image pixels. */
  const handleAnchor = useCallback(
    (handle: CropHandle): Point => ({
      x: handle.includes("right") ? crop.x_right : crop.x_left,
      y: handle.includes("bottom") ? crop.y_bottom : crop.y_top,
    }),
    [crop]
  );

  function nudge(handle: CropHandle, dx: number, dy: number) {
    const anchor = handleAnchor(handle);
    onChange(
      resizeCrop(crop, handle, { x: anchor.x + dx, y: anchor.y + dy }, image)
    );
  }

  function handleHandleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    handle: CropHandle
  ) {
    const step = event.shiftKey ? NUDGE_COARSE_PX : NUDGE_PX;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    nudge(handle, move.x, move.y);
  }

  // ---- Geometry for the overlay -----------------------------------------
  const box = cropToScreen(crop, view);
  const boxWidth = Math.max(0, box.right - box.left);
  const boxHeight = Math.max(0, box.bottom - box.top);

  const zoomLabel =
    view.scale >= 1
      ? `${view.scale.toFixed(view.scale >= 4 ? 0 : 1)}:1`
      : `1:${Math.round(1 / view.scale)}`;

  const cursor = cursorForHandle(activeHandle ?? hoverHandle);

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => pan.zoomBy(1 / ZOOM_STEP)} title="Zoom out">
          −
        </button>
        <span className={styles.zoomLabel}>{zoomLabel}</span>
        <button type="button" onClick={() => pan.zoomBy(ZOOM_STEP)} title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => pan.zoomTo(1)}>
          1:1
        </button>
        <button type="button" onClick={pan.fitWidth}>
          Fit width
        </button>
        <button type="button" onClick={pan.fitHeight}>
          Whole log
        </button>
        <button type="button" onClick={pan.reset}>
          Reset
        </button>

        <span className={styles.spacer} />

        <span className={styles.readout}>
          L {crop.x_left} · R {crop.x_right} · T {crop.y_top} · B {crop.y_bottom}
        </span>
      </div>

      <div className={styles.stageRow}>
        <div
          ref={stageRef}
          className={`${styles.stage} ${pan.isPanning ? styles.stagePanning : ""}`}
          style={{ cursor: pan.isPanning ? "grabbing" : cursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => setHoverHandle(null)}
          onDoubleClick={handleDoubleClick}
        >
          <canvas ref={canvasRef} className={styles.canvas} />

          {/* Dim outside the selection so the chosen track reads as the subject
              rather than as one stripe among several. */}
          <div
            className={styles.shade}
            style={{ left: 0, top: 0, right: 0, height: Math.max(0, box.top) }}
          />
          <div
            className={styles.shade}
            style={{ left: 0, top: box.bottom, right: 0, bottom: 0 }}
          />
          <div
            className={styles.shade}
            style={{
              left: 0,
              top: box.top,
              width: Math.max(0, box.left),
              height: boxHeight,
            }}
          />
          <div
            className={styles.shade}
            style={{ left: box.right, top: box.top, right: 0, height: boxHeight }}
          />

          <div
            className={styles.selection}
            style={{
              left: box.left,
              top: box.top,
              width: boxWidth,
              height: boxHeight,
            }}
          />

          {[1, 2].map((n) => (
            <div
              key={`v${n}`}
              className={styles.guide}
              style={{
                left: box.left + (boxWidth * n) / 3,
                top: box.top,
                width: 1,
                height: boxHeight,
              }}
            />
          ))}
          {[1, 2].map((n) => (
            <div
              key={`h${n}`}
              className={styles.guide}
              style={{
                left: box.left,
                top: box.top + (boxHeight * n) / 3,
                width: boxWidth,
                height: 1,
              }}
            />
          ))}

          {[...EDGE_HANDLES, ...CORNER_HANDLES].map((handle) => (
            <CropHandleButton
              key={handle}
              handle={handle}
              box={box}
              active={activeHandle === handle}
              anchor={handleAnchor(handle)}
              onKeyDown={handleHandleKeyDown}
            />
          ))}

          {error && <div className={styles.error}>{error}</div>}
          {isLoading && !error && <div className={styles.status}>Loading tiles…</div>}
        </div>

          <ScanMinimap
            jobId={job.job_id}
            fileName={job.file_name}
            image={image}
            crop={crop}
            window={visibleRows}
            onSeek={pan.centerOnRow}
          />
        </div>

      <p className={styles.hint}>
        Drag the image to pan, scroll to zoom at the pointer, double-click to zoom
        in. Drag a handle to set an edge; arrow keys nudge it by one pixel, Shift
        by {NUDGE_COARSE_PX}. Panning and zooming never change the selection —
        the four numbers above are raster pixels of the original scan.
      </p>
    </div>
  );
}

/**
 * One resize handle.
 *
 * A real `<button>` rather than a styled div: it comes with a focus ring, tab
 * order and keyboard events, which is what makes the crop settable without a
 * mouse. Pointer events pass through to the stage, which owns the drag — routing
 * a drag through eight separate capture targets would mean eight copies of the
 * same logic and a handle that stops responding the moment the pointer leaves it.
 */
function CropHandleButton({
  handle,
  box,
  active,
  anchor,
  onKeyDown,
}: {
  handle: CropHandle;
  box: { left: number; top: number; right: number; bottom: number };
  active: boolean;
  anchor: Point;
  onKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    handle: CropHandle
  ) => void;
}) {
  const width = Math.max(0, box.right - box.left);
  const height = Math.max(0, box.bottom - box.top);

  const layout: Partial<Record<CropHandle, React.CSSProperties>> = {
    left: { left: box.left - 9, top: box.top, height },
    right: { left: box.right - 9, top: box.top, height },
    top: { left: box.left, top: box.top - 9, width },
    bottom: { left: box.left, top: box.bottom - 9, width },
    "top-left": { left: box.left - 11, top: box.top - 11 },
    "top-right": { left: box.right - 11, top: box.top - 11 },
    "bottom-left": { left: box.left - 11, top: box.bottom - 11 },
    "bottom-right": { left: box.right - 11, top: box.bottom - 11 },
  };

  const corners: Partial<Record<CropHandle, string>> = {
    "top-left": styles.cornerTopLeft,
    "top-right": styles.cornerTopRight,
    "bottom-left": styles.cornerBottomLeft,
    "bottom-right": styles.cornerBottomRight,
  };

  const shape =
    handle === "left" || handle === "right"
      ? styles.edgeVertical
      : handle === "top" || handle === "bottom"
        ? styles.edgeHorizontal
        : `${styles.corner} ${corners[handle] ?? ""}`;

  const label = handle.replace("-", " ");
  const position = handle.includes("-")
    ? `column ${anchor.x}, row ${anchor.y}`
    : handle === "left" || handle === "right"
      ? `column ${anchor.x}`
      : `row ${anchor.y}`;

  return (
    <button
      type="button"
      className={`${styles.handle} ${shape} ${active ? styles.handleActive : ""}`}
      style={{
        ...layout[handle],
        cursor: cursorForHandle(handle),
        // The stage owns dragging; this element exists for focus and keyboard.
        pointerEvents: "none",
      }}
      // The value goes in the label rather than aria-valuenow: this is a button,
      // not a slider, and a screen reader announcing a bare number is no use
      // without saying which axis it is on.
      aria-label={`${label} crop edge, ${position}. Arrow keys to nudge.`}
      onKeyDown={(event) => onKeyDown(event, handle)}
    >
      <span className={styles.handleGrip} />
    </button>
  );
}
