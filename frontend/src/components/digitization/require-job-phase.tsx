import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";

import { hasReachedPhase, stepForPhase } from "../../controllers/digitization-job-controller";
import type { DigitizationPhase } from "../../models/digitization-models";
import { useDigitizationJob } from "../../hooks/use-digitization-job";

/**
 * Route guard: keep a deep link from landing on a step the job has not reached.
 *
 * Making the wizard's steps real URLs means anyone can type
 * `/digitize/:id/review` for a job that has never been segmented. Rendering
 * that page would show an empty canvas that looks like a data bug. Redirecting
 * to the step the job is actually on says what happened.
 *
 * It fetches the job itself rather than reading the workspace's context,
 * because it wraps the step *inside* the workspace's `<Outlet>` and has to
 * decide before the step mounts. The query is already cached by then, so this
 * is a cache read in every case except a cold deep link.
 */

type Props = {
  /** The phase the job must have reached. */
  reached: DigitizationPhase;
  children: ReactNode;
};

export function RequireJobPhase({ reached, children }: Props) {
  const { jobId } = useParams<{ jobId: string }>();
  const { job, isLoading, error } = useDigitizationJob(jobId);

  if (isLoading) return null;

  // A missing or unloadable job is the workspace's problem to report, not ours;
  // it renders the error rather than a step.
  if (error || !job) return <>{children}</>;

  if (!hasReachedPhase(job.phase, reached)) {
    return <Navigate to={`/digitize/${job.job_id}/${stepForPhase(job.phase)}`} replace />;
  }

  return <>{children}</>;
}
