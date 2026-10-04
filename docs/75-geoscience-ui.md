# Geoscience workstation — visual review candidate

## Scope and review status

**Final review addendum:** the candidate now lives on `feat/75-delivery-review`.
The chronology below records earlier iterations; old statements about no commits,
test counts, asset versions and worktree scope apply to those iterations only.
Use [final review](75-code-review.md) and [prepared PR](75-final-pr.md) for the
current source status, security/draft compatibility and validation. Visual
approval is still the user's decision; the older screenshot gallery is not
regenerated or relabelled as the final-build evidence.

This is the first frontend-only candidate on `feat/75-geoscience-ui`, based on
`origin/feat/75-unified-digitization` at
`c8855dcfbf881276e0acf1c144e624152bad7cea`. It is not an approved design, a
SiteCom-equivalent product, or evidence of scientific accuracy. No new commits
or pushes have been made. The old worktrees, backend, ORION and PFI validation
files are outside this task.

The design borrows workstation density and hierarchy, not SiteCom features:
charcoal neutral chrome, a narrow expandable navigation rail, compact segment
rows, saved mnemonic/unit/scale headings, the original white raster, and a
collapsible inspector. No fake rigs, geological markers, lithology, correlation,
confidence, well metadata or model capability were added.

## What changed

- Shared colour, font, surface and focus tokens; dark chart background and
  contrasting curve colours for existing Plotly tracks. No chart dependency.
- English application labels, confirmations, procedural segment names and
  error messages. Existing recorded source labels, dataset names and units are
  not translated or renamed.
- Crop/calibration/review retain a single document and segment-specific source
  focus. The inspector can collapse without discarding draft inputs or canvas.
  Track headings show **saved** calibration, not an uncommitted input draft.
- Prediction: blue, 2.75 CSS-pixel stroke, 4.75 CSS-pixel opaque white
  under-stroke against the native black/white scan. No glow or raster inversion.
  Width is screen-space; the canvas applies DPR before rendering.
- Redrawn rows: orange, derived from the real append-only correction sequence.
  Model mask and NULL/discard bands retain their own legend semantics. Recovered
  row percentage is explicitly not confidence, accuracy or trace identity.
- Raster and joint SVG traces retain every finite source row. NULL/non-finite
  rows always break paths, including a single-row dropout at distant zoom. No
  smoothing, resampling of predictions, inferred continuity or modified values.
  SVG joint track has a labelled **linear value axis**, including when source
  calibration used a logarithmic pixel scale. It is a display, not assembled LAS.
- Searchable curve/mnemonic and value-unit fields support Gamma ray, density,
  neutron, sonic, caliper, SP and specific resistivity mnemonic suggestions.
  Keyboard selection, readable labels and exact custom entry are supported.
  Selecting a mnemonic never silently changes the recorded alias, selected
  value unit, scale type, bounds or depths. Suggested units require verification.
- **Use curve identity** explicitly confirms copying mnemonic, value unit and
  depth unit from another saved segment into the current draft. It copies no
  crop, scale type/bounds or depth anchors and does not save automatically.
  **Copy scale to draft** remains a separate confirmed action that never copies
  depth values or the depth unit. A persistent curve-level metadata resource is
  not implemented; existing backend contracts remain unchanged.

## Preserved safeguards

One document, one curve workspace and one combined LAS/analysis output remain
the workflow. Member output routes still redirect to the joint result. Saved
crop/calibration draft isolation, explicit prediction reset, sequential
processing, READY prediction preservation, retry, correction autosave/revision
checks, manual overlap choices, compatible mnemonic/units and analysis identity
are retained and covered by the existing tests. No new backend API or physical
data defaults were introduced.

Common selectors retain their IDs: `#process-curve`, `#save-segment-crop`,
`#save-segment-calibration`, `#focus-segment-start`, `#add-curve-segment` and
`#select-segment-<jobId>`. English labels are **Process curve**, **Confirm crop**,
**Save calibration**, **Segment start**, **Analyze curve**, **Download LAS**.
New controls: `#use-curve-identity`, `#cal-mnemonic`, `#cal-value-unit`; inspector
buttons have **Collapse inspector** / **Expand inspector** accessible names.

## Verification

At the initial visual iteration (before the interaction feedback below):
**292 tests in 32 files passed**. `npm run build` succeeded,
including TypeScript checking. Tests preserve the previous 273 checks and add
metadata/custom input, identity confirmation/independent anchors, inspector
collapse, saved readouts, NULL continuity and overlay style checks. Canvas mocks
verify presentation instructions, not measured physical fidelity or accuracy.

Dependencies installed with `npm ci` only in this new frontend. No dependency
or lockfile changes. The inherited audit reports 20 vulnerabilities (4 critical).
No force update/audit fix performed. The existing large-bundle warning remains.

