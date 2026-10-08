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

/** Aligned drafts belong to their exact canonical geometry. Ordinary/legacy
 * jobs keep their existing namespace; old draft data is never moved/deleted. */
export function reviewDraftKey(job: JobSummary) {
  return accountDraftKey("review", API_BASE, job.alignment ? `${job.job_id}:aligned:${encodeURIComponent(job.geometry_revision ?? job.alignment.revision)}` : job.job_id);
}

function jobEditsStore(client: QueryClient, job: JobSummary): ReviewEditsStore {
  bindQuerySession(client);
  const session = getSessionScope();
  const storeId = `${session.generation}:${job.job_id}:${job.geometry_revision ?? job.alignment?.revision ?? "legacy"}`;
  const key = reviewDraftKey(job);
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
  }, [client, job?.job_id, job?.geometry_revision, job?.alignment?.revision, session.generation]);
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
    if (job.alignment) {
      store.reportError(new Error("Older corrections have no aligned-frame provenance and cannot be applied here. Their local data is retained."));
      return;
    }
    try {
      const raw = await recoverLegacyDraft("review", job.job_id,
        () => digitizationGateway.getJob(job.job_id), (value) => parseReviewDraft(value)?.edits_revision !== undefined);
      if (isCurrentSession(session)) store.recoverDraft(raw);
    } catch (error) { if (isCurrentSession(session)) store.reportError(error); }
  }, [store, job?.job_id, session]);
  // Reconciliation publishes in an effect. Use newer acknowledged server edits
  // immediately, so a returning canonical frame cannot paint an archived
  // overlay for one frame before that effect runs. Dirty drafts stay explicit.
  const visible = !state.dirty && !state.saving && job?.edits_revision !== undefined && job.edits_revision > (state.edits_revision ?? -1)
    ? { ...state, edits: job.edits ?? [], edits_revision: job.edits_revision } : state;
  return { ...visible, update: store.update, flush: store.flush, restoreSaved, recoverLegacy,
    hasLegacyDraft: !!job && !job.alignment && hasLegacyDraft("review", job.job_id),
    hasIncompatibleLegacyDraft: !!job?.alignment && hasLegacyDraft("review", job.job_id) };
}
