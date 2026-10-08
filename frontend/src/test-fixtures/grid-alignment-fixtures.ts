import type { GridAlignmentPreview, JobSummary, SavedGridAlignment } from "../models/digitization-models";
import { segmentJob } from "./collection-fixtures";

/** Synthetic coordinate/metadata fixtures, not segmentation or accuracy evidence. */
export const gridAlignment: SavedGridAlignment = {
  algorithm: "bilinear-bands-v1", revision: "geometry-aligned", width: 100, height: 200, depth_unit: "FT",
  anchors: [
    { depth: 100, left: { x: 20, y: 30 }, right: { x: 120, y: 50 } },
    { depth: 125, left: { x: 30, y: 80 }, right: { x: 140, y: 90 } },
    { depth: 200, left: { x: 40, y: 200 }, right: { x: 150, y: 220 } },
  ],
};
export function gridJob(aligned = false): JobSummary {
  const job = segmentJob("grid", 100, 200);
  return { ...job, raster: { ...job.raster, width: 240, height: 600 },
    crop: { x_left: 10, x_right: 210, y_top: 10, y_bottom: 410 },
    geometry_revision: aligned ? "geometry-aligned" : "geometry-source", alignment: aligned ? structuredClone(gridAlignment) : null,
    alignment_history_count: aligned ? 1 : 0, quality: aligned ? { ...job.quality!, n_rows: 200 } : null,
    phase: aligned ? "reviewing" : "calibrating" };
}
export const gridPreview: GridAlignmentPreview = { alignment: gridAlignment, preview_png_base64: "synthetic-preview", preview_width: 100, preview_height: 200 };
