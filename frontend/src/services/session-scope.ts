/** Verified account identity, independent of rotating access/media tokens. */
export interface SessionScope { accountId: string | null; generation: number }
let scope: SessionScope = { accountId: null, generation: 0 };

export function getSessionScope(): SessionScope { return scope; }

export function setSessionAccount(accountId: string): void {
  if (scope.accountId !== accountId) scope = { accountId, generation: scope.generation + 1 };
}

export function endAccountSession(): void {
  scope = { accountId: null, generation: scope.generation + 1 };
}

export function isCurrentSession(expected: SessionScope): boolean {
  return expected === scope;
}

/** Old unscoped keys are intentionally neither read, copied nor removed.
 * Their ownership cannot be established from a local filename/job ID alone. */
export function accountDraftKey(kind: "review" | "input" | "collection" | "output" | "alignment", api: string, id: string): string | undefined {
  if (!scope.accountId) return undefined;
  return `digitization-${kind}-draft:${api}:account:${encodeURIComponent(scope.accountId)}:${id}`;
}
