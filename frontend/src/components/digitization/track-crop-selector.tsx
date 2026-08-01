import { useCallback, useEffect, useMemo, useRef, useState } from "react";


import type { JobSummary, TrackCrop } from "../../models/digitization-models";
import { digitizationGateway } from "../../services/digitization-service";
import styles from "./track-crop-selector.module.css";

/**
 * Drag the left and right edges of the track to digitize.
 *
 * The MVP digitizes one user-cropped track at a time. That is a scope decision
 * (thesis §1.5.2 puts automatic track detection and OCR out of scope) but also
 * a correctness one: the model trained on single GR tracks, and a whole
 * multi-track scan is a domain shift that produces confident nonsense.
 *
 * The whole log is shown as one heavily downsampled strip. A real scan is
 * 30,000–127,000 px tall, so this is a thumbnail by necessity — it is for
 * finding the track's *columns*, which is all the crop needs. Depth bounds
 * default to the full height and are adjusted numerically, because no one can
 * pick a depth accurately on a 200-pixel-tall thumbnail of a 30,000-row log.
 */

type Props = {
  job: JobSummary;
  crop: TrackCrop;
  onChange: (crop: TrackCrop) => void;
};

/** Target height of the overview strip; the scale is derived from it. */
const OVERVIEW_HEIGHT_PX = 420;

type DragTarget = "left" | "right" | null;

export function TrackCropSelector({ job, crop, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);

  const { width, height } = job.raster;

  /** Downsample factor that fits the whole log into the strip. */
  const scale = useMemo(
    () => Math.min(1, OVERVIEW_HEIGHT_PX / Math.max(1, height)),
    [height]
  );

  const overviewUrl = useMemo(
    () => digitizationGateway.tileUrl(job.job_id, { y0: 0, y1: height, scale }),
    [job.job_id, height, scale]
  );

  /** Image column under a client x position. */
  const columnAt = useCallback(
    (clientX: number) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const fraction = (clientX - rect.left) / rect.width;
      return Math.round(Math.min(1, Math.max(0, fraction)) * width);
    },
    [width]
  );

  useEffect(() => {
    if (!dragging) return;

    function handleMove(event: PointerEvent) {
      const column = columnAt(event.clientX);
      if (dragging === "left") {
        // Keep at least 20 px of track: a degenerate crop passes validation and
        // then produces a meaningless calibration.
        onChange({ ...crop, x_left: Math.min(column, crop.x_right - 20) });
      } else {
        onChange({ ...crop, x_right: Math.max(column, crop.x_left + 20) });
      }
    }

    function handleUp() {
      setDragging(null);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, crop, columnAt, onChange]);

  const leftPct = (crop.x_left / width) * 100;
  const rightPct = (crop.x_right / width) * 100;
  const displayHeight = Math.round(height * scale);

  return (
    <div className={styles.wrapper}>
      <div
        ref={hostRef}
        className={styles.host}
        style={{ height: `${Math.min(OVERVIEW_HEIGHT_PX, displayHeight)}px` }}
      >
        <img
          className={styles.overview}
          src={overviewUrl}
          alt={`Full-length overview of ${job.file_name}`}
          draggable={false}
        />

        {/* Dim everything outside the selection so the chosen track reads as
            the subject rather than as one stripe among several. */}
        <div className={styles.mask} style={{ left: 0, width: `${leftPct}%` }} />
        <div className={styles.mask} style={{ left: `${rightPct}%`, right: 0 }} />

        <div
          className={styles.selection}
          style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
        />

        <div
          className={`${styles.handle} ${dragging === "left" ? styles.handleActive : ""}`}
          style={{ left: `${leftPct}%` }}
          onPointerDown={() => setDragging("left")}
          role="slider"
          aria-label="Left edge of the track"
          aria-valuenow={crop.x_left}
          aria-valuemin={0}
          aria-valuemax={width}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") onChange({ ...crop, x_left: Math.max(0, crop.x_left - 5) });
            if (event.key === "ArrowRight")
              onChange({ ...crop, x_left: Math.min(crop.x_right - 20, crop.x_left + 5) });
          }}
        />
        <div
          className={`${styles.handle} ${dragging === "right" ? styles.handleActive : ""}`}
          style={{ left: `${rightPct}%` }}
          onPointerDown={() => setDragging("right")}
          role="slider"
          aria-label="Right edge of the track"
          aria-valuenow={crop.x_right}
          aria-valuemin={0}
          aria-valuemax={width}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft")
              onChange({ ...crop, x_right: Math.max(crop.x_left + 20, crop.x_right - 5) });
            if (event.key === "ArrowRight")
              onChange({ ...crop, x_right: Math.min(width, crop.x_right + 5) });
          }}
        />
      </div>

      <p className={styles.scaleNote}>
        Whole log shown at {(scale * 100).toFixed(1)}% of full size —{" "}
        {height.toLocaleString()} rows compressed into {displayHeight} pixels. Drag the
        handles to bound the track's columns; set the depth interval numerically below.
      </p>
    </div>
  );
}
