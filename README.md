# WellSight — web app

> **Note.** The backend moved to the sibling `las-backend` repo. The `app/`
> directory here is a stale copy kept only as a fallback; the React app under
> `frontend/` is the live UI.

Two workspaces, one product:

| Workspace | Route | What it does |
|---|---|---|
| **LAS Analysis** (LASight) | `/analysis` | QC, petrophysics, ML/SOM, sequence stratigraphy and AI interpretation over LAS files that are already digital |
| **Digitize Raster** (WellSight) | `/digitize` | Recovers a curve from a *scanned* well log and exports a CWLS 2.0 LAS file |

The two connect: at the end of a digitization the **Analyze in LASight** button
hands the exported LAS straight to the analysis workspace, no download and
re-upload.

---

## The digitization workspace

A six-step wizard, each step a real URL under `/digitize/:jobId/…`:

**Select track** → **Calibrate** → **Segment** → **Review** → **Export LAS**

The job lives on the server, so those URLs mean something: refresh mid-workflow
and you land back on the step the job is actually on. A deep link to a step the
job has not reached redirects to where it is, rather than rendering an empty page.

**The review canvas is the point.** WellSight's premise is that the model does
not need to be perfect because a specialist corrects it — so the correction flow
is what decides whether the approach is viable. The canvas draws the recovered
trace over the original scan, with the predicted mask toggleable underneath
(overlaying it is how grid latching becomes visible; it is obvious to the eye and
invisible in any accuracy score) and unrecovered depths banded in red.
Corrections are append-only and replayed over the model's output, never applied
destructively, so undo is free, "reset to the model's output" is always one
click, and how much a human had to change stays measurable.

It is a raw `<canvas>` rather than the shared Plotly wrapper every other chart
uses. Real scans run 30,000–127,000 px tall; the viewport holds a *depth window*
and fetches tiles for it, which is the only way that is scrollable in a browser.

### Mock mode

```bash
# frontend/.env
VITE_DIGITIZATION_MOCK=true
```

Runs the whole wizard against an in-browser stand-in — no backend, no torch, no
model checkpoint. Useful for working on the review canvas and for demoing
offline. Curves produced this way are generated in the browser; the UI says so
on every step, and they are not digitization results.

---

## LAS analysis

A localhost web app for oil & gas LAS analysis that goes beyond file reading:
- Multi-well LAS ingestion
- QC + physics-aware checks
- Petrophysical screening (Vsh, Phi, Sw)
- ML anomaly detection + electrofacies clustering
- Self-Organizing Maps (SOM) for unsupervised facies topology mapping
- AI technical interpretation (OpenAI optional; heuristic fallback included)
- Cross-well comparison analytics:
  - Well ranking
  - Facies similarity matrix
  - Pay-risk matrix
  - SOM quality comparison
- Demo mode for showcases with one-click CSV/PDF export

## Tech Stack
- Backend API: FastAPI (Python)
- Data/Science: lasio, pandas, numpy, scipy, scikit-learn
- Frontend (modern): React + TypeScript + Vite + TanStack Query + Zustand + Plotly

## Project Structure
- `app/main.py`: FastAPI app and API routes
- `app/services/las_parser.py`: LAS parsing + curve mapping
- `app/services/qc.py`: data quality and physics sanity checks
- `app/services/petrophysics.py`: Vsh/Phi/Sw and potential pay intervals
- `app/services/ml.py`: anomaly detection + electrofacies clustering
- `app/services/sequence.py`: sequence stratigraphy auto-picks + correlation
- `app/services/ai.py`: AI interpretation (with fallback)
- `app/services/analyzer.py`: orchestration and portfolio summary
- `frontend/`: React TypeScript frontend
- `app/static/`: legacy static frontend (kept for fallback)
- `LAS_Sample_API/`: provided sample LAS files

## Run Locally (Modern Frontend)
1. Create and activate a virtual environment.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Optional: enable AI interpretation with API key:
   ```bash
   cp .env.example .env
   # set GEMINI_API_KEY in .env (preferred)
   ```
4. Start backend API:
   ```bash
   uvicorn app.main:app --reload
   ```
5. In a second terminal, start frontend:
   ```bash
   cd frontend
   npm install
   cp .env.example .env
   npm run dev
   ```
6. Open:
   - Frontend: `http://127.0.0.1:5173`
   - Backend API docs: `http://127.0.0.1:8000/docs`

## Run Locally (Legacy Fallback)
If needed, legacy static UI is still available:
```bash
./run_local.sh
```
Then open `http://127.0.0.1:8000`.

## Demo Flow
1. Open the web UI.
2. Click `Launch Demo Mode`.
3. After analysis completes, click:
   - `Export PDF` for committee/company presentation output.
   - `Export CSV` for data-driven follow-up.

## Endpoints
See `las-backend/README.md` for the full list. The analysis workspace uses
`/api/health`, `/api/analyze-samples`, `/api/analyze-files`, `/api/pre-validate`,
`/api/analyses/{id}`, `/api/ai-interpretation` and `/api/chat-data`; the
digitization workspace uses `/api/digitization/*`.

## Frontend layout
```
frontend/src/
├── app-router.tsx              route table + wizard guards
├── app-shell.tsx               sidebar, workspace switcher, <Outlet/>
├── app-shell-context.tsx       how a workspace publishes its sidebar panel
├── workspaces/                 one component per workspace
├── models/                     API payload types (mirror the backend schemas)
├── services/                   http-client + one service per API area
├── controllers/                pure logic — this is what the tests cover
├── hooks/                      state, one per concern
└── components/                 shared primitives + a folder per feature
```

`components/sidebar.tsx` is a shell: each workspace contributes its own control
panel through a portal, so adding a workspace does not touch shared chrome.
The pure controllers (`calibration-`, `curve-edit-`, `digitization-job-`) hold
the logic that decides what ends up in an exported LAS, which is why they live
outside React and carry the tests.

```bash
cd frontend && npm test     # 83 tests, no DOM needed for the controllers
```

## Notes
- ChatGPT Plus does not include API credits automatically. API usage is separate billing.
- AI interpretation is Gemini-first (`GEMINI_API_KEY`, model default `gemini-2.5-pro`), with OpenAI as optional fallback.
- Current petrophysical equations are screening-grade defaults; calibration with field/core data is required before operational use.

## GitHub Upload Safety
1. Keep real API keys only in local `.env` (already ignored by `.gitignore`).
2. Use `.env.example` for placeholders only.
3. Before pushing, verify:
   ```bash
   git status
   git check-ignore -v .env .venv
   ```
4. If a secret was ever committed, rotate the key immediately and purge it from git history before publishing.

## Suggested Next Iterations
1. Add lithology/facies labels and supervised ML models.
2. Add depth alignment and cross-well normalization workflow.
3. Add user auth/workspace management and persisted project history.
4. Add DLIS/CSV/core-data ingestion and cross-domain joins.
