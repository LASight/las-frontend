import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { ReviewEditsStore } from "../controllers/review-edits-store";
import type { JobSummary } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE } from "../services/http-client";
import { jobQueryKey } from "./use-digitization-job";

const stores = new WeakMap<QueryClient, Map<string, ReviewEditsStore>>();
const empty = new ReviewEditsStore([], async () => undefined, "");

export function useReviewEdits(job: JobSummary | null) {
  const client = useQueryClient();
  const store = useMemo(() => {
    if (!job) return empty;
    let jobs = stores.get(client);
    if (!jobs) { jobs = new Map(); stores.set(client, jobs); }
    let state = jobs.get(job.job_id);
    if (!state) {
      let storage: Storage | undefined;
      try { storage = window.localStorage; } catch { /* Private browsing. */ }
      state = new ReviewEditsStore(job.edits ?? [],
        async (edits, revision) => (await digitizationGateway.setEdits(job.job_id, edits, revision)).edits_revision,
        `digitization-review-draft:${API_BASE}:${job.job_id}`, storage, job.edits_revision);
      jobs.set(job.job_id, state);
    }
    return state;
  }, [client, job?.job_id]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    if (job) store.reconcile(job.edits ?? [], job.edits_revision);
  }, [store, job?.edits, job?.edits_revision]);
  useEffect(() => {
    if (state.dirty) void store.flush().catch(() => {});
    // Only retry recovered drafts on mount, not infinitely after a failure.
  }, [store]);
  const restoreSaved = useCallback(async () => {
    if (!job) return;
    try {
      const latest = await digitizationGateway.getJob(job.job_id);
      store.restoreSaved(latest.edits ?? [], latest.edits_revision);
      client.setQueryData(jobQueryKey(latest.job_id), latest);
    } catch (error) { store.reportError(error); }
  }, [store, client, job?.job_id]);
  return { ...state, update: store.update, flush: store.flush, restoreSaved };
}
