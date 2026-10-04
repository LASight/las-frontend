# Final code review and PR preparation

Target: `feat/75-delivery-review` → `dev`. The head includes reliability,
multi-segment, unified workspace and the complete workstation candidate. Earlier
branches remain provenance; no stacked merges, rebase or force-push is necessary.

## Assessment of good practices

Useful boundaries already exist: pure numeric/edit/overlap/comparison controllers,
HTTP gateway services, stateful React hooks and workspace/view components. Their
contracts isolate ownership, revisions, NULL behavior and presentation. Explicit
overlap decisions, no inferred unit conversion, serialized autosave and stable
focus mounting are sound design choices. This is practical cohesion, low coupling
and information-expert placement, not a formal SOLID/GRASP certification.

Some workspace components remain large, and several existing styles/JSX sections
are dense. Focused future extraction by cohesive responsibility is preferable to
generic class hierarchies, command buses or interfaces around every React callback.
The review repairs actual concurrency/privacy/data-integrity problems rather than
performing a broad architecture or formatting rewrite.

## Findings addressed

| Risk | Remedy | Regression mechanism |
|---|---|---|
| Cold-loaded processing completes but the selected editor remains stale | Authoritative collection polling synchronizes job caches and cancels obsolete individual reads | Processing-to-review without Resume/remount; independent drafts survive |
| Earlier analysis/AI response overwrites the latest selection or its URL | Generation, mounted and session guards; adoption is visibly busy; disabling AI invalidates pending interpretation | Deliberately out-of-order payload and interpretation responses |
| Rename can race removal and restore stale membership | Rename participates in structural-operation locking; open forms honor locks; rename responses do not replace the member list | Deferred rename response and removal/membership checks |
| Same-tab account switching discloses cached traces/drafts | New QueryClient per session; account-scoped persisted keys; stale HTTP/autosave/retry publication rejected | Same-tab A→B, old delayed requests, account-specific stores and A re-entry |
| Gestures across crop padding persist invalid rows | Bound corrections at the controller/persistence boundary and viewport; padding-only gestures do nothing | Crossing top/bottom, clipping/interpolation, Undo and durable reload |

### Draft compatibility and privacy

Old unscoped draft keys are **not deleted or silently assigned to the next
account**. Recovery is an explicit user action requiring a fresh authorized read
of the exact job/collection and valid data. It never overwrites an account-scoped
draft. Legacy corrections without a valid revision remain stored but are not
automatically adopted. This prevents importing someone else's cached work merely
because a local filename/key exists. Keep browser storage if recovery is needed.

This does not make localStorage a hardened secret store; refresh-token storage
and other production session protections remain explicit security follow-ups.

## Packaging / reproducibility

- Generated TypeScript build cache removed from version control; local file is
  retained and future `*.tsbuildinfo` is ignored.
- Default ports remain dev 5173/preview 4173; review ports are explicit CLI args.
  Same-origin API proxy is opt-in, loopback-bound and does not change CORS/auth.
- README describes `/digitize/curves/:collectionId`, explicit joint analysis,
  Compare wells and the retained legacy wizard.
- No package or lockfile changes: both match `origin/dev` byte-for-byte.
- SVG/logo import provenance and accessible presentation are recorded separately
  in [branding](75-brand-import.md); no executable/external SVG content is added.

## Validation and limitations

Post-fix source tests: **406 tests / 41 files passed**, TypeScript no-emit and diff
checks passed. Production build succeeded with the inherited large-chunk warning.
Paired browser acceptance: **7 checks passed / zero runtime errors**, recorded in
the final PR description and external candidate evidence, using dedicated accounts.
Tests use synthetic/deferred responses where appropriate; these are not real model
accuracy or participant usability evidence.

`npm audit`: **20 inherited vulnerabilities (4 critical, 8 high, 7 moderate,
1 low)**. No forced or major dependency upgrade is included. **Production security
is not approved** by a successful typecheck/build or this code review.

Other limits: frontend processing queue is not a durable global server queue;
comparison aligns reported depth only, not datums/formations/MD↔TVD; unit equality
does not imply scientific equivalence; historical trace identity, page continuity
and multicurve accuracy still require independent evaluation.
