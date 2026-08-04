import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TrackCrop } from "../../models/digitization-models";
import { digitizationGateway } from "../../services/digitization-service";
import styles from "./scan-minimap.module.css";
import type { Size } from "./cropper/viewport-transform";

/**
 * The whole scan at a glance, and the only way to travel 55,000 rows quickly.
 *
 * Shared by the crop editor and the review canvas, which have the same problem:
 * both show at most a few thousand rows at a legible zoom, and scrolling a real
 * log end to end at that rate is minutes of dragging. Click a depth, go there.
 *
 * It always draws the **whole raster**, including the parts the crop excludes,
 * and marks the crop on top. In review that is the point: the canvas beside it
 * deliberately shows only the cropped track, so this is the only place the
 * reviewer can see where that track sits in the original scan — and confirm the
 * header really was left out.
 *
 * It is emphatically *not* where the crop is set. A 55,000-row log squashed into
 * a few hundred pixels puts ~130 source rows in each strip row — good enough to
 * see where the log has data and where it is blank, useless for picking an edge.
 */

type Props = {
  jobId: string;
  fileName: string;
  image: Size;
  crop: TrackCrop;
  /** Rows currently on the stage, so the strip can show where the user is. */
  window: { y0: number; y1: number } | null;
  /** Jump the stage so this row is centred. */
  onSeek: (row: number) => void;
};

/**
 * Requested dimensions are rounded up to a multiple of this.
 *
 * The strip is laid out by flexbox, so a raw measured size would mint a new tile
 * URL on every pixel of a window drag. Quantising caps a resize at a handful of
 * refetches and the browser's HTTP cache absorbs the repeats.
 */
const SIZE_QUANTUM_PX = 32;

export function ScanMinimap({
  jobId,
  fileName,
  image,
  crop,
  window: depthWindow,
  onSeek,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [seeking, setSeeking] = useState(false);

  // Measure so the tile is requested at exactly the size it will be drawn at.
  // Handing the browser a hugely oversized bitmap to downscale is what made the
  // previous version of this strip unreadable.
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const stripUrl = useMemo(() => {
    if (size.width <= 0 || size.height <= 0 || image.height <= 0) return "";
    const quantize = (value: number) =>
      Math.ceil(value / SIZE_QUANTUM_PX) * SIZE_QUANTUM_PX;
    return digitizationGateway.tileUrl(jobId, {
      y0: 0,
      y1: image.height,
      // Per-axis, and by wildly different factors. A uniform scale that fits
      // 55,000 rows into 500 pixels would also reduce a 2,700 px raster to a
      // 25 px sliver — the backend has to be told about both axes separately.
      scaleX: Math.min(1, quantize(size.width) / Math.max(1, image.width)),
      scaleY: Math.min(1, quantize(size.height) / image.height),
    });
  }, [jobId, image.width, image.height, size.width, size.height]);

  /** Image row under a client y position. */
  const rowAt = useCallback(
    (clientY: number) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.height <= 0) return 0;
      const fraction = (clientY - rect.top) / rect.height;
      return Math.round(Math.min(1, Math.max(0, fraction)) * image.height);
    },
    [image.height]
  );

  useEffect(() => {
    if (!seeking) return;
    const handleMove = (event: PointerEvent) => onSeek(rowAt(event.clientY));
    const handleUp = () => setSeeking(false);
    globalThis.addEventListener("pointermove", handleMove);
    globalThis.addEventListener("pointerup", handleUp);
    return () => {
      globalThis.removeEventListener("pointermove", handleMove);
      globalThis.removeEventListener("pointerup", handleUp);
    };
  }, [seeking, rowAt, onSeek]);

  const pct = (row: number) => `${(row / Math.max(1, image.height)) * 100}%`;
  const leftPct = `${(crop.x_left / Math.max(1, image.width)) * 100}%`;
  const rightPct = `${(crop.x_right / Math.max(1, image.width)) * 100}%`;

  return (
    <div
      ref={hostRef}
      className={styles.host}
      role="slider"
      aria-label={`Jump to a depth in ${fileName}`}
      aria-valuemin={0}
      aria-valuemax={image.height}
      aria-valuenow={depthWindow ? Math.round((depthWindow.y0 + depthWindow.y1) / 2) : 0}
      tabIndex={0}
      onPointerDown={(event) => {
        setSeeking(true);
        onSeek(rowAt(event.clientY));
      }}
      onKeyDown={(event) => {
        if (!depthWindow) return;
        const page = (depthWindow.y1 - depthWindow.y0) || image.height / 20;
        const center = (depthWindow.y0 + depthWindow.y1) / 2;
        if (event.key === "ArrowUp" || event.key === "PageUp") {
          event.preventDefault();
          onSeek(Math.max(0, center - page));
        }
        if (event.key === "ArrowDown" || event.key === "PageDown") {
          event.preventDefault();
          onSeek(Math.min(image.height, center + page));
        }
      }}
    >
      {stripUrl && (
        <img
          className={styles.strip}
          src={stripUrl}
          alt={`Whole-log overview of ${fileName}`}
          draggable={false}
        />
      )}

      <div className={styles.shade} style={{ left: 0, width: leftPct }} />
      <div className={styles.shade} style={{ left: rightPct, right: 0 }} />

      {/* Rows the crop excludes never reach the model, so they are marked as
          out of run rather than merely dimmed. */}
      {crop.y_top > 0 && (
        <div className={styles.excluded} style={{ top: 0, height: pct(crop.y_top) }} />
      )}
      {crop.y_bottom < image.height && (
        <div
          className={styles.excluded}
          style={{ top: pct(crop.y_bottom), bottom: 0 }}
        />
      )}

      {depthWindow && (
        <div
          className={styles.window}
          style={{
            top: pct(depthWindow.y0),
            height: pct(Math.max(1, depthWindow.y1 - depthWindow.y0)),
          }}
        />
      )}
    </div>
  );
}
