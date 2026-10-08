import { describe, expect, it } from "vitest";
import { changeGridDepth, gridGeometryIssues, intermediateDepthIssue, orderGridLines, type GridDraft } from "./grid-alignment-controller";
const anchor = (depth: string, y: number) => ({ depth, left:{ x:"20", y:String(y), confirmed:true }, right:{ x:"120", y:String(y), confirmed:true } });
const draft = (): GridDraft => ({ geometry_revision:"source", depth_unit:"FT", anchors:[anchor("300",30),anchor("1900",190),anchor("1000",100),anchor("2700",270),anchor("3500",350)] });
describe("depth-ordered references preserve their points, not their insertion position", () => {
  it("repairs the reported 300/1900/1000/2700/3500 draft without changing any pair", () => {
    const original = draft(), result = orderGridLines(original,2);
    expect(result.draft.anchors.map(a=>a.depth)).toEqual(["300","1000","1900","2700","3500"]); expect(result.index).toBe(1);
    expect(result.draft.anchors[1]).toBe(original.anchors[2]); expect(result.draft.anchors[2]).toBe(original.anchors[1]); expect(original.anchors[1].depth).toBe("1900");
  });
  it("changing a depth follows the selected reference across reordering", () => {
    const original = orderGridLines(draft(),1).draft, result = changeGridDepth(original,3,"800");
    expect(result.index).toBe(1); expect(result.draft.anchors.map(a=>a.depth)).toEqual(["300","800","1000","1900","3500"]);
    expect(result.draft.anchors[1].left).toBe(original.anchors[3].left); expect(result.draft.anchors[1].right).toBe(original.anchors[3].right);
  });
  it.each(["", "not a number", "300", "3500", "200", "4000", "1000"])("blocks invalid/duplicate intermediate %s before placement", depth => {
    const result = changeGridDepth(draft(),1,depth); expect(intermediateDepthIssue(result.draft,result.index)).not.toBeNull();
    expect(result.draft.anchors[result.index].depth).toBe(depth);
  });
  it("keeps empty pending lines before the bottom, never inventing depths", () => {
    const original=draft(); original.anchors.splice(2,0,anchor("",0)); const result=orderGridLines(original,2);
    expect(result.index).toBe(4); expect(result.draft.anchors[4].depth).toBe(""); expect(result.draft.anchors.at(-1)).toBe(original.anchors.at(-1));
  });
  it("does not change an already ordered draft", () => { const d=orderGridLines(draft(),1).draft; expect(orderGridLines(d,1).draft).toBe(d); });
  it("identifies actual reversed source edges after numeric order is correct", () => {
    const d=orderGridLines(draft(),1).draft; d.anchors[2]={ ...d.anchors[2], left:{ ...d.anchors[2].left,y:"90" } };
    expect(gridGeometryIssues(d)[0]).toEqual({ indices:[1,2], message:expect.stringContaining("1000–1900 FT: the LEFT edge") });
  });
});
