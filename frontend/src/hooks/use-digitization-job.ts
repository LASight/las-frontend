import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

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
    refetchInterval: (query) =>
      isRunning(query.state.data ?? null) ? POLL_INTERVAL_MS : false,
  });

  function writeJob(job: JobSummary) {
    queryClient.setQueryData(jobQueryKey(job.job_id), job);
  }

  const preprocess = useMutation({
    mutationFn: (settings: PreprocessSettings) =>
      digitizationGateway.preprocess(jobId as string, settings),
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
    setCrop,
    setCalibration,
    startSegmentation,
    goToCurrentStep,
  };
}
