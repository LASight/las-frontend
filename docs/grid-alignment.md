# Align grid — manual per-segment geometry

New candidate branch `feat/grid-alignment`, based on the reviewed delivery UI.
The earlier PR remains unchanged. This is not a grid detector, general paper
dewarper or certification of model accuracy.

## Workflow

1. Confirm an enclosing crop. Its margins need not coincide with printed scale
   references and may retain space around the trace.
2. Save the physical scale/depth calibration read from the source.
3. In Calibrate → **Align grid**, select **Top line → Mark both edges**. Click its
   LEFT printed scale intersection, then RIGHT on the same depth line. The banner
   over the scan tells you which click is next; the camera stays still between them.
4. Choose **Next: bottom line** and mark its two intersections. These first/last
   depths and units come from the saved physical calibration, not pixel margins.
   Add optional intermediate lines only at actual printed depths when needed.
   Each new intermediate line starts empty; no depth or point is accepted for you.
5. **Preview alignment** shows a large unsaved overview on the main stage.
   **Enlarge preview** and scroll to inspect, or compare with the source without
   remounting it. Explicitly save, then **Done — return to calibration**.
6. Run **Process curve**. The existing model operates on the separately rectified
   strip, with values/depth indexed in that canonical frame.
7. Review **Aligned** to correct values; switch to **Original** to inspect the same
   trace projected onto its source, not a second independent prediction.

If preprocessing has already changed the working raster, the reference frame is
that displayed working image. The uploaded original remains immutable; do not
claim that a preprocessed working view is the untouched upload.

## Navigation and correction safety

Navigation is the default. Placing a grid reference is explicit, so pan/zoom,
scroll and temporary pan do not silently change calibration. Precise coordinate
and depth inputs are available under **Advanced coordinates & settings**.
After LEFT, the guided mode asks for RIGHT; it stops after the pair. Escape or
**Stop marking / pan** pauses without adopting an old second point; **Mark right
edge** resumes a partial pair. Restarting a pair clears both local confirmations,
never the saved prediction. Guided clicks outside the saved crop are rejected,
not clamped, with a visible recovery message. Use printed grid intersections, not
curve extrema or apparent formation boundaries.

Edits remain one append-only list in the **aligned** frame. Original projected
inspection is read-only in this version; switch back to Aligned for Redraw/Mark
missing. A bitmap aligned mask is not overlaid on untransformed source pixels.
NULL/out-of-domain points break projected traces. Unwrap positions beyond the
printed scale are not attributed to source ink outside the mesh.

## Persistence and invalidation

Every segment owns its geometry. Explicit preview/cancel do not save the job.
Save/remove geometry use current geometry and edits revisions, serialize with
other operations and require acknowledgement when prediction/corrections exist.
Previous immutable work is retained, but not silently moved to new coordinates.
Existing exports/analysis records and other members remain unchanged.

Aligned dimensions, not enclosing crop dimensions, determine the correction
bounds and pixel-to-value/depth conversion. Depth endpoints/unit must agree with
the saved calibration; value range, mnemonic and units still require operator
confirmation. Legacy jobs without alignment retain their existing behavior.

Changed calibration is an explicit confirmed invalidation: server history retains
old work, while the active prediction/corrections/LAS require reprocessing. A
value-only change keeps compatible saved grid geometry; identical saves preserve
work. Draft numeric edits alone do not change the server result.

Drafts use account isolation and stale asynchronous previews must not replace
newer inputs/session data. Focus view, prediction controls, joint outputs and
explicit overlap resolution remain the current shared workflow.

## Limitations / verification

The deformation model uses straight reference lines connected by bilinear bands.
It supports mild local rotation/drift/width/feed variation; add real references or
split where geometry exceeds this model. Do not assume two endpoints correct
every interior distortion. Bounded preview cannot certify fine-grid accuracy.

Pure geometry, frontend contracts, backend persistence/ownership and browser
behavior are validated separately. Synthetic fixture references are synthetic;
they do not establish historical accuracy, trace identity or real scanner
tolerances. The inherited dependency vulnerabilities/production security limits
remain separate.

Initial acceptance: **505 tests passed in 48 files**, including the earlier 406 cases; typecheck and
production build passed with the actual relative-API preview configuration.
Browser acceptance on the separate API 8005 / preview 5179 additionally covers
manual reference placement, preview no-write, canonical dimensions/reload,
Original inspection-only, redraw/focus/view persistence, calibration reset,
geometry archive/reset and other-member preservation, mixed aligned/legacy LAS,
and account isolation. Generated references are not historical ground truth.
Detailed logs/captures are in `validation/2026-10-04-grid-alignment/` at the workspace
root. The final presentation rerun passed all nine candidate controls; four additional real-source
inspection controls passed after restarting the candidate API against its durable
database/artifacts. No runtime errors were observed in either final run.

On desktop the grid-reference form scrolls independently so intermediate/bottom
reference inputs do not scroll the source stage out of view. Narrow screens retain
the existing stacked layout. No archive-restore controls are added.

