import { DEFAULT_CALIBRATION, type CollectionSummary, type JobSummary } from "../models/digitization-models";

/** Synthetic metadata for unit tests only, not digitization/continuity evidence. */
export function segmentJob(id: string, top = 0, bottom = 100): JobSummary {
  return {
    job_id: id, collection_id: "collection", segment_label: id, phase: "reviewing", file_name: "test-raster.tif", created_at: 0,
    raster: { width: 100, height: 3, mode: "L", image_format: "TIFF", size_bytes: 10, n_pages: 1, dpi: null },
    preprocess: null, detection: null, crop: { x_left: 0, x_right: 100, y_top: 0, y_bottom: 3 },
    calibration: { ...DEFAULT_CALIBRATION, depth_top: top, depth_bottom: bottom }, settings: null, progress: null,
    quality: { coverage: 1, n_wraps: 0, n_rows: 3, n_unrecovered: 0 }, error: null, edits: [], edits_revision: 0,
  };
}

export function collectionFixture(): CollectionSummary {
  return {
    collection_id: "collection", source_job_id: "first", title: "Operator title", revision: "fingerprint-v1",
    segments: [
      { job_id: "first", label: "First segment", job: segmentJob("first", 0, 100) },
      { job_id: "second", label: "Continuation", job: segmentJob("second", 50, 150) },
    ],
    overlaps: [{ conflict_id: "overlap-a", depth_top: 50, depth_bottom: 100, job_ids: ["first", "second"] }], issues: [],
  };
}