Run from this worktree's `frontend` directory:

```sh
npm test -- --run --root /private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-geoscience-fe-qa-20261004
./node_modules/.bin/tsc --noEmit --incremental false
npm run build
```

That unique alias points only to this new frontend. The literal `%` in the
checkout path causes Vite/Vitest URI decoding issues. Tests work with the
explicit safe alias. Vite dev can still emit malformed `/@fs/` React refresh
URLs even with that alias; use newly compiled assets for this visual review:

```sh
VITE_API_BASE_URL='' npm run build
WELLSIGHT_DEV_API_PROXY=http://127.0.0.1:8003 npm run preview -- --port 5177 --strictPort
```

An explicitly empty API base means same-origin `/api`. The opt-in Vite proxy
forwards it to the isolated local API; CORS/security and authentication are not
changed. The API base still defaults to port 8000 when unspecified. Do not copy
credentials or production tokens into env files. Never stop the old 5176/8003
servers or build the old checkout. Normal application operation can write data;
use the capture runner below for **read-only** visual review of existing data.

## Visual capture and next review

`frontend/scripts/geoscience-preview.mjs` uses Node 22 WebSocket/CDP and an
isolated headless local Chrome (no new library). It accepts `QA_EMAIL` and
`QA_PASSWORD` from the environment, authenticates once, finds an existing
processed multi-segment Shutts curve (or uses `QA_COLLECTION_ID`), freezes GET
responses in memory and blocks all data writes. Browser storage is volatile.
It saves no JWT, credentials, auth dump or trace. Output is restricted to this
frontend repo's `docs/geoscience-preview/`, with an explicit read-only/not
scientific-validation notice. It does not create or correct backend records.

```sh
# Set QA_EMAIL and QA_PASSWORD in the terminal environment; never put them in a file.
node scripts/geoscience-preview.mjs
```

Orca's GUI capture CLI is unavailable in this environment:
`Unable to determine Orca.app path from symlink: /usr/local/bin/orca`.
Nine headless captures succeeded against the existing local Shutts curve:
MAIN and REPEAT crop starts, calibration, each review overlay, the joint result,
collapsed inspector, metadata options and DPR 2. No data writes were attempted
and the browser reported no errors. At DPR 2 the canvas has 1912 backing-store
pixels for 956 CSS pixels. Existing stored MAIN corrections
are rendered as-is (including an orange redraw); they are not endorsed as
physically correct by this interface work. The review gallery is
[`geoscience-preview/index.html`](geoscience-preview/index.html), with raw images
and a non-auth capture manifest alongside it. The runner additionally captures
metadata options, collapsed inspector and DPR 2 rendering.

Headless captures are visual evidence only. Principal-owned
interactive QA, scientific/source comparison and external HTML reports remain
separate. Before approving wider redesign, review real MAIN/REPEAT raster and
curve contrast, numeric labels, collapsed/expanded inspector, custom metadata,
keyboard focus, zoom/DPR and small-screen layout. Validate actual edit/autosave,
queue/retry, explicit overlap and joint outputs in principal-owned dedicated
test records; do not infer them from screenshots.

## Interaction feedback — overlay, navigation and focus view

These changes are source-only pending the principal's coordinated rebuild and
restart of the new 5177 preview. **No build, new screenshots, live browser
automation or backend writes were performed for this feedback pass.** The
existing gallery remains evidence of the earlier assets, not these controls.
No shell, sidebar, portfolio/comparison, backend, ORION or PFI files were edited
in this pass. All previous uncommitted work is retained; no commit or push.

### Prediction display

Unified and legacy review now have **Show prediction** and **Prediction opacity**
(0–100%). Both the blue line and white under-stroke fade; at 0%/hidden neither is
drawn. Orange manual redraws remain visible independently. **Show model mask**
is a separate control and unchanged in meaning. The prediction toggle applies
to the unedited prediction portions of the corrected series, not a reconstructed
raw prediction beneath corrected rows. No prediction/correction arrays, NULL
intervals, calibration or autosave revision data are changed by these controls.

Preferences are local to the mounted review viewer and survive focus view and
inspector changes. They are not backend fields, cookies, LAS metadata or physical
data edits; remounting/changing segment may reset presentation defaults. Existing
undo, reset, review edits, autosave and export semantics remain intact.

Selectors: `[aria-label="Prediction display"]`, checkbox label **Show prediction**,
range `[aria-label="Prediction opacity"]` (min 0, max 100). The legend reports
hidden/percentage state. The slider remains usable while visibility is off.

### Safe canvas navigation

