# WellSight — UI inventory

What the frontend has today, listed by screen and element, with no styling
details. When the new UI style arrives, each item here should be rebuilt in it.

## Auth (outside the app shell)

1. **Shared auth layout**: a decorative hero (WellSight wordmark, sauropod logo, headline, tagline) next to a form panel
2. **Login page**: email, password, error message, link to sign up
3. **Signup page**: email, full name, organization, password, confirm password, live password rule hints, link to log in

## App shell (around every signed-in page)

4. **Sidebar**
   - Brand area (sauropod logo and "WellSight")
   - Collapse/expand toggle
   - Workspace switcher grouped as Single Well (LAS Analysis, Digitize Raster), Multi-Well (Portfolio Analytics), Library (My Files)
   - Slot for the active workspace's own controls
   - Account block (avatar initial, name, email, link to account settings)
   - Sign-out button
   - Status line (spinner when collapsed)
5. **Shared sidebar building blocks**: collapsible section headers with icons, sidebar buttons, file pickers, toggles
6. **AI assistant drawer**: toggle button, resizable side drawer, chat with markdown answers

## LAS Analysis workspace (single well)

7. **Sidebar controls**: Well Input (select LAS file, Analyze Well), Export (CSV, PDF), Settings (Enable AI, Demo visuals)
8. **File validation modal** (before analysis): detected LAS version, well name, depth range, depth curve, NULL value; overrides for depth curve, NULL value and depth fix
9. **Analysis run selector / header**: current well name and file, switch between previous runs
10. **Tab bar**: Well Overview | Sequence Stratigraphy
11. **Well Overview tab**
    - AI Technical Interpretation panel
    - Well Diagnostics panel (well card: header with name and company tag, metrics)
    - Raw track plots (one per curve, with ML anomaly markers)
    - Derived plots: petrophysical response, geophysics quicklook (velocity, density, AI, reflectivity), SOM U-matrix and node hits, SOM facies track
    - Errors panel
12. **Sequence Stratigraphy tab**
    - Studio controls: well selector, confidence threshold slider, AI Autocomplete Suggestions, Reset Human Edits, status text
    - Sequence log chart with human review
    - Boundary review list (Accept, Reject, Pending, Delete) plus adding a manual boundary by depth
    - Cross-well sequence correlation chart
    - AI sequence interpretation panel

## Portfolio Analytics workspace (multi-well)

13. **Sidebar controls**: Portfolio Input (select multiple LAS files, Analyze Sample Portfolio, Analyze Portfolio, Run Portfolio Demo), Export, Settings
14. **Portfolio Summary**: metric cards (wells, avg QC, depth samples, wells with pay, avg anomaly %, density transform, transform support points)
15. **Portfolio Technical Interpretation** (AI) and Errors panel
16. **Cross-Well Analytics**: Well Ranking, Facies Similarity heatmap, Pay-Risk Matrix, Geophysics Crossplot, SOM Quality

## Digitize Raster workspace (wizard)

17. **Sidebar controls**: Raster section (loaded scan, how it turned out, New digitization), Mock Mode notice
18. **Wizard stepper**: progress bar across 6 steps; finished steps are clickable, unreached ones are not
19. **Step 1, Intake**: upload a scanned raster with a pre-flight summary (file, size, type) and confirm
20. **Step 2, Crop**
    - Preprocess panel: remove speckle, correct skew, attenuate grid, Apply, result summary (applied passes, measured skew, skipped passes)
    - Track selection: detection status chip with retry, detected-track picker buttons
    - Crop editor: pan/zoom canvas, detected-track outlines, draggable crop handles, zoom buttons
    - Scan minimap
21. **Step 3, Calibration**: track scale form and depth range form, with derived numbers (depth per pixel, total interval)
22. **Step 4, Segmentation**: model availability check, wrap-handling option (mark unrecovered / unwrap / leave), run, progress panel with a real count
23. **Step 5, Review**
    - Review canvas: scan, predicted mask, corrected curve and unrecovered bands, plus zoom controls (in, out, 1:1, fit width, whole run)
    - Scan minimap
    - Review panel: tools (Inspect, Redraw, Discard), model output figures (coverage, rows, unrecovered, suspected wraps), corrections figures (rows corrected, redrawn, discarded), undo
24. **Step 6, Export**: well header form (well, API, company, field, county, state, country, UWI), output summary (curve, interval, rows, corrections), download LAS, send to LAS Analysis, LAS preview
25. **Job unavailable** state (when a job cannot be loaded)

## My Files (history)

26. **History list**: filter (All, LAS analyses, Digitized scans), paginated rows, open a row (back to analysis or the wizard), remove from history

## Account

27. **Account settings**: Profile form (email, full name, organization, read-only role, Save) and a separate Password form (current, new, confirm, rule hints; signs you out on success)

## Shared building blocks used everywhere

28. Section panel (titled card)
29. Plot card and plot figure (Plotly wrapper) plus an empty-plot placeholder
30. Metric card
31. Button variants (primary, secondary)
32. Text field (label, hint, error) and form actions row with success and error messages
33. Skeleton loading text
34. Markdown viewer (for AI output)
35. Brand mark (sauropod logo component)
