# las-frontend — the WellSight / LASight web app

> **This repo is the frontend only.** The API lives in the sibling
> [`las-backend`](../las-backend) repo and must be running for anything here to
> work (or use [mock mode](#mock-mode)).

Two workspaces, one product:

| Workspace | Route | What it does |
|---|---|---|
| **Digitize Raster** (WellSight) | `/digitize` | Recovers a curve from a *scanned* well log and exports a CWLS 2.0 LAS file |
| **LAS Analysis** (LASight) | `/analysis` | QC, petrophysics, ML/SOM, sequence stratigraphy and AI interpretation over LAS files that are already digital |

The two connect: at the end of a digitization, **Analyze in LASight** hands the
exported LAS straight to the analysis workspace — no download and re-upload.

| Repo | Role |
|---|---|
| [`ORION`](../ORION) | The science. Synthetic generator, U-Net training, `mask → LAS` chain. |
| [`las-backend`](../las-backend) | FastAPI service. Job lifecycle, tiles, background inference, LAS assembly. |
| **`las-frontend`** (this repo) | React SPA. The wizard, the correction canvas, the analysis dashboards. |

Context: university final project (*Proyecto Final de Ingeniería*, UADE, 2026).
Status: **working locally, not deployed.**

---

## Run locally

Requires **Node 18+** and a running backend.

```bash
cd ../las-backend && uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

- Frontend: `http://127.0.0.1:5173`
- Backend API docs: `http://127.0.0.1:8000/docs`

| Env var (build-time, `frontend/.env`) | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Where the API lives |
| `VITE_DIGITIZATION_MOCK` | `false` | Run the wizard with no backend at all |

```bash
npm run build     # tsc -b && vite build  → static assets in dist/
npm test          # vitest — 125 tests, ~20 s
```

### Mock mode

```bash
# frontend/.env
VITE_DIGITIZATION_MOCK=true
```

Runs the whole six-step wizard against an in-browser stand-in
(`services/digitization-mock-gateway.ts`) — no backend, no torch, no model
checkpoint. Useful for working on the review canvas and for demoing offline.
Curves produced this way are generated in the browser; **the UI says so on every
step, and they are not digitization results.**

---

## The digitization workspace

A six-step wizard, each step a real URL under `/digitize/:jobId/…`:

**Upload** → **Select track** → **Calibrate** → **Segment** → **Review** → **Export LAS**

The job lives on the server, so those URLs mean something: refresh mid-workflow
and you land back on the step the job is actually on. `RequireJobPhase` guards
the later steps — a deep link to a step the job has not reached redirects to
where it is, rather than rendering an empty page. Browser back/forward walks the
wizard, and a job is linkable, which matters when a segmentation run takes
minutes and the reviewer wants to come back to it.

While segmentation runs, `use-digitization-job` polls `GET /jobs/{id}` every
**1.2 s** and stops the moment the phase settles.

### Three components carry the workspace

**`raster-viewport.tsx` — the correction canvas.** Thesis objective 4, and the
component the product's premise rests on: the model does not need to be perfect
*provided* correcting it is genuinely faster than digitizing by hand. It draws
the scan, then the predicted mask (toggleable), then the corrected curve, then
unrecovered depths banded in red — **in that order, deliberately**. Seeing the
mask *underneath* the curve is how grid latching becomes obvious; it is instantly
visible to the eye and completely invisible in an IoU score. Corrections are
append-only and replayed over the model's output, never applied destructively,
so undo is free, "reset to the model's output" is one click, and how much a human
had to change stays measurable.

**`cropper/track-cropper.tsx` — the crop editor.** The crop is the one input the
pipeline cannot recover from: the model trained on single GR tracks, so a
whole multi-track scan produces confident nonsense. Track edges are a few pixels
wide on a raster tens of thousands of pixels tall, which needs zoom past 1:1 —
the earlier whole-log strip offered a third of a source pixel per screen pixel.
**The crop is stored in image pixels**, so panning and zooming never disturb it.
No bitmap is produced client-side; the step submits four numbers and the backend
crops the original raster.

**`scan-minimap.tsx` — the only way to travel 55,000 rows quickly.** Shared by
both viewports. It always draws the *whole* raster, including what the crop
excludes, and marks the crop on top — in review that is the only place the
reviewer can confirm the header really was left out. It is emphatically not
where the crop is set.

### Why raw `<canvas>`, and how it stays affordable

Every other chart in the app goes through the shared Plotly wrapper, and should.
These cannot: the background is an image up to **127,000 px tall**, the overlay
needs per-row hit-testing under a dragging pointer, and both have to hold 60 fps.

The viewport holds a *depth window* and fetches **512 px level-of-detail tiles**
for it, with a one-tile prefetch ring. At 1:64 the server sends a handful of
small tiles instead of fifty full-resolution ones, which is what makes zooming
out affordable at all. The cropper and the review viewport share
`viewport-transform`, `use-pan-zoom` and `use-lod-tiles`, so zoom behaves
identically in both.

> **The coordinate trap, documented in `lod-grid.ts`.** Everything drawn on the
> canvas is **region-local** — for review that means *crop-local*, because
> segmentation runs on `image[y_top:y_bottom, x_left:x_right]`. The tile endpoint
> only ever speaks **absolute raster** coordinates. Dropping the offset between
> them renders the wrong part of the scan under a correctly placed curve: it
> looks entirely plausible and quietly invites the reviewer to correct the trace
> at the wrong depth. This is why `lod-grid`, `crop-rect` and `viewport-transform`
> are pure modules with tests rather than inline canvas math.

---

## The analysis workspace

A dashboard over already-digital LAS files that goes beyond file reading:

- Multi-well LAS ingestion, with pre-upload structural validation
  (`FileValidationModal`)
- QC + physics-aware checks
- Petrophysical screening (Vsh, Phi, Sw)
- ML anomaly detection + electrofacies clustering
- Self-Organizing Maps (SOM) for unsupervised facies topology
- Sequence stratigraphy picks, with a human review pass
- AI technical interpretation and a data-grounded chat drawer (Gemini/OpenAI in
  the backend; rule-based fallback when no key is set)
- Cross-well analytics: well ranking, facies similarity matrix, pay-risk matrix,
  SOM quality comparison
- Demo mode with one-click CSV/PDF export

**Demo flow:** open the UI → `Launch Demo Mode` → after analysis completes,
`Export PDF` or `Export CSV`.

---

## Tech stack

**React 19 + TypeScript 5.8 + Vite 6**, `react-router-dom` 7 (`createBrowserRouter`),
TanStack Query 5 for server state, Plotly for every chart except the two canvases,
`marked` + `dompurify` for AI markdown, `jspdf` + `jspdf-autotable` for the PDF
export, CSS Modules with a token file for theming. Tests are Vitest + jsdom.

All the LAS parsing and all of the science (lasio, numpy, scipy, scikit-learn)
lives in `las-backend`. This app holds **no domain computation** it does not have
to — the exceptions are the pure controllers below.

> `zustand` is in `package.json` but is **not imported anywhere in `src/`** — a
> leftover from the pre-router state model. It can be dropped.

---

## Layout

```
frontend/src/
├── app-router.tsx              route table + wizard phase guards
├── app-shell.tsx               sidebar, workspace switcher, <Outlet/>
├── app-shell-context.tsx       how a workspace publishes its sidebar panel
├── workspaces/                 one component per workspace
├── models/                     API payload types — mirror the backend schemas 1:1
├── services/                   http-client + one service per API area + the mock gateway
├── controllers/                pure logic — this is what the tests cover
├── hooks/                      state, one per concern
├── components/                 shared primitives + a folder per feature
│   └── digitization/
│       ├── cropper/            transform, LOD grid, crop rect, pan/zoom  ← pure + tested
│       ├── steps/              the six wizard steps
│       ├── raster-viewport.tsx the correction canvas
│       └── scan-minimap.tsx    whole-scan navigation strip
└── styles/                     tokens.css + base.css
```

`components/sidebar.tsx` is a shell: each workspace contributes its own control
panel through a portal, so adding a workspace does not touch shared chrome.

`models/digitization-models.ts` mirrors `app/services/digitization/models.py`
field for field. **When one changes the other has to** — keeping them in
one-to-one correspondence is what makes that obvious in review.

### Tests

```bash
cd frontend && npm test
```

**125 tests across 8 files, ~20 s.** They sit almost entirely on the pure
modules, by design — those hold the logic that decides what ends up in an
exported LAS, and they run without a DOM:

| Suite | Tests | What it pins |
|---|---|---|
| `digitization-job-controller` | 31 | phase transitions, guard decisions, wizard step derivation |
| `calibration-controller` | 24 | px ↔ depth/value, linear and log, tick generation |
| `curve-edit-controller` | 24 | append-only edit replay, undo, gap computation |
| `cropper/lod-grid` | 13 | which tiles, at which level, in which coordinate space |
| `cropper/crop-rect` | 13 | handle hit-testing, resize, normalize, clamp |
| `cropper/viewport-transform` | 12 | screen ↔ image, zoom anchoring, visible rect |
| `digitization-service` | 4 | request shapes and error mapping |
| `format-controller` | 4 | display formatting |

The canvas components themselves are not unit-tested — they are verified by eye,
which is appropriate for the thing whose whole job is to be looked at.

---

## Deployment profile

*Written for infrastructure design work.*

**This is a pure static SPA.** `npm run build` emits `dist/` — HTML, JS, CSS,
one SVG favicon. No SSR, no Node runtime, no server-side rendering step, no
API routes. It can go on any static host or CDN (Vercel / Netlify / Cloudflare
Pages / S3+CloudFront) at essentially zero cost.

Four things that must be true wherever it is hosted:

1. **SPA fallback rewriting is mandatory.** `createBrowserRouter` uses real
   paths, and the wizard's deep links (`/digitize/:jobId/review`) are the whole
   point of the design. Any host must rewrite unknown paths to `index.html`, or
   a refresh mid-workflow 404s and the main UX claim of the wizard breaks.
2. **`VITE_*` variables are baked in at build time**, not read at runtime. A
   different API base URL means a **different build**. If runtime configuration
   is wanted, that is a change to the app (fetch a `config.json` at boot), not a
   deployment setting.
3. **The backend's CORS allow-list is hard-coded to localhost origins.** The
   deployed frontend origin has to be added there before anything works
   cross-origin. `Content-Disposition` is already in `expose_headers` so the LAS
   download keeps its filename.
4. **No secrets live in this repo.** `frontend/.env` holds only the API base URL
   and the mock flag; AI provider keys are configured in `las-backend`. Anything
   shipped in a Vite build is public by construction.

**Traffic shape.** The analysis workspace is a handful of JSON requests. The
digitization workspace is not: panning or zooming a scan issues a burst of
`GET /tile` requests (512 px tiles + a one-tile prefetch ring), and segmentation
polls `GET /jobs/{id}` every 1.2 s for minutes. Tiles are served
`Cache-Control: private, max-age=3600` and are immutable per (job, region,
layer) — they are the obvious thing to put a CDN or reverse-proxy cache in front
of. The poll is not cacheable.

**Bundle note.** Plotly plus jsPDF is a heavy bundle and nothing is code-split
today; the digitization workspace pays for the analysis workspace's charting
library on first load. Route-level lazy loading is the cheap fix if load time
becomes a concern.

**Repo weight.** `LAS Files/` is **18 MB** of tracked LAS fixtures (including a
deliberately corrupt set the backend's validator tests read). It is test data
that ships with the clone, not application data.

---

## Repo contents outside `frontend/`

| Path | What it is |
|---|---|
| `LAS Files/` | LAS fixtures for import-validation testing, incl. `Test LAS files - corrupt/` — consumed by `las-backend/tests/test_validator.py` |
| `PROJECT_DETAILED_PROMPT.md`, `frontend-instructions.md` | Early design/spec prompts, historical |
| `# LAS File Import Verification Requireme.md` | Import-validation requirements notes |

---

## Notes and known gaps

- Current petrophysical equations are **screening-grade defaults**; calibration
  with field/core data is required before operational use.
- AI interpretation is Gemini-first with OpenAI as optional fallback, and falls
  back to a rule-based summary when neither key is set — configured in
  `las-backend`.
- There is **no auth and no user/session model** anywhere in the product.
- Analyses and jobs live in the backend's memory and are lost on restart; the UI
  surfaces the resulting `404` rather than pretending otherwise.

**Suggested next iterations:** lithology/facies labels with supervised models;
depth alignment and cross-well normalization; auth + persisted project history;
DLIS/CSV/core-data ingestion.
