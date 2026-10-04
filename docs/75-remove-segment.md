# Remove a curve segment

At `/digitize/curves/:collectionId`, select the accidental member in the segment
rail (or the header selector in **Focus view**). Click **Remove segment** in the
workspace header and confirm the named segment. Cancel performs no write.

This uses the existing collection `DELETE .../segments/:jobId` contract:
**detach from this curve, not permanently delete the underlying job or TIFF**.
The backend retains saved crop, calibration, inference and edits. Other members
are unchanged. Local input drafts are also retained rather than discarded.
Already exported files and completed analyses are not rewritten. Future joint
exports/analyses use only the remaining members.

The UI selects the next remaining member (or the previous one when removing the
last position), keeps the current tab and other URL parameters, and refreshes
membership/history. Focus view stays active. Overlap choices are reconciled by
the existing joint-result logic; no replacement source is selected automatically
for a remaining overlap.

## Safeguards

- At least one segment must remain. The UI disables the button and the existing
  API enforces the same rule with HTTP 409.
- Removal is disabled during processing, input saves, add/remove operations,
  result export/analysis and unavailable/loading collection state.
- Fresh membership/count/processing state is checked before detaching. Pending
  review edits on the target must flush successfully first; an error prevents
  detachment and is shown in the workspace.
- During removal, editing, selection, add/processing and joint outputs are locked.
  A failed request refreshes server state without clearing drafts.
- This is not a permanent-delete feature or an undo/reattach UI. The retained
  standalone job remains available through the existing data/history paths.

Selectors: button `#remove-curve-segment`, accessible name **Remove segment**
(**Removing…** while pending); confirmation names the selected segment and scope.

New UI regressions cover cancellation, accidental blank member, first processed
member, remaining drafts, final-member guard, fresh processing state, errors,
focus mode, pending-operation locks and output/removal exclusion. Real-browser
evidence is separate at delivery root:
`validation/2026-10-04-remove-segment/`. No user member is removed by automation;
the runner adds and detaches a new member in an existing dedicated QA account.
No backend changes, commits or pushes.

Final verification: **365 frontend tests / 37 files**, typecheck, build and diff
check pass. The final compiled UI passed four real-browser checks: cancel,
confirmed Focus-view removal with saved-work/source preservation, reload
persistence and final-member protection. Evidence/report:
`validation/2026-10-04-remove-segment/index.html`. Earlier interaction reports
are unchanged and describe their own earlier asset versions.
