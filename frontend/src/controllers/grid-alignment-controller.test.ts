import { describe, expect, it } from "vitest";
import { effectiveCurveSize, initialGridDraft, parseGridDraft, projectAlignedPoint, projectedBandPolygon, validateGridDraft, type GridDraft } from "./grid-alignment-controller";
import { gridAlignment, gridJob } from "../test-fixtures/grid-alignment-fixtures";
import { overlayRuns, projectOverlayRuns } from "../components/digitization/curve-overlay";
import type { SavedGridAlignment } from "../models/digitization-models";

function validDraft(): GridDraft { return { ...initialGridDraft(gridJob(true)), geometry_revision: "geometry-source" }; }
describe("manual grid geometry contracts (synthetic coordinates, no model evidence)", () => {
  it("seeds crop suggestions only as visibly unconfirmed; no crop auto-adoption", () => {
    const draft = initialGridDraft(gridJob());
    expect(draft.anchors).toHaveLength(2);
    expect(draft.anchors.every((a) => !a.left.confirmed && !a.right.confirmed)).toBe(true);
    expect(draft.anchors[0].left).toEqual({ x: "10", y: "10", confirmed: false });
    expect(validateGridDraft(draft, gridJob()).spec).toBeNull();
  });
  it("never invents depths or units for a job without saved calibration", () => {
    const draft = initialGridDraft({ ...gridJob(), calibration: null });
    expect(draft.depth_unit).toBe(""); expect(draft.anchors.map((a) => a.depth)).toEqual(["", ""]);
  });
  it("hydrates saved references rather than enclosing crop margins", () => {
    const draft = initialGridDraft(gridJob(true));
    expect(draft.anchors[0].left.x).toBe("20"); expect(draft.anchors[0].left.y).toBe("30");
    expect(draft.anchors.every((a) => a.left.confirmed && a.right.confirmed)).toBe(true);
    expect(validateGridDraft(draft, gridJob(true)).spec?.anchors).toEqual(gridAlignment.anchors);
  });
  it("uses canonical dimensions only when alignment is saved, retaining old jobs", () => {
    expect(effectiveCurveSize(gridJob(true))).toEqual({ width: 100, height: 200 });
    expect(effectiveCurveSize(gridJob())).toEqual({ width: 200, height: 400 });
    expect(effectiveCurveSize(null)).toEqual({ width: 0, height: 0 });
  });
  it.each([
    ["empty X", (d: GridDraft) => { d.anchors[0].left.x = ""; }],
    ["non-finite coordinate", (d: GridDraft) => { d.anchors[0].right.y = "Infinity"; }],
    ["empty depth", (d: GridDraft) => { d.anchors[1].depth = ""; }],
    ["nonincreasing depth", (d: GridDraft) => { d.anchors[1].depth = "100"; }],
    ["unit mismatch", (d: GridDraft) => { d.depth_unit = "M"; }],
    ["endpoint mismatch", (d: GridDraft) => { d.anchors[2].depth = "201"; }],
    ["source bounds", (d: GridDraft) => { d.anchors[1].left.x = "-1"; }],
    ["outside enclosing crop", (d: GridDraft) => { d.anchors[1].left.x = "5"; }],
    ["crossed width", (d: GridDraft) => { d.anchors[1].right.x = "20"; }],
    ["zero width", (d: GridDraft) => { d.anchors[1].right.x = "30"; d.anchors[1].right.y = "80"; }],
    ["folded band", (d: GridDraft) => { d.anchors[1].right.y = "20"; }],
    ["stale geometry", (d: GridDraft) => { d.geometry_revision = "old-image"; }],
    ["unconfirmed point", (d: GridDraft) => { d.anchors[1].left.confirmed = false; }],
  ] as const)("blocks invalid geometry locally: %s", (_, change) => {
    const draft = validDraft(); change(draft); const result = validateGridDraft(draft, gridJob());
    expect(result.spec).toBeNull(); expect(result.errors.length).toBeGreaterThan(0);
  });
  it("rejects more than 32 references and unsupported old servers", () => {
    const draft = validDraft(); draft.anchors = Array.from({ length: 33 }, () => draft.anchors[0]);
    expect(validateGridDraft(draft, gridJob()).errors.join(" ")).toContain("2–32");
    expect(validateGridDraft(validDraft(), { ...gridJob(), geometry_revision: undefined }).errors.join(" ")).toContain("does not support");
  });
  it("retains roundoff tolerance of the backend calibration check", () => {
    const draft = validDraft(); draft.anchors[0].depth = "100.000000001";
    expect(validateGridDraft(draft, gridJob()).spec).not.toBeNull();
  });
  it("parses drafts only for the exact working geometry revision", () => {
    const raw = JSON.stringify(validDraft());
    expect(parseGridDraft(raw, "geometry-source")).toEqual(validDraft());
    expect(parseGridDraft(raw, "other-raster")).toBeUndefined();
    expect(parseGridDraft('{"anchors":[]}', "geometry-source")).toBeUndefined();
  });
  it("projects by known depth bands, not equal anchor spacing or crop row offsets", () => {
    expect(projectAlignedPoint(gridAlignment, 0, 0)).toEqual({ x: 20, y: 30 });
    expect(projectAlignedPoint(gridAlignment, 100, 200)).toEqual({ x: 150, y: 220 });
    expect(projectAlignedPoint(gridAlignment, 50, 50)).toEqual({ x: 85, y: 85 });
    const point = projectAlignedPoint(gridAlignment, 50, 100)!;
    expect(point.x).toBeCloseTo(88.3333333333); expect(point.y).toBeCloseTo(126.6666666667);
  });
  it("projects a small interval at large absolute depths without cancellation or rewriting anchor values", () => {
    const first = 1e8;
    const alignment: SavedGridAlignment = { ...structuredClone(gridAlignment), height: 200,
      anchors: gridAlignment.anchors.map((a, i) => ({ ...structuredClone(a), depth: first + i * .01 })) };
    const relative: SavedGridAlignment = { ...alignment, anchors: alignment.anchors.map((a) => ({ ...a, depth: a.depth - first })) };
    const before = JSON.stringify(alignment);
    let previousY = -Infinity;
    for (let row = 0; row <= 200; row++) {
      for (const x of [0, 25, 100]) expect(projectAlignedPoint(alignment, x, row)).toEqual(projectAlignedPoint(relative, x, row));
      const point = projectAlignedPoint(alignment, 0, row)!;
      expect(point.y).toBeGreaterThan(previousY); previousY = point.y;
    }
    const middleRow = (alignment.anchors[1].depth - first) / (alignment.anchors[2].depth - first) * alignment.height;
    expect(projectAlignedPoint(alignment, 0, middleRow)!.y).toBeCloseTo(alignment.anchors[1].left.y, 10);
    const polygon = projectedBandPolygon(alignment, 50, 150);
    expect(polygon[1]).toEqual(alignment.anchors[1].left); expect(polygon[4]).toEqual(alignment.anchors[1].right);
    expect(JSON.stringify(alignment)).toBe(before); expect(alignment.revision).toBe(gridAlignment.revision);
  });
  it("accepts sufficient large-depth precision and blocks spans too narrow for distinct canonical export rows", () => {
    const draft = validDraft(); draft.anchors.forEach((a, i) => { a.depth = String(1e8 + i * .01); });
    const job = { ...gridJob(), calibration: { ...gridJob().calibration!, depth_top: 1e8, depth_bottom: 1e8 + .02 } };
    expect(validateGridDraft(draft, job).spec).not.toBeNull();
    draft.anchors.forEach((a, i) => { a.depth = String(1e8 + i * .000001); }); job.calibration.depth_bottom = 1e8 + .000002;
    const result = validateGridDraft(draft, job);
    expect(result.spec).toBeNull(); expect(result.errors.join(" ")).toContain("insufficient for aligned row precision");
  });
  it.each([
    ["zero width", { ...gridAlignment, width: 0 }],
    ["non-finite height", { ...gridAlignment, height: Infinity }],
    ["missing references", { ...gridAlignment, anchors: [] }],
    ["collapsed depth span", { ...gridAlignment, anchors: gridAlignment.anchors.map((a) => ({ ...a, depth: 1e8 })) }],
    ["non-finite anchor depth", { ...gridAlignment, anchors: gridAlignment.anchors.map((a, i) => i === 1 ? { ...a, depth: NaN } : a) }],
  ] satisfies Array<[string, SavedGridAlignment]>)("does not project malformed saved dimensions/depths: %s", (_, alignment) => {
    expect(projectAlignedPoint(alignment, 50, 100)).toBeNull(); expect(projectedBandPolygon(alignment, 50, 150)).toEqual([]);
  });
  it("does not form NULL polygons from non-finite or wholly out-of-frame ranges", () => {
    expect(projectedBandPolygon(gridAlignment, NaN, 150)).toEqual([]);
    expect(projectedBandPolygon(gridAlignment, 250, 300)).toEqual([]);
    expect(projectedBandPolygon(gridAlignment, -20, -10)).toEqual([]);
    expect(projectedBandPolygon(gridAlignment, 150, 50)).toEqual([]);
  });
  it.each([[-1, 10], [101, 10], [50, -1], [50, 201], [NaN, 20], [50, Infinity]])("does not invent ink outside the unwrapped mesh: (%s,%s)", (x, row) => {
    expect(projectAlignedPoint(gridAlignment, x, row)).toBeNull();
  });
  it("keeps every finite projected point, NULL breaks and redraw provenance", () => {
    const x = [10, 20, null, 30, 120, 40, 50];
    const runs = projectOverlayRuns(overlayRuns(x, 0, x.length, [{ kind: "redraw", y0: 5, y1: 7, x_by_row: [40, 50] }]), gridAlignment);
    expect(runs.map((run) => [run.kind, run.points.length])).toEqual([["prediction", 2], ["prediction", 1], ["manual", 2]]);
    expect(runs.flatMap((run) => run.points)).toHaveLength(5);
    expect(runs.at(-1)!.points[0]).toEqual({ x: projectAlignedPoint(gridAlignment, 40, 5)!.x, row: projectAlignedPoint(gridAlignment, 40, 5)!.y });
    expect(x).toEqual([10, 20, null, 30, 120, 40, 50]);
  });
  it("projects NULL band polygons through each intermediate mesh boundary", () => {
    const polygon = projectedBandPolygon(gridAlignment, 25, 150);
    expect(polygon).toHaveLength(6); expect(polygon[1]).toEqual(gridAlignment.anchors[1].left);
    expect(polygon[4]).toEqual(gridAlignment.anchors[1].right);
    expect(polygon[0].y).not.toBe(polygon.at(-1)!.y);
  });
});
