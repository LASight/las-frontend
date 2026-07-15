import { useMemo, useState } from "react";

import type {
  AnalyzePayload,
  BoundaryStatus,
  SequenceBoundary,
  SequenceCorrelation,
  WellReport,
} from "../models/analyze-models";

export type { BoundaryStatus };

type SequenceEditState = {
  statusByBoundaryId: Record<string, BoundaryStatus>;
  manualBoundaries: Array<SequenceBoundary & { status: BoundaryStatus }>;
};

export function useSequenceReview(payload: AnalyzePayload | null) {
  const [threshold, setThreshold] = useState(0.45);
  const [selectedWell, setSelectedWell] = useState("");
  const [manualDepth, setManualDepth] = useState("");
  const [status, setStatus] = useState("Run analysis to populate sequence predictions.");
  const [editsByWell, setEditsByWell] = useState<Record<string, SequenceEditState>>({});

  const readyWells = useMemo(
    () => (payload?.wells || []).filter((w) => w.sequence_stratigraphy?.status === "ok"),
    [payload]
  );

  const normalizedSelectedWell = useMemo(() => {
    if (!readyWells.length) return "";
    if (selectedWell && readyWells.some((w) => w.well_name === selectedWell)) return selectedWell;
    return readyWells[0].well_name;
  }, [readyWells, selectedWell]);

  const selectedReport = useMemo(
    () => readyWells.find((w) => w.well_name === normalizedSelectedWell) || null,
    [readyWells, normalizedSelectedWell]
  );

  function editStateForWell(wellName: string): SequenceEditState {
    return editsByWell[wellName] || { statusByBoundaryId: {}, manualBoundaries: [] };
  }

  const boundaries = useMemo(() => {
    if (!selectedReport?.sequence_stratigraphy) return [];
    const seq = selectedReport.sequence_stratigraphy;
    const edit = editStateForWell(selectedReport.well_name);
    const autos = (seq.boundaries_auto || [])
      .filter((b) => (b.confidence || 0) >= threshold)
      .map((b) => ({ ...b, source: "auto" as const }));
    const manual = edit.manualBoundaries.map((b) => ({ ...b, source: "manual" as const }));
    return [...autos, ...manual]
      .sort((a, b) => (a.depth || 0) - (b.depth || 0))
      .map((b) => ({
        ...b,
        status:
          edit.statusByBoundaryId[b.id] ||
          ("status" in b && b.status ? b.status : "pending"),
      }));
  }, [selectedReport, threshold, editsByWell]);

  function resetForAnalysis() {
    setEditsByWell({});
    if (readyWells.length) {
      setSelectedWell(readyWells[0].well_name);
      setStatus(`Reviewing ${readyWells[0].well_name}.`);
      return;
    }
    setSelectedWell("");
    setStatus("No wells with sequence-ready data in this run.");
  }

  function setBoundaryStatus(boundaryId: string, action: BoundaryStatus | "delete-manual") {
    if (!normalizedSelectedWell) return;
    setEditsByWell((old) => {
      const next = { ...old };
      const current = editStateForWell(normalizedSelectedWell);
      const copy: SequenceEditState = {
        statusByBoundaryId: { ...current.statusByBoundaryId },
        manualBoundaries: [...current.manualBoundaries],
      };
      if (action === "delete-manual") {
        copy.manualBoundaries = copy.manualBoundaries.filter((row) => row.id !== boundaryId);
        delete copy.statusByBoundaryId[boundaryId];
      } else {
        copy.statusByBoundaryId[boundaryId] = action;
      }
      next[normalizedSelectedWell] = copy;
      return next;
    });
  }

  function addManualBoundary() {
    if (!normalizedSelectedWell) return;
    const depth = Number(manualDepth);
    if (!Number.isFinite(depth)) {
      setStatus("Enter a valid manual depth.");
      return;
    }
    setEditsByWell((old) => {
      const next = { ...old };
      const current = editStateForWell(normalizedSelectedWell);
      const id = `manual-${Date.now()}`;
      next[normalizedSelectedWell] = {
        statusByBoundaryId: { ...current.statusByBoundaryId, [id]: "accepted" },
        manualBoundaries: [
          ...current.manualBoundaries,
          {
            id,
            depth: Number(depth.toFixed(2)),
            confidence: 1.0,
            from_tract: "Manual",
            to_tract: "Manual",
            status: "accepted",
          },
        ],
      };
      return next;
    });
    setManualDepth("");
    setStatus(`Manual boundary added at ${depth.toFixed(2)}.`);
  }

  function resetSelectedWellEdits() {
    if (!normalizedSelectedWell) return;
    setEditsByWell((old) => {
      if (!old[normalizedSelectedWell]) return old;
      const next = { ...old };
      delete next[normalizedSelectedWell];
      return next;
    });
    setStatus("Human edits reset for selected well.");
  }

  return {
    threshold,
    setThreshold,
    selectedWell: normalizedSelectedWell,
    setSelectedWell,
    selectedReport,
    boundaries,
    readyWells,
    manualDepth,
    setManualDepth,
    addManualBoundary,
    setBoundaryStatus,
    resetSelectedWellEdits,
    status,
    setStatus,
    resetForAnalysis,
    correlation: (payload?.portfolio_analytics.sequence_correlation || null) as SequenceCorrelation | null,
  };
}
