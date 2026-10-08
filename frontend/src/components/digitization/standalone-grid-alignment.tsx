import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { JobSummary } from "../../models/digitization-models";
import type { ReferenceSide } from "../../controllers/grid-alignment-controller";
import { useGridAlignment } from "../../hooks/use-grid-alignment";
import { jobQueryKey } from "../../hooks/use-digitization-job";
import { GridReferenceViewport } from "./grid-reference-viewport";
import { GridAlignmentPanel } from "./grid-alignment-panel";
import styles from "../../workspaces/curve-workspace.module.css";

export function StandaloneGridAlignment({ job, calibrationChanged, locked = false, onBusyChange }: { job: JobSummary; calibrationChanged: boolean; locked?: boolean; onBusyChange: (busy: boolean) => void }) {
  const client = useQueryClient();
  const publish = useCallback((saved: JobSummary) => client.setQueryData(jobQueryKey(saved.job_id), saved), [client]);
  const grid = useGridAlignment(job, publish);
  const [open, setOpen] = useState(false), [placing, setPlacing] = useState(false);
  const [target, setTarget] = useState<{ index: number; side: ReferenceSide }>({ index: 0, side: "left" });
  useEffect(() => { onBusyChange(grid.saving); }, [grid.saving, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { if (calibrationChanged) grid.cancelPreview(); }, [calibrationChanged]);
  const disabled = locked || job.phase === "segmenting" || grid.saving;
  if (!open) return <button type="button" disabled={disabled || !job.crop} onClick={() => setOpen(true)}>Align grid… (optional)</button>;
  return <div className={styles.editor}>
    <section className={styles.canvas}><GridReferenceViewport onMoveReference={(index, side, point) => grid.update((d) => ({ ...d, anchors: d.anchors.map((a, i) => i === index ? { ...a, [side]: { x: String(point.x), y: String(point.y), confirmed: true } } : a) }))} guided preview={grid.preview} job={job} draft={grid.draft} target={target} placing={placing} disabled={disabled || calibrationChanged} onCancelPlace={() => setPlacing(false)} onPlace={(point) => {
      grid.update((previous) => ({ ...previous, anchors: previous.anchors.map((a, i) => i === target.index ? { ...a, [target.side]: { x: String(point.x), y: String(point.y), confirmed: true } } : a) }));
      if (target.side === "left") { setTarget({ ...target, side: "right" }); setPlacing(true); } else setPlacing(false);
    }} /></section>
    <aside><GridAlignmentPanel job={job} grid={grid} disabled={disabled} calibrationChanged={calibrationChanged} target={target} onTargetChange={setTarget} placing={placing} onPlacingChange={setPlacing} onClose={() => setOpen(false)} /></aside>
  </div>;
}
