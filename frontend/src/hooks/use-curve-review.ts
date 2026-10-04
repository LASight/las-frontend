import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import {
  addEdit,
  boundedRowRange,
  applyEdits,
  findGaps,
  resetEdits,
  strokeToEdit,
  summarizeEdits,
  undoLast,
  type CurveSeries,
} from "../controllers/curve-edit-controller";
import type { JobSummary } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { useReviewEdits } from "./use-review-edits";

/**
 * The human-in-the-loop correction state for one digitized curve.
 *
 * Modelled on `use-sequence-review.ts`, which is already this app's idiom for
 * "the machine proposed something, the human accepts, rejects or replaces it".
 * Same shape here, one level finer: the unit of review is a depth range on a
 * curve rather than a single boundary pick.
 *
 * The AI output is fetched once and held immutable. Corrections accumulate in a
 * list and are replayed over it on every render, so undo and reset are list
 * operations and the raw prediction is always one click away — which also keeps
 * "how much did the human change" answerable for the report.
 */

/** What the reviewer is doing with a drag on the canvas. */
export type ReviewTool = "inspect" | "redraw" | "discard";

export function curveQueryKey(jobId: string) {
  return ["digitization", "curve", jobId] as const;
}

export function useCurveReview(job: JobSummary | null) {
  const jobId = job?.job_id;
  const persistence = useReviewEdits(job);
  const { edits, update: setEdits } = persistence;
  const [tool, setTool] = useState<ReviewTool>("inspect");
  const [showMask, setShowMask] = useState(true);
  // Viewer-only presentation: never part of the edits or backend job request.
  const [showPrediction, setShowPrediction] = useState(true);
  const [predictionOpacity, setPredictionOpacity] = useState(100);
  const [status, setStatus] = useState("");
  const cropRows = job?.crop ? job.crop.y_bottom - job.crop.y_top : 0;
  const cropWidth = job?.crop ? job.crop.x_right - job.crop.x_left : 0;

  const query = useQuery({
    queryKey: curveQueryKey(jobId ?? ""),
    queryFn: () => digitizationGateway.getCurve(jobId as string),
    enabled: !!jobId && job?.phase !== "segmenting" && !!job?.quality,
    // The model's output for a given job never changes; only the edits on top
    // of it do. Refetching would throw away nothing useful but cost a large
    // transfer on a tall log.
    staleTime: Number.POSITIVE_INFINITY,
  });

  const baseX: CurveSeries = useMemo(() => query.data?.x ?? [], [query.data]);
  const baseObserved = useMemo(() => query.data?.observed ?? [], [query.data]);

  const corrected = useMemo(
    () => applyEdits(baseX, baseObserved, edits),
    [baseX, baseObserved, edits]
  );

  const stats = useMemo(
    () => summarizeEdits(edits, baseX.length),
    [edits, baseX.length]
  );

  /** Unrecovered runs *after* corrections — where the LAS will carry -999.25. */
  const gaps = useMemo(() => findGaps(corrected.x), [corrected.x]);

  const applyStroke = useCallback(
    (samples: ReadonlyArray<{ row: number; x: number }>) => {
      const edit = strokeToEdit(samples, { rows: cropRows, width: cropWidth });
      if (!edit) return;
      setEdits((previous) => addEdit(previous, edit));
      setStatus(`Redrew ${edit.y1 - edit.y0} rows.`);
    },
    [setEdits, cropRows, cropWidth]
  );

  const discardRange = useCallback((y0: number, y1: number) => {
    const range = boundedRowRange(y0, y1, cropRows);
    if (!range) return;
    setEdits((previous) => addEdit(previous, { kind: "discard", y0: range[0], y1: range[1] }));
    setStatus(`Discarded ${range[1] - range[0]} rows — they will export as NULL (-999.25).`);
  }, [setEdits, cropRows]);

  const acceptRange = useCallback((y0: number, y1: number) => {
    const range = boundedRowRange(y0, y1, cropRows);
    if (!range) return;
    setEdits((previous) => addEdit(previous, { kind: "accept", y0: range[0], y1: range[1] }));
    setStatus(`Marked ${range[1] - range[0]} rows as reviewed.`);
  }, [setEdits, cropRows]);

  const undo = useCallback(() => {
    setEdits((previous) => {
      if (previous.length === 0) return previous;
      setStatus("Undid the last correction.");
      return undoLast(previous);
    });
  }, [setEdits]);

  const reset = useCallback(() => {
    setEdits(() => resetEdits());
    setStatus("Reverted to the model's original output.");
  }, [setEdits]);

  return {
    /** The model's raw output, never mutated. */
    baseX,
    baseObserved,
    /** The curve after corrections — what gets exported. */
    x: corrected.x,
    observed: corrected.observed,
    gaps,
    edits,
    flushEdits: persistence.flush,
    restoreSavedEdits: persistence.restoreSaved,
    recoverLegacyEdits: persistence.recoverLegacy,
    hasLegacyDraft: persistence.hasLegacyDraft,
    isSaving: persistence.saving,
    saveError: persistence.error,
    hasUnsavedEdits: persistence.dirty,
    stats,
    tool,
    setTool,
    showMask,
    setShowMask,
    showPrediction,
    setShowPrediction,
    predictionOpacity,
    setPredictionOpacity,
    status,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    applyStroke,
    discardRange,
    acceptRange,
    undo,
    reset,
    canUndo: edits.length > 0,
  };
}