Crop view defaults to **Navigate** (`#crop-mode-navigate`). It ignores all crop
handles and layout proposals. **Select / Crop** (`#crop-mode-select`) explicitly
enables resizing/moving the current crop and proposal adoption. Adoption occurs
only on pointer-up within a 5 CSS-pixel click threshold; movement beyond that
threshold permanently turns that gesture into pan, even if it returns to the
start. Pointer-down, pan, cancellation and Escape never adopt a proposal.

- Plain wheel/trackpad scroll travels through the tall raster, not zoom.
- Shift + wheel travels horizontally; horizontal trackpad deltas also work.
- Ctrl/Cmd + wheel and trackpad pinch zoom at the pointer.
- Middle-mouse drag and Space + drag bypass both proposals and handles in any
  crop mode, and temporarily pan while Redraw/Mark missing is selected in review.
- Space ignores focused inputs, textareas, selects, editable content and sliders.
  Hover may arm temporary pan; page Space scrolling is prevented only when the
  canvas/its handle has keyboard focus.
- Double-click zooms only in crop Navigate mode.
- Crop edges are keyboard-focusable only in Select / Crop. Arrow keys nudge one
  source pixel; Shift + arrows nudge 25. Saving/processing locks crop editing,
  not navigation.
- Pointer cancel/lost capture/Escape release the active gesture without proposal
  adoption or committing a review stroke. Escape ends a crop gesture at its
  current draft bounds; it does not discard the input draft.

Review buttons use icons **with text**: **Pan / Inspect**, **Redraw**, and
**Mark missing**. Mark missing writes only an explicit depth interval as NULL;
it does not erase the TIFF. No brush/bucket/magnetic selection or straight-line
interpolation tool was added. A two-point line tool would need a separately
reviewed rule for missing regions and physical intent, rather than silently
bridging them.

Canvas selectors: `[aria-label="Source crop canvas"]` and
`canvas[aria-label="Curve review canvas"]`. Crop mode is also exposed as
`data-interaction-mode="navigate|select"` on the source stage.

### Focus view

**Focus view / Exit focus view** (`#curve-focus-view`) applies a fixed, full-window
CSS overlay to the existing unified workspace. It is not browser Fullscreen API
and requires no permission. Global navigation is covered and the segment rail
is visually hidden, while selected document, tools, real processing states,
errors and the inspector remain available. The header segment selector
`#focus-view-segment` preserves explicit member navigation.

The same editor/canvas nodes, query state and draft store stay mounted. Entering
or exiting does not reset the selected segment, input draft, viewer opacity or
in-progress stroke. Resize only re-clamps the camera and preserves chosen zoom;
image-edge constraints may necessarily shift translation. The inspector remains
collapsible. Focus stays inside the overlay; exit restores focus to the toggle
and restores prior body overflow without overwriting a subsequently changed
overflow value.

Escape first cancels an active canvas gesture; otherwise it exits focus view.
Input/combobox editing retains its own Escape behavior and never discards drafts.
Use the always-visible exit button when a field has focus. Focus mode survives
local workspace tabs, but navigation to another document/workspace unmounts it.
Legacy independent-job review gets the same display controls/gestures but no
new workspace focus overlay. Shell-wide focus integration is deliberately left
to the principal; no global shell or portfolio focus state was introduced.

### Feedback verification

New tests cover context save/restore and prediction-only alpha; manual redraw
visibility at hidden/0%; unchanged arrays and NULL breaks; real pointer and
wheel events with the actual pan/zoom hook; proposal click-vs-drag/cancel; middle
mouse/Space/typing guards; keyboard nudges and resize zoom preservation; same
canvas and pending stroke across layout/opacity changes; explicit missing ranges;
and unified focus/draft/preference/segment/keyboard preservation. These are UI
and rendering-contract tests, not scientific or live-browser validation.

The coordinated final verification passed **356 tests in 37 files**, retaining
the 292-test baseline and adding 34 digitization and 30 comparison/workflow tests.
The comparison fixture's temporary type error was corrected by its owner.
Typechecking and the compiled production build pass. Tests require the safe
`--root` alias above; running directly in the literal `%` path still causes the
known URI decoding failure before test collection.

The principal rebuilt and restarted the compiled 5177 preview after both workers
finished. Dedicated-account real-browser checks of crop navigation, Space pan,
prediction opacity/visibility, focus view and real two-LAS comparison passed with
no browser errors. Snapshots confirm that presentation/navigation left saved
crop, calibration, prediction and edits unchanged. A separate initially unedited
QA fixture passed real redraw autosave with prediction hidden, member/focus/reload
preservation, explicit overlap selection, one joint LAS and explicit joint
analysis/reload. No changes leaked to its other segment. Evidence is maintained in
`validation/2026-10-04-frontend-interactions/` at the delivery workspace root.
These checks do not demonstrate scientific accuracy or specialist usability.
