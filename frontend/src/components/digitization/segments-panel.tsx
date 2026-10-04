import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { stepForPhase } from "../../controllers/digitization-job-controller";
import { collectionQueryKey, useCollection } from "../../hooks/use-collection";
import { jobQueryKey } from "../../hooks/use-digitization-job";
import type { JobSummary } from "../../models/digitization-models";
import { collectionGateway } from "../../services/collection-service";
import { IS_MOCK_GATEWAY } from "../../services/digitization-service";
import { SectionPanel } from "../section-panel";
import styles from "./steps/step-layout.module.css";

export function SegmentsPanel({ job }: { job: JobSummary }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const collection = useCollection(job.collection_id);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const create = useMutation({
    mutationFn: () => collectionGateway.create(job.job_id, title.trim()),
    onSuccess: (result) => {
      client.setQueryData(collectionQueryKey(result.collection_id), result);
      for (const segment of result.segments) client.setQueryData(jobQueryKey(segment.job_id), segment.job);
      void client.invalidateQueries({ queryKey: jobQueryKey(job.job_id) });
      void client.invalidateQueries({ queryKey: ["history"] });
    },
  });
  const add = useMutation({
    mutationFn: () => collectionGateway.addSegment(job.collection_id!, label.trim()),
    onSuccess: (segment) => {
      client.setQueryData(jobQueryKey(segment.job_id), segment);
      void client.invalidateQueries({ queryKey: collectionQueryKey(job.collection_id!) });
      void client.invalidateQueries({ queryKey: ["history"] });
      navigate(`/digitize/${encodeURIComponent(segment.job_id)}/crop`);
    },
  });
  const error = create.error ?? add.error ?? collection.error;
  return <SectionPanel title="Segments of one curve">
    <p className={styles.hint}>Each segment has its own crop, calibration and saved corrections. Continuations reuse this upload's original raster, not the last processed crop. Confirm depth and continuity yourself; proposals do not identify continuations or read depths. For page breaks inside this raster, calibrate each segment separately. No whole-image OCR or new multi-frame TIFF import.</p>
    {IS_MOCK_GATEWAY ? <p className={styles.notice}>Collections require the real backend; unavailable in synthetic mock mode.</p> : job.collection_id ? <>
      <Link to={`/digitize/collections/${encodeURIComponent(job.collection_id)}`}>Return to collection summary{collection.data ? `: ${collection.data.title}` : ""}</Link>
      {collection.isPending && <p role="status">Loading segments…</p>}
      {collection.data && <div className={styles.field}>
        <label className={styles.label} htmlFor="active-segment">Edit segment</label>
        <select id="active-segment" className={styles.input} value={job.job_id} disabled={add.isPending} onChange={(event) => {
          const selected = collection.data?.segments.find((segment) => segment.job_id === event.target.value);
          if (selected) navigate(`/digitize/${encodeURIComponent(selected.job_id)}/${stepForPhase(selected.job.phase)}`);
        }}>
          {collection.data.segments.map((segment) => <option key={segment.job_id} value={segment.job_id}>{segment.label} — {segment.job.phase}</option>)}
        </select>
      </div>}
      <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); if (label.trim() && !add.isPending) add.mutate(); }}>
        <label htmlFor="new-segment-label">Continuation label</label>
        <input id="new-segment-label" className={styles.input} value={label} onChange={(event) => setLabel(event.target.value)} required />
        <button className={styles.secondaryBtn} disabled={!label.trim() || add.isPending}>Add continuation from original</button>
      </form>
    </> : <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); if (title.trim() && !create.isPending) create.mutate(); }}>
      <label htmlFor="collection-title">Collection title (manual, not a well name)</label>
      <input id="collection-title" className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} required />
      <button className={styles.secondaryBtn} disabled={!title.trim() || create.isPending}>Create collection with this segment</button>
    </form>}
    {error instanceof Error && <p role="alert" className={styles.error}>{error.message}</p>}
  </SectionPanel>;
}
