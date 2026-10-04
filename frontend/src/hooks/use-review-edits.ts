import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { parseReviewDraft, ReviewEditsStore } from "../controllers/review-edits-store";
import type { JobSummary } from "../models/digitization-models";
import { digitizationGateway } from "../services/digitization-service";
import { API_BASE } from "../services/http-client";
import { accountDraftKey, getSessionScope, isCurrentSession } from "../services/session-scope";
import { hasLegacyDraft, recoverLegacyDraft } from "../services/legacy-draft-recovery";
import { assertQuerySession, bindQuerySession } from "../services/query-session";
import { jobQueryKey } from "./use-digitization-job";

const stores = new WeakMap<QueryClient, Map<string, ReviewEditsStore>>();
const empty = new ReviewEditsStore([], async () => undefined, "");

function jobEditsStore(client: QueryClient, job: JobSummary): ReviewEditsStore {
  bindQuerySession(client);
  const session = getSessionScope();
  const storeId = `${session.generation}:${job.job_id}`;
  const key = accountDraftKey("review", API_BASE, job.job_id);
  let jobs = stores.get(client);
  if (!jobs) { jobs = new Map(); stores.set(client, jobs); }
  let state = jobs.get(storeId);
  if (!state) {
    let storage: Storage | undefined;
    try { if (key) storage = window.localStorage; } catch { /* Private browsing. */ }
    state = new ReviewEditsStore(job.edits ?? [],
      async (edits, revision) => {
        assertQuerySession(client);
        if (!isCurrentSession(session)) throw new Error("Session changed. Sign in to the original account to save this draft.");
        const saved = await digitizationGateway.setEdits(job.job_id, edits, revision);
        if (!isCurrentSession(session)) throw new Error("Session changed. The original account's draft is retained.");
        return saved.edits_revision;
      }, key ?? "", storage, job.edits_revision);
    jobs.set(storeId, state);
  }
  return state;
}

/** Collection export must await each member's own durable overlay, including a
 * recovered local draft. Never send one segment's edits to a different job. */
export async function flushCollectionEdits(client: QueryClient, jobs: JobSummary[]): Promise<void> {
  assertQuerySession(client);
  await Promise.all(jobs.map(async (job) => {
    const store = jobEditsStore(client, job);
    store.reconcile(job.edits ?? [], job.edits_revision);
    await store.flush();
  }));
}

export function useReviewEdits(job: JobSummary | null) {
  const client = useQueryClient();
  const session = getSessionScope();
  const store = useMemo(() => {
    if (!job) return empty;
    return jobEditsStore(client, job);
  }, [client, job?.job_id, session.generation]);
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
      if (!isCurrentSession(session)) return;
      store.restoreSaved(latest.edits ?? [], latest.edits_revision);
      client.setQueryData(jobQueryKey(latest.job_id), latest);
    } catch (error) { store.reportError(error); }
  }, [store, client, job?.job_id]);
  const recoverLegacy = useCallback(async () => {
    if (!job || store.getSnapshot().saving || store.getSnapshot().dirty) return;
    try {
      const raw = await recoverLegacyDraft("review", job.job_id,
        () => digitizationGateway.getJob(job.job_id), (value) => parseReviewDraft(value)?.edits_revision !== undefined);
      if (isCurrentSession(session)) store.recoverDraft(raw);
    } catch (error) { if (isCurrentSession(session)) store.reportError(error); }
  }, [store, job?.job_id, session]);
  return { ...state, update: store.update, flush: store.flush, restoreSaved, recoverLegacy,
    hasLegacyDraft: !!job && hasLegacyDraft("review", job.job_id) };
}
