import { describe, expect, it } from "vitest";
import { collectionFixture } from "../test-fixtures/collection-fixtures";
import { EMPTY_OVERLAP_DRAFT, collectionIssues, collectionOutputIssue, readOverlapDraft, reconcileOverlapDraft, unresolvedOverlaps } from "./collection-controller";

describe("explicit collection choices", () => {
  it("never fills in a default choice", () => {
    const collection = collectionFixture();
    const draft = reconcileOverlapDraft(EMPTY_OVERLAP_DRAFT, collection.overlaps);
    expect(draft.choices).toEqual({});
    expect(unresolvedOverlaps(collection, draft.choices)).toHaveLength(1);
  });
  it("requires choices by conflict ID and only accepts a candidate job", () => {
    const collection = collectionFixture();
    expect(unresolvedOverlaps(collection, { first: "first" })).toHaveLength(1);
    expect(unresolvedOverlaps(collection, { "overlap-a": "foreign-job" })).toHaveLength(1);
    expect(unresolvedOverlaps(collection, { "overlap-a": "second" })).toHaveLength(0);
  });
  it("retains relevant choices when fingerprint changes but conflicts do not", () => {
    const collection = collectionFixture();
    const draft = reconcileOverlapDraft(EMPTY_OVERLAP_DRAFT, collection.overlaps);
    draft.choices["overlap-a"] = "second";
    collection.revision = "new-fingerprint";
    collection.overlaps[0].job_ids.reverse();
    expect(reconcileOverlapDraft(draft, collection.overlaps).choices).toEqual(draft.choices);
  });
  it("invalidates only a changed interval, preserving unaffected decisions", () => {
    const collection = collectionFixture();
    collection.overlaps.push({ ...collection.overlaps[0], conflict_id: "overlap-b", depth_top: 110, depth_bottom: 120 });
    const draft = reconcileOverlapDraft(EMPTY_OVERLAP_DRAFT, collection.overlaps);
    draft.choices = { "overlap-a": "first", "overlap-b": "second" };
    collection.overlaps[0].depth_bottom = 90;
    expect(reconcileOverlapDraft(draft, collection.overlaps).choices).toEqual({ "overlap-b": "second" });
  });
  it("requires reconfirmation when candidate sets change, even with a valid old job", () => {
    const collection = collectionFixture();
    const draft = reconcileOverlapDraft(EMPTY_OVERLAP_DRAFT, collection.overlaps);
    draft.choices["overlap-a"] = "first";
    collection.overlaps[0].job_ids.push("third");
    expect(reconcileOverlapDraft(draft, collection.overlaps).choices).toEqual({});
  });
  it("removes obsolete conflicts and rejects invalid persisted choices", () => {
    const collection = collectionFixture();
    const draft = reconcileOverlapDraft(EMPTY_OVERLAP_DRAFT, collection.overlaps);
    draft.choices["overlap-a"] = "foreign";
    expect(reconcileOverlapDraft(draft, collection.overlaps).choices).toEqual({});
    expect(reconcileOverlapDraft(draft, []).choices).toEqual({});
  });
  it.each([null, "broken", "{}", '{"choices":[],"conflicts":{}}', '{"choices":{"c":123},"conflicts":{}}'])("rejects malformed draft %s", (raw) => {
    expect(readOverlapDraft(raw)).toEqual(EMPTY_OVERLAP_DRAFT);
  });
});

describe("collection readiness and resource validation", () => {
  it("allows independent spatial scales and depth ranges", () => {
    const collection = collectionFixture();
    collection.segments[1].job.calibration!.value_max = 200;
    collection.segments[1].job.raster.height = 400;
    expect(collectionIssues(collection)).toEqual([]);
  });
  it.each(["mnemonic", "value_unit", "depth_unit"] as const)("blocks incompatible %s without converting", (field) => {
    const collection = collectionFixture();
    collection.segments[1].job.calibration![field] = "OTHER";
    expect(collectionIssues(collection).join()).toContain("must match");
  });
  it("blocks unfinished jobs, missing calibration and backend issues", () => {
    const collection = collectionFixture();
    collection.segments[1].job.phase = "calibrating";
    collection.segments[1].job.calibration = null;
    collection.issues = ["Backend curve issue"];
    expect(collectionIssues(collection).join()).toContain("finish crop");
    expect(collectionIssues(collection)).toContain("Backend curve issue");
  });
  it("blocks invalid depth intervals", () => {
    const collection = collectionFixture();
    collection.segments[0].job.calibration!.depth_bottom = 0;
    expect(collectionIssues(collection).join()).toContain("invalid depth interval");
  });
  it.each([0, -1, NaN, Infinity])("blocks invalid output step %s", (step) => {
    expect(collectionOutputIssue(collectionFixture(), step)).toContain("finite positive");
  });
  it("limits output rows including inter-segment gaps", () => {
    const collection = collectionFixture();
    collection.segments[1].job.calibration!.depth_bottom = 2_000_000;
    expect(collectionOutputIssue(collection, 0.5)).toContain("including gaps");
    expect(collectionOutputIssue(collection, 5)).toBeNull();
  });
});
