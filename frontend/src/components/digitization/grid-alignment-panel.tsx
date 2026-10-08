import { changeGridDepth, gridGeometryIssues, intermediateDepthIssue, orderGridLines, type ReferenceSide } from "../../controllers/grid-alignment-controller";
import type { useGridAlignment } from "../../hooks/use-grid-alignment";
import type { JobSummary } from "../../models/digitization-models";
import styles from "../../workspaces/curve-workspace.module.css";
import gridStyles from "./grid-alignment.module.css";

export function GridAlignmentPanel({ job, grid, disabled, calibrationChanged, target, onTargetChange, placing, onPlacingChange, onClose }: {
  job: JobSummary; grid: ReturnType<typeof useGridAlignment>; disabled: boolean; calibrationChanged: boolean;
  target: { index: number; side: ReferenceSide }; onTargetChange: (target: { index: number; side: ReferenceSide }) => void;
  placing: boolean; onPlacingChange: (value: boolean) => void; onClose: () => void;
}) {
  const blocked = disabled || grid.saving || ["pending", "running"].includes(job.detection?.status ?? "");
  const valid = !!grid.validation.spec && !calibrationChanged && grid.supported;
  const unconfirmed = grid.draft.anchors.some((a) => !a.left.confirmed || !a.right.confirmed);
  const index = Math.min(target.index, grid.draft.anchors.length - 1);
  const selected = grid.draft.anchors[index];
  const depthIssue = intermediateDepthIssue(grid.draft, index);
  const unordered = orderGridLines(grid.draft, index).draft !== grid.draft;
  const geometryIssues = unordered ? [] : gridGeometryIssues(grid.draft);
  const setDepth = (i: number, value: string) => {
    const result = changeGridDepth(grid.draft, i, value);
    onPlacingChange(false); grid.update(() => result.draft); onTargetChange({ index:result.index, side:target.side });
  };
  const addLine = () => {
    const i = grid.draft.anchors.length-1;
    onPlacingChange(false); onTargetChange({ index:i, side:"left" });
    grid.update(d => ({ ...d, anchors:[...d.anchors.slice(0,-1), { depth:"", left:{ x:"", y:"", confirmed:false }, right:{ x:"", y:"", confirmed:false } }, d.anchors.at(-1)!] }));
  };
  const points = grid.draft.anchors.reduce((n, a) => n + Number(a.left.confirmed) + Number(a.right.confirmed), 0);
  const lineName = (i: number) => i === 0 ? "Top line" : i === grid.draft.anchors.length - 1 ? "Bottom line" : `Intermediate line ${i}`;
  const chooseLine = (i: number) => { onPlacingChange(false); onTargetChange({ index: i, side: "left" }); };
  const markPair = () => {
    grid.update((previous) => ({ ...previous, anchors: previous.anchors.map((a, i) => i === index ? { ...a, left: { ...a.left, confirmed: false }, right: { ...a.right, confirmed: false } } : a) }));
    onTargetChange({ index, side: "left" }); onPlacingChange(true);
  };
  const nextIncomplete = grid.draft.anchors.findIndex((a, i) => i !== index && (!a.left.confirmed || !a.right.confirmed));
  const matchesSaved = !!job.alignment && JSON.stringify(grid.validation.spec) === JSON.stringify({ anchors: job.alignment.anchors.map((a) => ({ left: { x: a.left.x, y: a.left.y }, right: { x: a.right.x, y: a.right.y }, depth: a.depth })), depth_unit: job.alignment.depth_unit });
  const resumeRight = selected.left.confirmed && !selected.right.confirmed && !placing;
  const issue = grid.validation.errors.some((e) => e.includes("RIGHT must")) ? "Left and right points are too close or reversed. Re-mark both edges on that depth line."
    : grid.validation.errors.some((e) => e.includes("cross, fold") || e.includes("advance downward")) ? "Some marked lines overlap or run backwards. Re-mark the printed depth lines in top-to-bottom order."
    : grid.validation.errors.some((e) => e.includes("depths must increase")) ? "Intermediate depths must be between the top and bottom depths, in increasing order. Read them from the scan."
    : "Check that each pair is on the same printed depth line and inside the crop. More detail is available in Advanced coordinates & settings.";
  const markingBlocked = blocked || !grid.supported || calibrationChanged || !job.calibration || !selected.depth.trim() || !Number.isFinite(Number(selected.depth)) || !!depthIssue || grid.previewing || !!grid.preview;
  const markButton = <button type="button" className={matchesSaved || selected.left.confirmed && selected.right.confirmed ? styles.secondary : styles.primary} disabled={markingBlocked} onClick={() => { if (resumeRight) { onTargetChange({ index, side: "right" }); onPlacingChange(true); } else markPair(); }}>{placing ? "Restart this line" : resumeRight ? "Mark right edge" : selected.left.confirmed && selected.right.confirmed ? "Re-mark both edges" : "Mark both edges"}</button>;
  return <div className={gridStyles.panelFrame} data-grid-alignment-panel role="region" aria-label="Grid alignment references"><div className={gridStyles.panel}>
    <h2>Straighten the printed grid</h2>
    <p className={styles.muted}>Use this only if the scan’s grid is tilted or drifts sideways. Mark the grid, not the curve. Your original scan is kept.</p>
    <ol className={gridStyles.steps} aria-label="Alignment steps"><li aria-current={unconfirmed ? "step" : undefined}>1 · Mark top & bottom</li><li aria-current={!unconfirmed && !matchesSaved ? "step" : undefined}>2 · Preview & save</li><li aria-current={matchesSaved ? "step" : undefined}>3 · Process curve</li></ol>
    {unconfirmed && <svg className={gridStyles.example} viewBox="0 0 220 100" role="img" aria-label="Example: click the left and right grid intersections on the same printed depth line, not the curve">
      <title>Example only — not your scan</title>
      <path d="M28 27H192 M28 52H192 M28 77H192 M28 27V77 M69 27V77 M110 27V77 M151 27V77 M192 27V77" fill="none" stroke="currentColor" opacity=".3" />
      <path d="M100 27 Q148 38 106 52 T118 77" fill="none" stroke="currentColor" opacity=".5" />
      <path d="M28 52H192" fill="none" stroke="#91c2cf" strokeWidth="2" /><circle cx="28" cy="52" r="7" fill="#91c2cf" /><circle cx="192" cy="52" r="7" fill="#91c2cf" />
      <text x="28" y="14" textAnchor="middle">LEFT</text><text x="192" y="14" textAnchor="middle">RIGHT</text><text x="28" y="56" textAnchor="middle" className={gridStyles.pointNumber}>1</text><text x="192" y="56" textAnchor="middle" className={gridStyles.pointNumber}>2</text>
      <text x="110" y="95" textAnchor="middle">Same depth line · two clicks</text>
    </svg>}
    {!grid.supported && <p role="alert" className={styles.notice}>Grid alignment requires a revision-aware digitization API. This server or mock does not support it.</p>}
    {["pending", "running"].includes(job.detection?.status ?? "") && <p role="status" className={styles.notice}>Wait for detection publication before previewing or saving geometry.</p>}
    {!job.calibration && <p role="alert" className={styles.notice}>Go back and save the curve scale and depth range first.</p>}
    {calibrationChanged && <p role="alert" className={styles.notice}>Save your calibration draft before aligning. Return to calibration to save the changed crop or depth range; marking is unavailable until then.</p>}
    <button type="button" className={styles.secondary} disabled={blocked || grid.draft.anchors.length >= 32 || !!grid.preview || grid.draft.anchors.slice(1,-1).some(a => !a.depth.trim())} onClick={addLine}>Add intermediate depth line</button>
    <p className={styles.muted}>Lines are ordered by depth automatically. Scroll this panel to see more; the image has its own navigation.</p>
    {unordered && <div className={styles.notice}><p>Existing draft lines are out of depth order. Keep each line’s points together and reorder the list.</p><button type="button" className={styles.secondary} disabled={blocked || !!grid.preview} onClick={() => { const next=orderGridLines(grid.draft,index); onPlacingChange(false); grid.update(() => next.draft); onTargetChange({ index:next.index, side:target.side }); }}>Order lines by depth</button></div>}
    <nav className={gridStyles.lineChoices} aria-label="Choose a depth line">{grid.draft.anchors.map((a, i) => <button type="button" key={`choose-line:${i}`} className={styles.secondary} disabled={blocked} aria-current={i === index ? "step" : undefined} onClick={() => chooseLine(i)}><span>{lineName(i)} · {a.depth || "enter depth"} {grid.draft.depth_unit}</span><small title={a.left.confirmed && a.right.confirmed ? "Both points marked" : "Points still to mark"} aria-label={a.left.confirmed && a.right.confirmed ? "Both points marked" : `${Number(a.left.confirmed)+Number(a.right.confirmed)} of 2 points marked`}>{a.left.confirmed && a.right.confirmed ? "✓ 2/2" : `${Number(a.left.confirmed) + Number(a.right.confirmed)}/2`}</small></button>)}</nav>
    {geometryIssues.map(({ indices, message }) => <div key={indices.join(":")} role="alert" className={styles.notice}><p>{message}</p>{indices.map(i => <button key={i} type="button" className={styles.secondary} disabled={blocked} onClick={() => chooseLine(i)}>Check {grid.draft.anchors[i].depth} {grid.draft.depth_unit}</button>)}</div>)}
    <details className={gridStyles.currentLine} open={unconfirmed || placing} aria-label="Current depth line">
      <summary>{unconfirmed ? lineName(index) : `Edit ${lineName(index).toLowerCase()} points`} · {selected.depth || "enter depth"} {grid.draft.depth_unit}</summary>
      <div className={gridStyles.lineControls}>
      {index > 0 && index < grid.draft.anchors.length - 1 ? <label className={styles.field}>Depth printed on this line<input aria-label="Intermediate line depth" aria-invalid={!!depthIssue} type="number" step="any" disabled={blocked} placeholder="Read it from the scan" value={selected.depth} onChange={(e) => setDepth(index,e.target.value)} />{depthIssue && <span role="alert" className={styles.error}>{depthIssue}</span>}</label> : <p className={styles.muted}>Depth comes from your saved calibration. Find this printed line on the scan.</p>}
      <p className={styles.muted}>At this depth, click where the line meets the <strong>left scale edge ({job.calibration?.value_min ?? "left value"})</strong>, then the <strong>right scale edge ({job.calibration?.value_max ?? "right value"})</strong>. The crop border may be elsewhere.</p>
      {resumeRight && <button type="button" className={styles.secondary} disabled={blocked} onClick={markPair}>Restart this line</button>}
      {!selected.depth.trim() && <p role="alert" className={styles.notice}>{index > 0 && index < grid.draft.anchors.length - 1 ? "Enter the printed depth above before marking this line." : "This endpoint has no depth in the local draft. Set it in Advanced coordinates & settings to match your saved calibration, or return to calibration to set the correct range."}</p>}
      {placing && <p role="status" className={gridStyles.prompt}>Click the {target.side.toUpperCase()} grid intersection on the image. {target.side === "left" ? "The next click will mark RIGHT." : "Keep to the same printed depth line."}</p>}
      </div>
    </details>
    {unconfirmed && <p role="status" className={styles.muted}>{points}/{grid.draft.anchors.length * 2} points marked. Unconfirmed references — place on printed grid.</p>}
    <details className={styles.help}><summary>Grid still bends between those lines?</summary><p>Add a line only where you can read its actual depth. Two lines are enough for a simple tilt; more lines can describe local drift. More is not always better: every line must be read and marked correctly.</p></details>
    {index > 0 && index < grid.draft.anchors.length - 1 && <button type="button" className={styles.secondary} disabled={blocked} onClick={() => { chooseLine(0); grid.update((previous) => ({ ...previous, anchors: previous.anchors.filter((_, i) => i !== index) })); }}>Remove selected intermediate line</button>}
    <details className={styles.help}><summary>How to check the preview</summary><p>Check the printed lines between your references, not only those you marked — marked lines are straight by construction. Preview does not check curve identity or physical units.</p></details>
    <details className={styles.help}><summary>Advanced coordinates & settings</summary>
    <p className={styles.muted}>Optional: precise coordinates in the working raster. Editing X/Y requires confirming that point again. No curve following or automatic reference acceptance.</p>
    <label className={styles.field}>Printed depth unit<select aria-label="Grid depth unit" value={grid.draft.depth_unit} disabled={blocked} onChange={(e) => grid.update((previous) => ({ ...previous, depth_unit: e.target.value }))}><option value="">Choose…</option><option value="FT">FT</option><option value="M">M</option></select></label>
    <label className={styles.field}>Reference to place<select aria-label="Reference to place" disabled={blocked} value={`${target.index}:${target.side}`} onChange={(e) => { const [index, side] = e.target.value.split(":"); onTargetChange({ index: Number(index), side: side as ReferenceSide }); onPlacingChange(false); }}>
      {grid.draft.anchors.flatMap((_, index) => (["left", "right"] as const).map((side) => <option key={`${index}:${side}`} value={`${index}:${side}`}>Line {index + 1} · {side.toUpperCase()}</option>))}
    </select></label>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={blocked || !grid.supported} aria-pressed={!placing} onClick={() => onPlacingChange(false)}>Pan / Inspect</button><button type="button" id="set-grid-reference" className={styles.primary} disabled={blocked || !grid.supported} aria-pressed={placing} onClick={() => onPlacingChange(true)}>Set reference</button></div>
    {grid.draft.anchors.map((anchor, index) => <fieldset className={gridStyles.line} disabled={blocked} key={`grid-line:${index}`}><legend>Depth line {index + 1}{index === 0 ? " · first" : index === grid.draft.anchors.length - 1 ? " · last" : " · intermediate"}</legend>
       <label className={styles.field}>Known printed depth<input aria-label={`Line ${index + 1} depth`} type="number" step="any" value={anchor.depth} onChange={(e) => setDepth(index,e.target.value)} /></label>
      {(["left", "right"] as const).map((side) => <div key={`${index}:${side}`}>
        <strong>{side.toUpperCase()} scale reference · {anchor[side].confirmed ? "confirmed" : "unconfirmed"}</strong>
        <div className={gridStyles.reference}>{(["x", "y"] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} (working px)<input aria-label={`Line ${index + 1} ${side} ${axis.toUpperCase()}`} type="number" step="any" value={anchor[side][axis]} onChange={(e) => grid.update((previous) => ({ ...previous, anchors: previous.anchors.map((a, i) => i === index ? { ...a, [side]: { ...a[side], [axis]: e.target.value, confirmed: false } } : a) }))} /></label>)}</div>
        <button type="button" className={styles.secondary} disabled={anchor[side].confirmed || !anchor[side].x.trim() || !anchor[side].y.trim() || ![Number(anchor[side].x), Number(anchor[side].y)].every(Number.isFinite)} onClick={() => grid.update((previous) => ({ ...previous, anchors: previous.anchors.map((a, i) => i === index ? { ...a, [side]: { ...a[side], confirmed: true } } : a) }))}>Confirm {side.toUpperCase()} coordinates</button>
      </div>)}
      {index > 0 && index < grid.draft.anchors.length - 1 && <button type="button" className={styles.secondary} onClick={() => { onPlacingChange(false); onTargetChange({ index: 0, side: "left" }); grid.update((previous) => ({ ...previous, anchors: previous.anchors.filter((_, i) => i !== index) })); }}>Delete intermediate line</button>}
       {index < grid.draft.anchors.length - 1 && <button type="button" className={styles.secondary} disabled={grid.draft.anchors.length >= 32} onClick={addLine}>Add known depth line below</button>}
    </fieldset>)}
    <p className={styles.muted}>{grid.draft.anchors.length}/32 lines · X/Y are full working-raster coordinates, not upload or crop-local coordinates.</p>
    {grid.validation.errors.length > 0 && <details className={styles.help}><summary>Reference validation ({grid.validation.errors.length})</summary>{grid.validation.errors.map((message, i) => <p key={i}>{message}</p>)}</details>}
    {grid.preview && <p className={styles.muted}>Server preview · not saved · {grid.preview.alignment.width} × {grid.preview.alignment.height} canonical px</p>}
    </details>
    {job.alignment && <><p className={styles.muted}>Saved alignment · {job.alignment.algorithm} · {job.alignment.width} × {job.alignment.height} canonical px</p><button type="button" className={styles.secondary} disabled={blocked || !grid.supported} onClick={() => void grid.save(true)}>Disable saved alignment…</button></>}
    {!!job.alignment_history_count && <p className={styles.muted}>{job.alignment_history_count} preserved geometry {job.alignment_history_count === 1 ? "version" : "versions"} on the server. No restore action is provided here.</p>}
    {grid.draft.geometry_revision !== job.geometry_revision && <button className={styles.secondary} disabled={blocked} onClick={grid.reloadReferences}>Load current-frame references</button>}
    {grid.error && <p role="alert" className={styles.error}>{grid.error}</p>}
    <p className={styles.muted}>Drafts and previews are not used by Process curve. Only an explicitly saved alignment changes geometry.</p>
    {!valid && !unconfirmed && !unordered && !geometryIssues.length && <p role="alert" className={styles.notice}>{issue}</p>}
    </div>
    <div className={gridStyles.finish} aria-label="Alignment actions">
      <strong>{grid.preview ? "Preview · not saved" : placing ? `Mark ${target.side.toUpperCase()} · ${selected.depth} ${grid.draft.depth_unit}` : matchesSaved ? "Alignment saved" : "References · not saved"}</strong>
      {!grid.preview && markButton}
      {placing && <button type="button" className={styles.secondary} onClick={() => onPlacingChange(false)}>Stop marking / pan</button>}
      {!grid.preview && selected.left.confirmed && selected.right.confirmed && nextIncomplete >= 0 && <button type="button" className={styles.primary} disabled={blocked} onClick={() => chooseLine(nextIncomplete)}>Next: {lineName(nextIncomplete).toLowerCase()}</button>}
      <button type="button" className={styles.secondary} disabled={blocked || !grid.canUndo} onClick={() => { onPlacingChange(false); const previous=grid.undo(); if (previous) { const i=previous.anchors.findIndex(a => a.left===selected.left || a.right===selected.right); onTargetChange({ index:Math.max(0,i), side:target.side }); } }}>Undo last change</button>
      {!grid.preview && <button type="button" id="preview-grid-alignment" style={{ display: unconfirmed ? "none" : undefined }} className={valid && !matchesSaved ? styles.primary : styles.secondary} disabled={blocked || !valid || grid.previewing} onClick={() => { onPlacingChange(false); void grid.requestPreview(); }}>{grid.previewing ? "Previewing…" : "Preview alignment"}</button>}
      {grid.preview && <button type="button" className={styles.secondary} onClick={grid.cancelPreview}>Back to marking points</button>}
      <button type="button" id="save-grid-alignment" style={{ display: unconfirmed || matchesSaved ? "none" : undefined }} className={grid.preview ? styles.primary : styles.secondary} disabled={blocked || !valid || grid.previewing || placing || matchesSaved} onClick={() => void grid.save()}>{grid.saving ? "Saving geometry…" : "Confirm and save alignment"}</button>
      {matchesSaved && <><p role="status" className={styles.muted}>{job.quality ? "The saved alignment is already used by this prediction." : "Next: return, click Process curve above, then open Review. Processing does not start automatically."}</p><button type="button" className={styles.primary} disabled={blocked} onClick={() => { onPlacingChange(false); onClose(); }}>Done — return to calibration</button></>}
      <button type="button" className={styles.secondary} disabled={blocked} onClick={() => { onPlacingChange(false); grid.cancelPreview(); onClose(); }}>Cancel / return to calibration</button>
    </div>
  </div>;
}
