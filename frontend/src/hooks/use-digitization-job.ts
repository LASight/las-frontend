import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { isDetecting } from "../controllers/detection-controller";
import { isRunning, stepForPhase } from "../controllers/digitization-job-controller";
import type {
  JobSummary,
  PreprocessSettings,
  SegmentationSettings,
  TrackCalibration,
  TrackCrop,
} from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";

/**
 * The job's server state, and the mutations that advance it.
 *
 * The server is the single source of truth. That is not incidental: it is what
 * makes the wizard's URLs work. `/digitize/:jobId/review` means something only
 * because the job — the raster, the mask, the recovered curve — survives on the
 * server, so a refresh rehydrates from `GET /jobs/{id}` rather than starting
 * over.
 *
 * Polling is conditional on the phase. Segmentation is the only stage the
 * server advances on its own, so that is the only time this polls; the rest of
 * the wizard is request/response.
 */

/** How often to poll while segmentation runs. */
const POLL_INTERVAL_MS = 1200;

/**
 * How often to poll while track detection runs.
 *
 * Shorter than `POLL_INTERVAL_MS`: detection is a single sub-second forward
 * pass over one page, not minutes of tiled inference, so polling at the
 * segmentation cadence would leave boxes visibly late by up to 1.2 s after
 * they are actually ready - noticeable on something this quick.
 */
const DETECT_POLL_INTERVAL_MS = 400;

export function jobQueryKey(jobId: string) {
  return ["digitization", "job", jobId] as const;
}

export function useDigitizationJob(jobId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: jobQueryKey(jobId ?? ""),
    queryFn: () => digitizationGateway.getJob(jobId as string),
    enabled: !!jobId,
    // Poll only while the server is working. A finished job never changes on
    // its own, and polling one forever is pure waste on a laptop demo.
    // Detection is checked first and gets the tighter interval - the two
    // never overlap in practice (detection never runs during segmentation),
    // but if they ever did, the faster poll is the more correct one to use.
    refetchInterval: (query) => {
      const job = query.state.data ?? null;
      if (isDetecting(job)) return DETECT_POLL_INTERVAL_MS;
      return isRunning(job) ? POLL_INTERVAL_MS : false;
    },
  });

  function writeJob(job: JobSummary) {
    queryClient.setQueryData(jobQueryKey(job.job_id), job);
  }

  const preprocess = useMutation({
    mutationFn: (settings: PreprocessSettings) =>
      digitizationGateway.preprocess(jobId as string, settings),
    onSuccess: writeJob,
  });

  /** The retry button for a failed or unavailable detection. */
  const retryDetection = useMutation({
    mutationFn: () => digitizationGateway.detectTracks(jobId as string),
    onSuccess: writeJob,
  });

  const setCrop = useMutation({
    mutationFn: (crop: TrackCrop) => digitizationGateway.setCrop(jobId as string, crop),
    onSuccess: writeJob,
  });

  const setCalibration = useMutation({
    mutationFn: (calibration: TrackCalibration) =>
      digitizationGateway.setCalibration(jobId as string, calibration),
    onSuccess: writeJob,
  });

  const startSegmentation = useMutation({
    mutationFn: (settings: SegmentationSettings) =>
      digitizationGateway.startSegmentation(jobId as string, settings),
    onSuccess: writeJob,
  });

  /**
   * Send the user to the step the job is actually on.
   *
   * Used by the route guard and after a phase change. `replace` so the wizard
   * does not fill the history with redirects the back button has to walk
   * through.
   */
  function goToCurrentStep() {
    if (!query.data) return;
    navigate(`/digitize/${query.data.job_id}/${stepForPhase(query.data.phase)}`, {
      replace: true,
    });
  }

  return {
    job: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
    preprocess,
    retryDetection,
    setCrop,
    setCalibration,
    startSegmentation,
    goToCurrentStep,
  };
}
