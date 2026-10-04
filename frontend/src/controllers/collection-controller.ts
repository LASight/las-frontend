import type { CollectionOverlap, CollectionSummary } from "../models/digitization-models";

export interface OverlapDraft {
  choices: Record<string, string>;
  conflicts: Record<string, string>;
}

export const EMPTY_OVERLAP_DRAFT: OverlapDraft = { choices: {}, conflicts: {} };

function signature(overlap: CollectionOverlap): string {
  return JSON.stringify([overlap.depth_top, overlap.depth_bottom, [...overlap.job_ids].sort()]);
}

/** Keep relevant explicit choices across revision changes; changed ranges or
 * candidate sets require a new operator decision even if an ID is reused. */
export function reconcileOverlapDraft(draft: OverlapDraft, overlaps: CollectionOverlap[]): OverlapDraft {
  const choices: Record<string, string> = {};
  const conflicts: Record<string, string> = {};
  for (const overlap of overlaps) {
    const id = overlap.conflict_id;
    conflicts[id] = signature(overlap);
    const choice = draft.choices[id];
    if (draft.conflicts[id] === conflicts[id] && overlap.job_ids.includes(choice)) choices[id] = choice;
  }
  return { choices, conflicts };
}

export function readOverlapDraft(raw: string | null): OverlapDraft {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value && isStringRecord(value.choices) && isStringRecord(value.conflicts)) return value;
  } catch { /* Corrupt/unavailable storage never manufactures a choice. */ }
  return EMPTY_OVERLAP_DRAFT;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string");
}

export function unresolvedOverlaps(collection: CollectionSummary, choices: Record<string, string>): CollectionOverlap[] {
  return collection.overlaps.filter((overlap) => !overlap.job_ids.includes(choices[overlap.conflict_id]));
}

/** Conservative frontend checks; the backend also validates the actual curves,
 * ownership, NULLs, revision and resource limits at export time. No conversions. */
export function collectionIssues(collection: CollectionSummary): string[] {
  const issues = [...collection.issues];
  if (!collection.segments.length) issues.push("The collection has no segments.");
  const reference = collection.segments[0]?.job.calibration;
  for (const segment of collection.segments) {
    const job = segment.job;
    if (!["reviewing", "exporting", "done"].includes(job.phase) || !job.crop || !job.quality || !job.calibration) {
      issues.push(`${segment.label}: finish crop, calibration, segmentation and review.`);
    }
    const calibration = job.calibration;
    if (calibration && reference && (calibration.mnemonic !== reference.mnemonic ||
      calibration.value_unit !== reference.value_unit || calibration.depth_unit !== reference.depth_unit)) {
      issues.push(`${segment.label}: mnemonic, value units and depth units must match; no automatic conversion.`);
    }
    if (calibration && (!Number.isFinite(calibration.depth_top) || !Number.isFinite(calibration.depth_bottom) ||
      calibration.depth_bottom <= calibration.depth_top)) issues.push(`${segment.label}: invalid depth interval.`);
  }
  return [...new Set(issues)];
}

export function collectionOutputIssue(collection: CollectionSummary, step: number): string | null {
  if (!Number.isFinite(step) || step <= 0) return "Depth step must be a finite positive number.";
  const calibrations = collection.segments.flatMap(({ job }) => job.calibration ? [job.calibration] : []);
  if (!calibrations.length) return null;
  const span = Math.max(...calibrations.map((c) => c.depth_bottom)) - Math.min(...calibrations.map((c) => c.depth_top));
  if (Math.floor(span / step) + 1 > 1_000_000) return "Choose a larger depth step (frontend limit: 1,000,000 output rows, including gaps).";
  return null;
}
