import { API_BASE } from "./http-client";
import { accountDraftKey, getSessionScope, isCurrentSession } from "./session-scope";

type DraftKind = Parameters<typeof accountDraftKey>[0];
const legacyKey = (kind: DraftKind, id: string) => `digitization-${kind}-draft:${API_BASE}:${id}`;

export function hasLegacyDraft(kind: DraftKind, id: string): boolean {
  if (!getSessionScope().accountId) return false;
  try { return localStorage.getItem(legacyKey(kind, id)) !== null; } catch { return false; }
}

/** Explicit recovery only: callers ask permission first. A fresh authorized
 * server read establishes access to this exact resource before any legacy data
 * is read. Keep the original key, and never overwrite an account-scoped draft. */
export async function recoverLegacyDraft(kind: DraftKind, id: string, verifyAccess: () => Promise<unknown>, validate: (raw: string) => boolean): Promise<string> {
  const session = getSessionScope();
  const destination = accountDraftKey(kind, API_BASE, id);
  if (!destination) throw new Error("Sign in before recovering an older draft.");
  await verifyAccess();
  if (!isCurrentSession(session)) throw new Error("Session changed. The older draft was not accessed.");
  if (localStorage.getItem(destination) !== null) throw new Error("An account-scoped draft already exists. It was not overwritten.");
  const raw = localStorage.getItem(legacyKey(kind, id));
  if (!raw || !validate(raw)) throw new Error("The older draft is invalid. Its original storage was left unchanged.");
  localStorage.setItem(destination, raw);
  return raw;
}
