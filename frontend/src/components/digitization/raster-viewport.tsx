import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildValueTicks,
  formatDepth,
  pixelToValue,
  rowToDepth,
} from "../../controllers/calibration-controller";
import type { ReviewTool } from "../../hooks/use-curve-review";
import type { CurveSeries } from "../../controllers/curve-edit-controller";
import type { JobSummary } from "../../models/digitization-models";
import { useLodTiles } from "./cropper/use-lod-tiles";
import { ZOOM_STEP, usePanZoom } from "./cropper/use-pan-zoom";
import {
  imageToScreen,
  screenToImage,
  visibleImageRect,
} from "./cropper/viewport-transform";
import { ScanMinimap } from "./scan-minimap";
import styles from "./raster-viewport.module.css";

/**
 * The human-in-the-loop correction canvas.
 *
 * Thesis objective 4, and the component the whole product's premise rests on:
 * the model does not need to be perfect, because a specialist reviews and
 * corrects it — provided correcting is genuinely faster than digitizing by
 * hand. This is where that is either true or it isn't.
 *
 * **Why a raw canvas.** Every other chart in the app goes through the shared
 * Plotly wrapper, and should. This one cannot: the background is an image up to
 * 127,000 pixels tall, the overlay needs per-row hit-testing under a dragging
 * pointer, and both have to stay at 60 fps. Plotly does none of that well.
 *
 * **Why the same transform as the crop editor.** This viewport used to zoom
 * only vertically and stretch the track to fill the width, on the reasoning that
 * a narrow track should not be a sliver. That made it impossible to zoom out and
 * see the run's shape, and it lied about the scan's proportions. It now shares
 * `viewport-transform`, `usePanZoom` and `useLodTiles` with the cropper, so zoom
 * is uniform, unbounded downward, and anchored at the cursor. The level-of-detail
 * tiles are what make zooming out affordable — at 1:64 the server sends a
 * handful of small tiles rather than fifty full-resolution ones.
 *
 * **Coordinates.** Everything drawn here is **crop-local**: segmentation runs on
 * `image[y_top:y_bottom, x_left:x_right]`, so the mask, the curve and the gaps
 * all index from the crop's top-left. Only `useLodTiles` needs the absolute
 * raster, and it gets it through `origin`.
 *
 * **Draw order matters.** Scan, then predicted mask, then the corrected curve,
 * then unrecovered bands. Seeing the mask *underneath* the curve is how grid
 * latching becomes obvious — it is instantly visible to the eye and completely
 * invisible in an IoU score, which is a mistake this project has already made
 * once with automated metrics.
 */

type Props = {
  job: JobSummary;
  /** Corrected curve in crop-local pixel columns; `null` marks unrecovered. */
  x: CurveSeries;
  /** Unrecovered runs after corrections, in crop-local rows. */
  gaps: Array<{ y0: number; y1: number }>;
  tool: ReviewTool;
  showMask: boolean;
  onStroke: (samples: ReadonlyArray<{ row: number; x: number }>) => void;
  onDiscardRange: (y0: number, y1: number) => void;
  /**
   * Hand the parent a way to scroll this viewport to a row.
   *
   * The viewport owns its own view — lifting it into the step just so the side
   * panel can jump to a gap would put a value that changes on every wheel event
   * into a parent that re-renders a canvas. This exposes the one operation the
   * panel actually needs instead.
   */
  registerJump?: (jump: (row: number) => void) => void;
};

const COLORS = {
  curve: "#0f766e",
  mask: "rgba(56, 185, 217, 0.45)",
  gapBand: "rgba(192, 57, 43, 0.14)",
  axis: "rgba(30, 37, 51, 0.35)",
  cursor: "rgba(243, 154, 75, 0.9)",
};

