import type { CurveEdit } from "../models/digitization-models";

interface Snapshot {
  edits: CurveEdit[];
  edits_revision?: number;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

/** Shared across wizard steps. Only unsaved drafts live in local storage;
 * acknowledged edits are rehydrated from the job on a fresh page load. */
export class ReviewEditsStore {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private inFlight: Promise<Snapshot> | null = null;

  constructor(
    edits: CurveEdit[],
    private save: (edits: CurveEdit[], revision?: number) => Promise<number | undefined>,
    private key: string,
    private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    revision?: number
  ) {
    let draft: CurveEdit[] | null = null;
    try {
      const raw = storage?.getItem(key);
      if (raw) {
        const saved = parseReviewDraft(raw);
        if (saved) { draft = saved.edits; revision = saved.edits_revision; }
      }
    } catch { /* Storage may be unavailable; backend remains authoritative. */ }
    this.state = { edits: structuredClone(draft ?? edits), edits_revision: revision, dirty: draft !== null, saving: false, error: null };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  reconcile(edits: CurveEdit[], revision?: number) {
    // Upstream re-crop/re-segmentation invalidates the overlay. Ignore stale
    // query responses, and never replace an unsaved local draft silently.
    if (!this.state.dirty && !this.state.saving && revision !== undefined &&
      revision > (this.state.edits_revision ?? -1)) {
      this.publish({ edits: structuredClone(edits), edits_revision: revision, error: null });
    }
  }

  restoreSaved(edits: CurveEdit[], revision?: number) {
    if (this.inFlight) throw new Error("Wait for the current save before restoring corrections.");
    this.storage?.removeItem(this.key);
    this.publish({ edits: structuredClone(edits), edits_revision: revision, dirty: false, error: null });
  }

  recoverDraft(raw: string) {
    if (this.inFlight || this.state.dirty) throw new Error("Save or restore the current draft before recovering older corrections.");
    const draft = parseReviewDraft(raw);
    if (!draft) throw new Error("The older corrections are invalid; their storage was left unchanged.");
    this.publish({ ...structuredClone(draft), dirty: true, error: null });
    void this.flush().catch(() => {});
  }

  reportError(error: unknown) {
    this.publish({ error: error instanceof Error ? error.message : "Could not load saved corrections." });
  }

  private publish(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  update = (change: (edits: CurveEdit[]) => CurveEdit[]) => {
    const edits = structuredClone(change(this.state.edits));
    let error: string | null = null;
    try { this.storage?.setItem(this.key, JSON.stringify({ edits, edits_revision: this.state.edits_revision })); }
    catch { error = "Local draft unavailable. Keep this page open until corrections are saved."; }
    this.publish({ edits, dirty: true, error });
    void this.flush().catch(() => { /* Error is exposed in the snapshot. */ });
  };

  /** Serialize whole-list replacements. A late save can never undo a newer
   * stroke, undo or reset. Export awaits every queued change, then uses this
   * exact snapshot in its existing explicit-edits request. */
  flush = (): Promise<Snapshot> => {
    if (this.inFlight) return this.inFlight;
    if (!this.state.dirty) return Promise.resolve(this.state);
    this.publish({ saving: true, error: null });
    this.inFlight = (async () => {
      try {
        while (this.state.dirty) {
          const snapshot = this.state.edits;
          const revision = await this.save(structuredClone(snapshot), this.state.edits_revision);
          this.publish({ edits_revision: revision });
          if (snapshot === this.state.edits) {
            try { this.storage?.removeItem(this.key); } catch { /* Best effort. */ }
            this.publish({ dirty: false });
          } else {
            try { this.storage?.setItem(this.key, JSON.stringify({ edits: this.state.edits, edits_revision: revision })); }
            catch { /* Backend save still proceeds; never discard in-memory edits. */ }
          }
        }
        return this.state;
      } catch (err) {
        this.publish({ error: err instanceof Error ? err.message : "Corrections could not be saved." });
        throw err;
      } finally {
        this.inFlight = null;
        this.publish({ saving: false });
      }
    })();
    return this.inFlight;
  };
}

export function parseReviewDraft(raw: string): { edits: CurveEdit[]; edits_revision?: number } | null {
  try {
    const saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.edits) && saved.edits.every(isCurveEdit) &&
      (saved.edits_revision === undefined || (Number.isInteger(saved.edits_revision) && saved.edits_revision >= 0))) return saved;
  } catch { /* Preserve corrupt source storage for explicit operator recovery. */ }
  return null;
}

function isCurveEdit(value: unknown): value is CurveEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as CurveEdit;
  return ["redraw", "discard", "accept"].includes(edit.kind) &&
    Number.isInteger(edit.y0) && Number.isInteger(edit.y1) && edit.y0 >= 0 && edit.y1 > edit.y0 &&
    (edit.kind !== "redraw" || (Array.isArray(edit.x_by_row) &&
      edit.x_by_row.length === edit.y1 - edit.y0 && edit.x_by_row.every(Number.isFinite)));
}
