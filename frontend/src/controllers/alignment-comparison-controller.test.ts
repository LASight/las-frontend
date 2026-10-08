import { describe, expect, it } from "vitest";
import { comparisonSourceView } from "./alignment-comparison-controller";
import { projectAlignedPoint } from "./grid-alignment-controller";
import { gridAlignment } from "../test-fixtures/grid-alignment-fixtures";

describe("comparison matches depth center and relative track zoom, not distorted pixels", () => {
  it.each([0, 40, 120, 200])("matches the canonical/source center on row %s", (row) => {
    const view = { scale: 3, tx: 200-50*3, ty: 150-row*3 }, size = { width: 400, height: 300 };
    const source = comparisonSourceView(gridAlignment, view, size), p = projectAlignedPoint(gridAlignment, 50, row)!;
    expect(p.x*source.scale+source.tx).toBeCloseTo(200); expect(p.y*source.scale+source.ty).toBeCloseTo(150);
    const left = projectAlignedPoint(gridAlignment,0,row)!, right = projectAlignedPoint(gridAlignment,100,row)!;
    expect(Math.hypot(right.x-left.x,right.y-left.y)*source.scale).toBeCloseTo(300);
  });
  it("uses boundary depth rather than extrapolating outside the grid", () => {
    const v = comparisonSourceView(gridAlignment,{ scale: 1, tx: 150, ty: 1000 },{ width: 400, height: 300 });
    const p = projectAlignedPoint(gridAlignment,50,0)!; expect(p.y*v.scale+v.ty).toBeCloseTo(150);
  });
});