export function RasterViewport({
  job,
  x,
  gaps,
  tool,
  showMask,
  onStroke,
  onDiscardRange,
  registerJump,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<Array<{ row: number; x: number }>>([]);
  const dragStartRow = useRef<number | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<{ row: number; x: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const crop = job.crop;
  const calibration = job.calibration;

  const cropWidth = crop ? crop.x_right - crop.x_left : job.raster.width;
  const cropHeight = crop ? crop.y_bottom - crop.y_top : job.raster.height;
  /** Absolute raster pixel that crop-local (0, 0) sits on. */
  const cropOrigin = useMemo(
    () => ({ x: crop?.x_left ?? 0, y: crop?.y_top ?? 0 }),
    [crop?.x_left, crop?.y_top]
  );

  /** The crop is the image, as far as this canvas is concerned. */
  const image = useMemo(
    () => ({ width: cropWidth, height: cropHeight }),
    [cropWidth, cropHeight]
  );

  const pan = usePanZoom({
    image,
    viewport: size,
    targetRef: containerRef,
    // Dragging here is the edit gesture, so the wheel has to stay travel.
    wheel: "pan",
  });
  const { view } = pan;

  const scan = useLodTiles({
    jobId: job.job_id,
    image,
    view,
    viewport: size,
    origin: cropOrigin,
    layer: "raster",
  });

  const mask = useLodTiles({
    jobId: showMask && job.quality ? job.job_id : undefined,
    image,
    view,
    viewport: size,
    // No origin: the backend already returns the mask in crop-local pixels.
    layer: "mask",
  });

  // Publish the jump-to-row operation to the parent. Centres the target rather
  // than putting it at the top edge, so the reviewer sees the context around a
  // gap and not just its first row.
  const centerOnRow = pan.centerOnRow;
  useEffect(() => {
    registerJump?.(centerOnRow);
  }, [registerJump, centerOnRow]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(200, entry.contentRect.width),
        height: Math.max(240, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const valueTicks = useMemo(
    () => (calibration ? buildValueTicks(calibration, cropWidth, 5) : []),
    [calibration, cropWidth]
  );

  /** Crop-local rectangle currently on screen. */
  const visible = useMemo(
    () => visibleImageRect(view, image, size),
    [view, image, size]
  );

  // ---- Draw -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Not white: the reviewer needs to see where the scan ends and the empty
    // viewport begins, which matters the moment zooming out is possible at all.
    context.fillStyle = "#e9edf2";
    context.fillRect(0, 0, size.width, size.height);

    const { scale, tx, ty } = view;
    // Past 1:1 smoothing turns a hard bilevel edge into a gradient, and the
    // reviewer is here to judge exactly where the ink is.
    context.imageSmoothingEnabled = scale < 1;

    const drawTiles = (tiles: typeof scan.tiles) => {
      for (const tile of tiles) {
        context.drawImage(
          tile.bitmap,
          tile.x0 * scale + tx,
          tile.y0 * scale + ty,
          (tile.x1 - tile.x0) * scale,
          (tile.y1 - tile.y0) * scale
        );
      }
    };

    // 1. The scan. Tiles arrive coarsest-first, so a sharp one always lands on
    //    top of the blurry stand-in it replaces.
    drawTiles(scan.tiles);

    // 2. The predicted mask, tinted, so grid latching is visible by eye.
    if (showMask) {
      context.save();
      context.globalAlpha = 0.55;
      context.globalCompositeOperation = "multiply";
      drawTiles(mask.tiles);
      context.restore();
    }

    // 3. The value axis.
    context.strokeStyle = COLORS.axis;
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    for (const tick of valueTicks) {
      const canvasX = tick.x * scale + tx;
      if (canvasX < 0 || canvasX > size.width) continue;
      context.beginPath();
      context.moveTo(canvasX, 0);
      context.lineTo(canvasX, size.height);
      context.stroke();
    }
    context.setLineDash([]);

    const left = 0 * scale + tx;
    const right = cropWidth * scale + tx;

    // 4. Unrecovered bands — where the LAS will carry -999.25. Drawn before the
    //    curve so the trace stays legible on top of them.
    context.fillStyle = COLORS.gapBand;
    for (const gap of gaps) {
      const top = gap.y0 * scale + ty;
      const height = (gap.y1 - gap.y0) * scale;
      if (top + height < 0 || top > size.height) continue;
      context.fillRect(left, top, right - left, Math.max(1, height));
    }

    // 5. The corrected curve. Broken at unrecovered rows rather than bridged:
    //    a continuous line across a gap would claim data that does not exist.
    context.strokeStyle = COLORS.curve;
    context.lineWidth = 1.6;
    context.beginPath();
    let penDown = false;
    const firstRow = Math.max(0, Math.floor(visible.y0) - 1);
    const lastRow = Math.min(x.length, Math.ceil(visible.y1) + 1);
    // At 1:64 a screen pixel spans 64 rows, so drawing every one is ~63 wasted
    // segments per pixel. Step by whole rows but never finer than the display.
    const step = Math.max(1, Math.floor(1 / Math.max(scale, 1e-6)));

    for (let row = firstRow; row < lastRow; row += step) {
      const value = x[row];
      if (value === null || value === undefined || Number.isNaN(value)) {
        penDown = false;
        continue;
      }
      const canvasX = value * scale + tx;
      const canvasY = row * scale + ty;
      if (!penDown) {
        context.moveTo(canvasX, canvasY);
        penDown = true;
      } else {
        context.lineTo(canvasX, canvasY);
      }
    }
    context.stroke();

    // 6. The in-progress stroke, so a redraw is visible while it is happening.
    if (isDragging && strokeRef.current.length > 1) {
      context.strokeStyle = COLORS.cursor;
      context.lineWidth = 2;
      context.beginPath();
      strokeRef.current.forEach((sample, index) => {
        const canvasX = sample.x * scale + tx;
        const canvasY = sample.row * scale + ty;
        if (index === 0) context.moveTo(canvasX, canvasY);
        else context.lineTo(canvasX, canvasY);
      });
      context.stroke();
    }

    // 7. Crosshair.
    if (cursor) {
      context.strokeStyle = COLORS.cursor;
      context.lineWidth = 1;
      const canvasY = cursor.row * scale + ty;
      context.beginPath();
      context.moveTo(0, canvasY);
      context.lineTo(size.width, canvasY);
      context.stroke();
    }
  }, [
    size,
    view,
    visible,
    scan.tiles,
    mask.tiles,
    showMask,
    x,
    gaps,
    valueTicks,
    cropWidth,
    cursor,
    isDragging,
  ]);

  // ---- Pointer ----------------------------------------------------------
  /**
   * Pointer position in viewport pixels.
   *
   * Measured against the container, which is also what the wheel handler inside
   * `usePanZoom` uses. Measuring one against the canvas and the other against
   * its bordered host puts the zoom anchor a pixel away from the cursor, which
   * is invisible until someone is aligning a trace at 8x.
   */
  const localPoint = useCallback((event: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const pointerSample = useCallback(
    (event: React.PointerEvent) => {
      const point = screenToImage(localPoint(event), view);
      return { row: Math.round(point.y), x: point.x };
    },
    [localPoint, view]
  );

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    // Inspect is the neutral tool, so there dragging pans. Under an edit tool
    // the drag belongs to the edit, and the middle button pans instead.
    if (tool === "inspect" || event.button === 1) {
      pan.beginPan(localPoint(event));
      return;
    }
    if (event.button !== 0) return;
    const sample = pointerSample(event);
    strokeRef.current = [sample];
    dragStartRow.current = sample.row;
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pan.isPanning) {
      pan.panTo(localPoint(event));
      return;
    }
    const sample = pointerSample(event);
    setCursor(sample);
    if (!isDragging || tool === "inspect") return;
    strokeRef.current.push(sample);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pan.isPanning) {
      pan.endPan();
      return;
    }
    if (!isDragging) return;
    setIsDragging(false);

    const samples = strokeRef.current;
    strokeRef.current = [];
    const startRow = dragStartRow.current;
    dragStartRow.current = null;

    if (tool === "redraw" && samples.length > 1) {
      onStroke(samples);
    } else if (tool === "discard" && startRow !== null && samples.length > 0) {
      const endRow = samples[samples.length - 1].row;
      onDiscardRange(Math.min(startRow, endRow), Math.max(startRow, endRow) + 1);
    }
  }

  const cursorDepth =
    cursor && calibration ? rowToDepth(cursor.row, calibration, cropHeight) : null;
  const cursorValue =
    cursor && calibration ? pixelToValue(cursor.x, calibration, cropWidth) : null;

  const topDepth = calibration
    ? rowToDepth(visible.y0, calibration, cropHeight)
    : null;
  const bottomDepth = calibration
    ? rowToDepth(visible.y1, calibration, cropHeight)
    : null;

  const zoomLabel =
    view.scale >= 1
      ? `${view.scale.toFixed(view.scale >= 4 ? 0 : 1)}:1`
      : `1:${Math.round(1 / Math.max(view.scale, 1e-6))}`;

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <div className={styles.depthRange}>
          {topDepth !== null && bottomDepth !== null && calibration ? (
            <>
              {formatDepth(topDepth, calibration.depth_unit)}
              {" – "}
              {formatDepth(bottomDepth, calibration.depth_unit)}
            </>
          ) : (
            `rows ${Math.round(visible.y0)}–${Math.round(visible.y1)}`
          )}
        </div>

        <div className={styles.zoomControls}>
          <button type="button" onClick={() => pan.zoomBy(1 / ZOOM_STEP)} title="Zoom out">
            −
          </button>
          <span className={styles.zoomLabel}>{zoomLabel}</span>
          <button type="button" onClick={() => pan.zoomBy(ZOOM_STEP)} title="Zoom in">
            +
          </button>
          <button type="button" onClick={() => pan.zoomTo(1)} title="Actual pixels">
            1:1
          </button>
          <button
            type="button"
            className={styles.zoomActionButton}
            onClick={pan.fitWidth}
            title="Fit the track's width"
          >
            Fit width
          </button>
          <button
            type="button"
            className={styles.zoomActionButton}
            onClick={pan.fitHeight}
            title="Show the whole run"
          >
            Whole run
          </button>
        </div>

        <div className={styles.readout}>
          {cursorDepth !== null && cursorValue !== null && calibration ? (
            <>
              <strong>{formatDepth(cursorDepth, calibration.depth_unit)}</strong>
              {" · "}
              {cursorValue.toFixed(1)} {calibration.value_unit}
            </>
          ) : (
            "Move the pointer over the track"
          )}
        </div>
      </div>

      <div className={styles.canvasRow}>
        <div ref={containerRef} className={styles.canvasHost}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={{
              cursor: pan.isPanning
                ? "grabbing"
                : tool === "inspect"
                  ? "grab"
                  : "cell",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => setCursor(null)}
          />
          {scan.isLoading && <div className={styles.loading}>Loading tiles…</div>}
          {scan.error && <div className={styles.tileError}>{scan.error}</div>}
        </div>

        {/* The whole scan beside the crop of it.
            This replaces a plain range scrubber, which navigated 127,000 rows
            but showed nothing. The reviewer needs more than a position here:
            the canvas deliberately shows only the cropped track, so this is the
            one place they can see where that track sits in the original scan
            and confirm the header and the blank tail really were excluded. */}
        <ScanMinimap
          jobId={job.job_id}
          fileName={job.file_name}
          image={{ width: job.raster.width, height: job.raster.height }}
          crop={
            crop ?? {
              x_left: 0,
              x_right: job.raster.width,
              y_top: 0,
              y_bottom: job.raster.height,
            }
          }
          window={{
            y0: cropOrigin.y + visible.y0,
            y1: cropOrigin.y + visible.y1,
          }}
          // The minimap speaks absolute raster rows; this canvas is crop-local.
          onSeek={(row) => pan.centerOnRow(row - cropOrigin.y)}
        />
      </div>

      <div className={styles.axisLabels}>
        {valueTicks.map((tick) => {
          const left = imageToScreen({ x: tick.x, y: 0 }, view).x;
          if (left < 0 || left > size.width) return null;
          return (
            <span key={tick.value} className={styles.axisLabel} style={{ left }}>
              {tick.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
