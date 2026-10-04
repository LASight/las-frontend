# Selective branding from joa/ui-throwaway

Source commit: `f5d846717c93b11bc0d76c93ee486781b6c0abd9`.
Integrated into the working `feat/75-geoscience-ui` branch without a merge,
cherry-pick, reset or replacement of the current sidebar/auth files.

## Included

- `frontend/src/assets/brand/argentinosaurus.svg`: original shared vector.
- `frontend/public/favicon.svg`: original vector favicon, replacing the emoji.
- Shared `BrandMark` and CSS mask pattern, adapted to flat `currentColor` and
  decorative accessibility when the visible WellSight wordmark already names it.
- Only the old W mark in sidebar and login/signup is replaced. Current 28 px
  sidebar / 34 px auth dimensions, layout, labels, controls and logic remain.

SVG review found no scripts, embedded images, event handlers or external links.
No origin/license metadata was present in the supplied SVG; its provenance is
recorded as the teammate's commit, not as an independently verified license.

## Deliberately excluded

- Split-screen auth hero, gradients, glow, promotional text and auth layout
  restructuring. No unsupported reservoir-readiness or historical accuracy copy.
- The older sidebar file/styles as a whole: Compare wells and workstation layout
  must not be replaced by the older branch version.
- Auth focus styling already covered by the current global focus rule.
- Outdated `UI-INVENTORY.md` and the teammate's generated `tsconfig.tsbuildinfo`.

No API/backend changes, dependencies, commits, pushes or changes to main/dev.
The current build regenerates its own TypeScript cache; it does not import the
other branch's generated cache. Existing uncommitted redesign work is preserved.

Checks: original vector hashes, shared-mark accessibility/auth/navigation unit
tests, full frontend tests/typecheck/build, and isolated real-browser branding
checks. New captures belong to delivery-root
`validation/2026-10-04-brand-import/`, not the earlier frozen galleries.

Final verification passed **369 tests / 38 files**, independent typecheck,
production build and diff check. Five real-browser checks passed on compiled
5177 with zero runtime errors and zero attempted data writes (apart from allowed
dedicated authentication). Captures cover desktop/mobile login, mobile signup,
expanded sidebar, individual mask renderings and 16/32/64 px favicons. Snapshots
verify the existing QA members' saved data did not change. `source-audit.json`
confirms that unrelated pre-existing uncommitted working files are unchanged.
No user acceptance of the visual mark or license provenance is inferred.
