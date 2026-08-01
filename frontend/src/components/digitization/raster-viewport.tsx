import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildValueTicks,
  formatDepth,
  pixelToValue,
  rowToDepth,
} from "../../controllers/calibration-controller";
import type { ReviewTool } from "../../hooks/use-curve-review";
import { useRasterViewport } from "../../hooks/use-raster-viewport";
import type { CurveSeries } from "../../controllers/curve-edit-controller";
import type { JobSummary } from "../../models/digitization-models";
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
 * pointer, and both have to stay at 60 fps. Plotly does none of that well. The
 * cost is roughly 200 lines of drawing code; the benefit is a viewport that
 * works on a real log instead of a downsampled toy.
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
   * The viewport owns its scroll position — lifting it into the step just so
   * the side panel can jump to a gap would put a value that changes on every
   * wheel event into a parent that re-renders a canvas. This exposes the one
   * operation the panel actually needs instead.
   */
  registerJump?: (jump: (row: number) => void) => void;
};

/** Vertical zoom presets: canvas pixels per image row. */
const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];

const COLORS = {
  curve: "#0f766e",
  curveGap: "#c0392b",
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

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [zoomIndex, setZoomIndex] = useState(1);
  const [cursor, setCursor] = useState<{ row: number; x: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const crop = job.crop;
  const calibration = job.calibration;
  const zoom = ZOOM_LEVELS[zoomIndex];

  const cropWidth = crop ? crop.x_right - crop.x_left : job.raster.width;
  const cropHeight = crop ? crop.y_bottom - crop.y_top : job.raster.height;

  const viewport = useRasterViewport({
    jobId: job.job_id,
    imageHeight: cropHeight,
    x0: crop?.x_left,
    x1: crop?.x_right,
    layer: "raster",
    viewportHeight: size.height,
    zoom,
  });

  const maskViewport = useRasterViewport({
    jobId: showMask && job.quality ? job.job_id : undefined,
    imageHeight: cropHeight,
    layer: "mask",
    viewportHeight: size.height,
    zoom,
  });

  // Keep the mask layer aligned with the raster layer.
  useEffect(() => {
    maskViewport.scrollTo(viewport.scrollRow);
  }, [viewport.scrollRow]);

  // Publish the jump-to-row operation to the parent. Centres the target rather
  // than putting it at the top edge, so the reviewer sees the context around a
  // gap and not just its first row.
  useEffect(() => {
    registerJump?.((row) => viewport.scrollTo(row - viewport.rowsVisible / 3));
  }, [registerJump, viewport.scrollTo, viewport.rowsVisible]);

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

  /** Canvas x per crop column, so the track always fills the available width. */
  const scaleX = size.width / Math.max(1, cropWidth);

  const valueTicks = useMemo(
    () => (calibration ? buildValueTicks(calibration, cropWidth, 5) : []),
    [calibration, cropWidth]
  );

  const toCanvasY = useCallback(
    (row: number) => (row - viewport.scrollRow) * zoom,
    [viewport.scrollRow, zoom]
  );

  const toImageRow = useCallback(
    (canvasY: number) => Math.round(viewport.scrollRow + canvasY / zoom),
    [viewport.scrollRow, zoom]
  );

  // ---- Draw -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);

    // 1. The scan.
    for (const tile of viewport.visibleTiles) {
      context.drawImage(
        tile.bitmap,
        0,
        toCanvasY(tile.y0),
        size.width,
        (tile.y1 - tile.y0) * zoom
      );
    }

    // 2. The predicted mask, tinted, so grid latching is visible by eye.
    if (showMask) {
      context.save();
      context.globalAlpha = 0.55;
      context.globalCompositeOperation = "multiply";
      for (const tile of maskViewport.visibleTiles) {
        context.drawImage(
          tile.bitmap,
          0,
          toCanvasY(tile.y0),
          size.width,
          (tile.y1 - tile.y0) * zoom
        );
      }
      context.restore();
    }

    // 3. The value axis.
    context.strokeStyle = COLORS.axis;
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    for (const tick of valueTicks) {
      const canvasX = tick.x * scaleX;
      context.beginPath();
      context.moveTo(canvasX, 0);
      context.lineTo(canvasX, size.height);
      context.stroke();
    }
    context.setLineDash([]);

    // 4. Unrecovered bands — where the LAS will carry -999.25. Drawn before the
    //    curve so the trace stays legible on top of them.
    context.fillStyle = COLORS.gapBand;
    for (const gap of gaps) {
      const top = toCanvasY(gap.y0);
      const height = (gap.y1 - gap.y0) * zoom;
      if (top + height < 0 || top > size.height) continue;
      context.fillRect(0, top, size.width, Math.max(1, height));
    }

    // 5. The corrected curve. Broken at unrecovered rows rather than bridged:
    //    a continuous line across a gap would claim data that does not exist.
    context.strokeStyle = COLORS.curve;
    context.lineWidth = 1.6;
    context.beginPath();
    let penDown = false;
    const firstRow = Math.max(0, viewport.scrollRow - 1);
    const lastRow = Math.min(x.length, viewport.scrollRow + viewport.rowsVisible + 1);

    for (let row = firstRow; row < lastRow; row += 1) {
      const value = x[row];
      if (value === null || value === undefined || Number.isNaN(value)) {
        penDown = false;
        continue;
      }
      const canvasX = value * scaleX;
      const canvasY = toCanvasY(row);
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
        const canvasX = sample.x * scaleX;
        const canvasY = toCanvasY(sample.row);
        if (index === 0) context.moveTo(canvasX, canvasY);
        else context.lineTo(canvasX, canvasY);
      });
      context.stroke();
    }

    // 7. Crosshair.
    if (cursor) {
      context.strokeStyle = COLORS.cursor;
      context.lineWidth = 1;
      const canvasY = toCanvasY(cursor.row);
      context.beginPath();
      context.moveTo(0, canvasY);
      context.lineTo(size.width, canvasY);
      context.stroke();
    }
  }, [
    size,
    zoom,
    viewport.visibleTiles,
    viewport.scrollRow,
    viewport.rowsVisible,
    maskViewport.visibleTiles,
    showMask,
    x,
    gaps,
    valueTicks,
    scaleX,
    cursor,
    isDragging,
    toCanvasY,
  ]);

  // ---- Pointer ----------------------------------------------------------
  function pointerSample(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      row: toImageRow(event.clientY - rect.top),
      x: (event.clientX - rect.left) / scaleX,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "inspect") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const sample = pointerSample(event);
    strokeRef.current = [sample];
    dragStartRow.current = sample.row;
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const sample = pointerSample(event);
    setCursor(sample);
    if (!isDragging || tool === "inspect") return;
    strokeRef.current.push(sample);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
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

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    // Scroll in image rows, so the distance travelled per notch is the same at
    // every zoom level.
    viewport.scrollBy(Math.round((event.deltaY / zoom) * 0.8));
  }

  const cursorDepth =
    cursor && calibration ? rowToDepth(cursor.row, calibration, cropHeight) : null;
  const cursorValue =
    cursor && calibration ? pixelToValue(cursor.x, calibration, cropWidth) : null;

  const topDepth = calibration
    ? rowToDepth(viewport.scrollRow, calibration, cropHeight)
    : null;
  const bottomDepth = calibration
    ? rowToDepth(viewport.scrollRow + viewport.rowsVisible, calibration, cropHeight)
    : null;

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
            `rows ${viewport.scrollRow}–${viewport.scrollRow + viewport.rowsVisible}`
          )}
        </div>

        <div className={styles.zoomControls}>
          <button
            type="button"
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            disabled={zoomIndex === 0}
            title="Zoom out"
          >
            −
          </button>
          <span className={styles.zoomLabel}>{zoom}×</span>
          <button
            type="button"
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            title="Zoom in"
          >
            +
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
            className={`${styles.canvas} ${tool !== "inspect" ? styles.canvasEditing : ""}`}
            style={{ width: size.width, height: size.height }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => setCursor(null)}
            onWheel={handleWheel}
          />
          {viewport.isLoading && <div className={styles.loading}>Loading tiles…</div>}
          {viewport.error && <div className={styles.tileError}>{viewport.error}</div>}
        </div>

        {/* A full-log scrubber: the only affordance that makes 127,000 rows
            navigable without scrolling for a very long time. */}
        <input
          className={styles.scrubber}
          type="range"
          min={0}
          max={viewport.maxScrollRow}
          value={viewport.scrollRow}
          onChange={(event) => viewport.scrollTo(Number(event.target.value))}
          aria-label="Scroll through the log by depth"
        />
      </div>

      <div className={styles.axisLabels}>
        {valueTicks.map((tick) => (
          <span
            key={tick.value}
            className={styles.axisLabel}
            style={{ left: `${(tick.x / cropWidth) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
