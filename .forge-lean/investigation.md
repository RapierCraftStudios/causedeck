**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (growth feature; core shareable item does not exist yet)
**Task Type**: feature

### What Was Claimed
Share a brief or handover as a secure, expiring link viewable by a non-user, who is invited to join and can import the matter; referral credits in `packages/billing` (free month both sides) with abuse limits; funnel metrics (invites sent, accepted, activated). AC: link works for a non-user, expires, converts to sign-up with referral credited [e2e]; no matter data visible beyond the shared item, links revocable [integration].

### What We Found
- The issue's existing FORGE:INVESTIGATION comment is about the portfolio UI (a different issue) and is not applicable; ignore it.
- UPDATE (rerun, base origin/milestone/prepare-execute c18c312d): brief assembly #60 is merged (PR #706): `packages/core/src/briefs/index.ts` exports `assembleBrief(deps, actor, listingId)` (assemble.ts:39). Brief Sheet UI #61 is still open (`briefs/page.tsx` is a placeholder) but is not needed: a share link renders its own read-only snapshot.
- No handover entity exists: no `handover_note` in `packages/db/src/schema`; #71 is open and its AC says handover is workspace-internal with "no share link, email or export-to-third-party" on those surfaces, which conflicts with sharing a handover externally.
- Invitations exist (`packages/core/src/workspaces/invitations.ts:25-48`: hashed 32-byte token, 7-day TTL, rate limits), but they are workspace-scoped, not cross-workspace shares.
- No referral/credit tables in billing: `packages/db/src/schema/billing.ts` has plan, subscription, entitlement, usage_counter, billing_event only.
- Funnel scaffolding exists: `activation_event` with channel `referral`/`invite` and step `invite_sent` (`packages/db/src/schema/activation.ts:28-50`), `recordActivation` (`packages/core/src/activation/record.ts`), `funnelByCohort` (`funnel.ts`), admin Growth page (`apps/admin/app/(console)/growth/page.tsx`).

### Root Cause
No cross-workspace share or referral exists. The earlier block (brief #60 missing) is cleared; only handover (#71, open, internal-only AC) stays out of scope.

### Affected Files
New migration + `packages/db/src/schema/share.ts` (brief_share, referral_credit); `packages/core/src/shares/*`; `packages/billing/src/referral.ts`; public `apps/web/app/(public)/share/[token]`; owner actions in `apps/web`; activation/funnel; admin Growth page; i18n; registries.

### Sibling Sweep
`(public)/invite/[token]` and `workspaces/invitations.ts:25-48` (hashed token, TTL, rate limits) are the pattern to copy. #506 is a sibling growth item.

### History
Founder request 2026-10-23. Earlier runs ended dependency-open on #60; #60 closed since.

### Recommendation
One lane, brief sharing only. Snapshot the assembled brief at share time (no live matter access from the public page), hashed token, expiry, revoke, rate limits, referral credit granted on first activation of the invitee, funnel steps. Defer handover share to a follow-up (conflicts with #71).

### Related Issues
#60 (closed), #61, #71, #506, #509, #502.