## Guided interaction revision — 5 October

User feedback identified that the first coordinate-heavy form was hard to use.
The normal flow now needs only source clicks; an example diagram, three-step
progress, named top/bottom lines, per-pair status and direct canvas instructions
explain the interaction. The editor initially focuses the crop; choosing a line
travels to it. This travel is a navigation hint, never an inferred grid anchor.
Completed placement controls collapse to make preview/save and the next step
visible. Exact coordinates and bulk/low-level settings remain optional.

**511 frontend tests passed / 48 files**, typecheck/build/diff passed. Six new
interaction regressions cover four-click placement without Advanced, confirmation
reset/cancel, pause/resume RIGHT, out-of-crop recovery, empty intermediate depth,
and large-preview/source comparison without remount/save. The new browser runner
and captures are in `validation/2026-10-05-grid-guidance/` at the workspace root.
Earlier evidence is not overwritten. This verifies functionality, not a usability
study, participant acceptance or real-well model/calibration accuracy.

### Empty-depth/navigation-hand regression reported from the real UI

The hook is mounted before the operator saves crop/calibration. Previously its
initial empty suggestions survived those saves, leaving `Top line · enter depth`
and a disabled Mark button even though physical calibration existed. Earlier
browser fixtures were calibrated through the API before mounting, so they did
not exercise this lifecycle.

Untouched initial suggestions now follow explicit crop/calibration saves. A cached
unmarked draft can acquire only absent first/last depth and unit metadata from the
saved calibration, leaving coordinates and confirmation flags unchanged. Marked,
custom-depth and stale edited geometry are never silently reinterpreted. A
deliberate Advanced blank is not continuously overwritten while typing. No new
server mutation, inferred anchor or automatic process/analysis is added.

Missing calibration/draft-change blockers are visible outside Advanced; endpoint
warnings no longer request an input that does not exist in the normal panel.
The browser regression now mounts before crop/calibration and saves both through
the actual UI before checking that Mark both edges enables and the cursor becomes
a crosshair. Earlier attempt logs remain unchanged.

## Visual editor revision — 7 October

- Intermediate-line addition is visible without opening help. Each intermediate
  has its own ordinal and actual entered depth; new lines still start empty.
- Reference content scrolls independently of persistent Mark / Next / Preview /
  Save / Return actions. Desktop and narrow stacked layouts retain explicit modes.
- **Adjust marked points** enables dragging existing confirmed circles. A drag is
  one local draft action, committed only on release inside the crop. Escape,
  pointer cancellation/lost capture and changes of frame/tool cancel the gesture.
  This does not follow the curve or automatically publish geometry.
- **Undo last change** restores a complete local draft action (including point
  confirmation), discards obsolete previews and never writes saved geometry,
  corrections or LAS. History is bounded to 50 actions and cleared on account,
  segment or geometry revision changes and successful saves. No server history
  restoration feature is added.
- Preview has its own read-only navigation controls; original editing/navigation
  tools are hidden, but their canvas/camera remain mounted. Original / Aligned
  comparison shares a canonical camera: matched physical depth at the center and
  relative apparent track width. Uniform source display does not undo shear or
  local vertical stretch, so this is not pixel-for-pixel registration.
- Source tiles retain source detail. Aligned preview stays the existing bounded
  overview; enlarging does not invent detail. Check printed lines *between* marked
  references, since marked lines straighten by construction. Geometry preview does
  not certify scale units, trace identity or model accuracy.

New checks and captures are separate under
`validation/2026-10-07-alignment-editor/` at the workspace root. Backend/model,
earlier evidence and existing saved work are unchanged; publication still requires
separate authorization. Functional checks are not a novice-user usability study.

### Follow-up: line ordering and scroll ownership

User feedback showed a legacy draft ordered 300/1900/1000/2700/3500 FT and clipped
point-status labels. Intermediate references now move as complete depth/LEFT/RIGHT
records into numeric depth order when a valid depth is entered. The selected line
follows that move; no coordinate, confirmation or physical depth is inferred.
Duplicate, incomplete or outside-range intermediate depths remain visibly editable
but block Mark before placement. The normal flow allows one pending empty depth
at a time. Existing unsorted drafts have an explicit **Order lines by depth** repair
that is one undoable local action, not a save or a remapping of previous outputs.

The depth list no longer owns a nested scroll area. Its cards cannot flex-shrink,
and compact point-count badges stay inside the buttons. A single reference-content
scroll area sits above a compact two-column action footer. The outer inspector
does not create another scroll region for alignment in Focus view. Wheel scrolling
over the list belongs to the panel; image navigation remains separate.

Numeric ordering does not make incorrect source geometry valid. Reversed/overlapping
marked sides still block preview/save; messages identify the depth pair and edge,
with direct **Check depth** navigation. No acceptance thresholds or server geometry
validation were weakened. Current checks are in the separate workspace folder
`validation/2026-10-07-alignment-order-scroll/`.
