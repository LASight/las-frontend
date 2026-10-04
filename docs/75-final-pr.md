# Prepared PR: unified geoscience digitization workstation

**Base:** `dev`

**Head:** `feat/75-delivery-review`

**Suggested title:** `Deliver unified multi-segment workstation, comparison and review safety`

## Scope

- All published reliability → multi-segment → unified increments.
- Compact English workstation, original white TIFF, readable prediction/redraw
  overlays, explicit crop editing/navigation, opacity/toggle, stable Focus view.
- Searchable/custom metadata without invented scales, units or depth anchors.
- Compare wells: up to four LAS files, complete series/NULL breaks and explicit
  compatible-unit linking; portfolio Analytics retained.
- Safe segment removal: confirmation, flush/locks, at least one retained member;
  underlying files/job work remain available, previous outputs unchanged.
- Selective original branding, accessible shared BrandMark and favicon; no old
  login hero, misleading copy, admin-job UI or discarded recent functionality.
- Race/privacy repairs: cold processing cache, latest analysis/AI, rename/removal,
  per-account draft/cache isolation and bounded durable gestures.
- Generated-cache hygiene and current entry-point/configuration documentation.

The complete head already contains all earlier published increment commits.
Keep those branches for traceability rather than merging them as separate PRs.
Companion backend: `las-backend/feat/75-delivery-review` → `dev`.
PFI is explicitly excluded; ORION is unchanged and synchronized with its `dev`.

## Validate / review

From `frontend`: `npm ci`, `npm test -- --run`, `npm run build`.
Use a safe-path alias with `--root` if the checkout's literal `%` triggers the
existing Vite/Vitest resolver issue. Review runs use compiled assets, not dev.
See [quality findings](75-code-review.md), [UI](75-geoscience-ui.md),
[comparison](75-log-comparison.md), [removal](75-remove-segment.md) and
[branding provenance](75-brand-import.md).

Source validation: **406 tests / 41 files passed**, no-emit TypeScript, production
build and diff check. Paired candidate browser QA: **7 checks passed, zero runtime
errors**, on isolated preview 5178 / API 8004 / new PostgreSQL 55436. Real upload,
manual source-verified crops/calibration, two model runs, cold-load completion,
bounded durable redraw, focus removal, explicit overlap/joined LAS/analysis,
two-LAS comparison and same-tab cross-account denial were exercised. QA accounts
and edits are dedicated; no prior application data was modified. Earlier captures
are explicitly labelled by their original iteration.

## Review gates / not in scope

- **Do not deploy as production-security-approved:** inherited npm audit has
  20 vulnerabilities, including 4 critical; dependency remediation is separate.
- Final visual acceptance remains with the reviewer; tests do not replace it.
- No invented accuracy, confidence, participant feedback, trace identity, real
  consecutive-page stitching or geological correlation claims.
- Old unscoped local drafts are retained; recovery requires confirmation and fresh
  authorized access. Invalid/missing-revision drafts are not silently adopted.
- No new dependencies/model training, automatic interpolation/overlap averaging,
  permanent source deletion, merges into `dev`/`main`, or PFI changes.
