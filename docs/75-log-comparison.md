# Manual well-log comparison

## Open the feature

1. Select **Compare wells** in the multi-well navigation (`/portfolio`).
2. The default **Well logs** tab opens the side-by-side view. **Analytics** retains the existing portfolio summaries and cross-well analytics.
3. Select **Choose LAS files**, choose at least two files, and select **Prepare comparison**. Review the existing **File Validation** dialog and confirm the files that may proceed. Validation is not bypassed.
4. Alternatively, choose a **Saved portfolio**. Only saved LAS analyses with at least two files and a non-failed state appear in this selector. **My Files** remains available for the broader library.

The main file picker and sidebar share the same `useAnalysis` file state and validation pipeline. Selected filenames and failure status remain visible when validation or loading fails. The analysis ID remains in `?analysis=<id>` on upload, saved selection, tab changes and reload; `?view=analytics` or `?view=logs` preserves the selected tab. Other query parameters are retained. An adoption guard prevents the same ID being fetched again during a tab change or URL update after an upload. Existing analysis/AI behavior is otherwise preserved.

## Inspect the logs

- Select up to **four source files**. Initial selection is the first four files. Index plus analysis identity, not well name, identifies columns; filenames distinguish duplicate well names. A saved single-file analysis displays only one file and explicitly explains that it is not a multi-well comparison.
- Choose a **Curve** from the union of available raw series, with GR selected initially when available. Custom raw keys are included. Mnemonic aliases and recorded units are shown per column. A missing curve leaves that column empty rather than substituting another signal.
- **Link depth** is available only if all selected files have known compatible recorded FT or M depth units. Label aliases such as FEET/F normalize to FT, without converting numerical depths. Unknown units, mixed feet/metres and other depth units force independent axes and a warning. No depth unit is inferred from magnitudes.
- **Share value scale** requires known matching recorded curve units. API and GAPI are not assumed equivalent. Otherwise each column uses its own full finite source-value extent. Values are never normalized to 0–1.
- **Linear** and **Logarithmic** are explicit display modes. Nonpositive values are hidden and counted only in log display; their source values are unchanged. Constant positive curves receive a finite log-axis range.
- With linked axes, use **From**, **To**, **Apply depth range**, **Zoom in**, **Zoom out** and **Reset depth**. Drag vertically to pan; Plotly's toolbar also permits box zoom. Unlinked columns can be panned/zoomed individually. Wheel zoom is disabled to keep ordinary page scrolling available.
- Hovering a linked track draws a shared horizontal reported-depth cursor without changing the Plotly layout or resetting zoom. No shared cursor is displayed for independent axes.

The chart uses full `tracks.depth` and `tracks.raw` arrays, retains every paired source row, and uses `connectgaps: false` with line simplification disabled. NULL/nonfinite pairs break the line. Non-increasing depth inserts a break and displays a warning without sorting source rows. Axis extents use full finite source ranges, not quantiles that clip spikes. No client-side smoothing, extrapolation or model execution is added.

## Scope and limitations

This is **reported-depth visual inspection, not stratigraphic correlation**. The API does not provide a verified depth datum, MD/TVD relationship, formation-marker resource or lithology model for this feature. There are no formation connectors, automatic matching, unit conversions, datum adjustments or claims of scientific accuracy/SiteCom parity. Equal numerical depths do not establish equivalent formations.

The first version shows **one chosen curve family per well**, not multiple tracks per well. The four-column limit controls the cost of rendering full series; more files remain selectable by deselecting an existing column. Horizontal scrolling maintains a minimum 270 px per selected column. Selections and plot ranges are local view state; saved analysis identity and the view tab persist in the URL, not these plot controls.

## Implementation and checks

- `frontend/src/components/comparison/well-log-comparison.tsx` and its CSS module: controls, headers and native Plotly subplots.
- `frontend/src/controllers/log-comparison-controller.ts`: unit compatibility, raw series with breaks, full ranges and available curve keys.
- `frontend/src/workspaces/portfolio-workspace.tsx` and its CSS module: default log tab, existing analytics tab, upload/validation workflow, saved selection and persistent URL adoption.
- `frontend/src/components/sidebar.tsx`: one renamed `/portfolio` entry, **Compare wells**.
- `frontend/src/hooks/use-analysis.ts`: presentation-only reference to the renamed navigation entry; analysis logic is unchanged.

Focused tests cover unit compatibility, source preservation, NULL breaks, curve selection/missing data, log filtering, full ranges, four-column limits, independent axes, cursor behavior, viewport controls, reload adoption, tab query retention and the real analysis/validation hooks with mocked HTTP responses. These are software behavior tests, not scientific validation or browser evidence. Real-browser interaction evidence is maintained separately by the coordinating agent.

Useful QA selectors:

| Purpose | Selector / accessible name |
| --- | --- |
| Route | `/portfolio?analysis=<id>&view=logs` |
| File input | `input[aria-label="Choose LAS files"]` |
| Prepare upload | button **Prepare comparison** |
| Selected filenames | `[aria-label="Chosen LAS files"]` |
| Saved portfolio | `select[aria-label="Saved portfolio"]` |
| Tabs | role `tab`, **Well logs** / **Analytics** |
| Curve | `select[aria-label="Comparison curve"]` |
| Value display mode | `select[aria-label="Value scale"]` |
| File selections | `[aria-label="Well log comparison"] fieldset input` |
| Depth mode | checkbox **Link depth** |
| Value scale sharing | checkbox **Share value scale** |
| Range inputs | `input[aria-label="Depth from"]`, `input[aria-label="Depth to"]` |
| Reset viewport | button **Reset depth** |

No backend/API files, user data, gallery images, production build output or commits are required by this implementation.

## Coordinated live acceptance

After implementation, the coordinating agent rebuilt the new preview on 5177
and tested it in an isolated browser/dedicated QA account. Actual two-file LAS
validation/upload (RHONDA #1 and MRM #3), complete raw-series rendering with NULL
breaks, compatible FT linkage, explicit range/log/link controls, Analytics tab
retention and saved analysis reload all passed without browser runtime errors.
Those LAS headers show 2019: the test is modern-log comparison, not historical
model generalization. Full frontend verification passed 356 tests / 37 files,
typecheck and build. The existing large-bundle warning remains.

The delivery-root offline report is
`validation/2026-10-04-frontend-interactions/index.html`; its evidence is separate
from the original nine-image read-only visual proposal. The user's original
account/curve was not edited. The compiled new preview is now live; this section
does not claim acceptance of the visual design by the user.
