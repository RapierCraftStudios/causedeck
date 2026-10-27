**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: low (tracking issue; no defect, nothing deliverable in this lane)
**Task Type**: chore

### What Was Claimed
#819 is a deferral tracker from #76. Two items: R12 (the routine documents: early-listing memo, memo of appearance, application for certified copy, adjournment note, covering letter to junior or senior counsel), already marked "defer" (counsel covering letter needs a non-client recipient model the client-letter rule forbids), and R14 (advocate review of wording before the flag-free release), already marked "post-deploy".

### What We Found
- Base `origin/milestone/drafting-citations-research` already ships the four non-counsel routine documents plus a client covering letter: `packages/i18n/src/messages/en/drafting-templates.json` names `early_listing_memo`, `memo_of_appearance`, `certified_copy_application`, `adjournment_note`, `client_covering_letter`. No counsel covering letter exists.
- `template.reviewed_by` (null keeps the scaffold banner) was added by `packages/db/migrations/20261027114446_system_templates.sql:5`; `packages/core/src/drafting/export.ts:136-153` sets `bannerShown` while `reviewedBy == null`. So R14 is only checkable once an advocate sets `reviewed_by` on released scaffolds.
- The stale comment and prior `.forge-lean` files on this issue describe #79 Part 2 (drafts list UI). That does not match the current issue body (deferred-from-#76 items); they were discarded and not used.

### Root Cause
Not a defect: scope deliberately deferred from #76 (counsel letter needs its own recipient model; advocate review needs released scaffolds).

### Affected Files
None in this change. Future follow-up (R12): the template catalog and seed under `packages/core/src/drafting`, `drafting-templates.json` (en/ta/kn).

### Sibling Sweep
Other deferred-from-#76 trackers follow the same shape; none are in scope here.

### History
#76 (system templates, completed, merged) declared both out of scope.

### Recommendation
Disposition per the issue's own text: R12 defer (file follow-up with a recipient model), R14 post-deploy (engine files tracked follow-up). No code changes; contract has no deliverables.

### Related Issues
#76 (origin), #79 (drafting studio parent).
