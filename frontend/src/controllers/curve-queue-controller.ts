import { DEFAULT_SEGMENTATION, type CollectionSummary, type JobSummary } from "../models/digitization-models";
import type { DigitizationGateway } from "../services/digitization-service";

export function identityIssue(collection: CollectionSummary): string | null {
  const reference = collection.segments.find(({ job }) => job.calibration)?.job.calibration;
  if (!reference) return null;
  const mismatch = collection.segments.find(({ job }) => job.calibration && (
    job.calibration.mnemonic !== reference.mnemonic || job.calibration.value_unit !== reference.value_unit ||
    job.calibration.depth_unit !== reference.depth_unit));
  return mismatch ? `${mismatch.label}: mnemonic and units must match the curve. No automatic conversion is performed.` : null;
}

export function canProcess(job: JobSummary): boolean {
  return !!job.crop && !!job.calibration && !job.quality && job.phase !== "segmenting";
}

/** One server task at a time, fresh state before every start. READY is immutable
 * here: only an explicit crop/calibration save can invalidate its prediction. */
export async function processCurveQueue(collection: CollectionSummary, gateway: Pick<DigitizationGateway, "getJob" | "startSegmentation">,
  publish: (job: JobSummary) => void, wait: () => Promise<void>, signal: AbortSignal): Promise<void> {
  const issue = identityIssue(collection);
  if (issue) throw new Error(issue);
  // Rejoin an already running member before starting any new task (cold load).
  const ordered = [...collection.segments].sort((a, b) => Number(b.job.phase === "segmenting") - Number(a.job.phase === "segmenting"));
  for (const segment of ordered) {
    if (signal.aborted) return;
    let job = await gateway.getJob(segment.job_id);
    publish(job);
    if (signal.aborted) return;
    if (job.phase !== "segmenting") {
      if (!canProcess(job)) continue;
      const freshIssue = identityIssue({ ...collection, segments: collection.segments.map((member) => member.job_id === job.job_id ? { ...member, job } : member) });
      if (freshIssue) throw new Error(freshIssue);
      job = await gateway.startSegmentation(job.job_id, job.settings ?? DEFAULT_SEGMENTATION);
      publish(job);
    }
    while (job.phase === "segmenting") {
      await wait();
      if (signal.aborted) return;
      job = await gateway.getJob(job.job_id);
      publish(job);
    }
    if (job.phase === "failed" || !job.quality) {
      throw new Error(`${segment.label}: ${job.error ?? "Processing did not produce a prediction. Retrying preserves other segments."}`);
    }
  }
}
