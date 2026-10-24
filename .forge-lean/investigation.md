**Verdict**: BLOCKED
**Confidence**: medium
**Severity**: medium (growth feature; core shareable item does not exist yet)
**Task Type**: feature

### What Was Claimed
Share a brief or handover as a secure, expiring link viewable by a non-user, who is invited to join and can import the matter; referral credits in `packages/billing` (free month both sides) with abuse limits; funnel metrics (invites sent, accepted, activated). AC: link works for a non-user, expires, converts to sign-up with referral credited [e2e]; no matter data visible beyond the shared item, links revocable [integration].

### What We Found
- The issue's existing FORGE:INVESTIGATION comment is about the portfolio UI (a different issue) and is not applicable; ignore it.
- No brief entity exists: `apps/web/app/(app)/w/[slug]/briefs/page.tsx:1-3` is `placeholderPage('briefs')`; no brief code in `packages/core/src` (only mentions in `matter-graph/matters.ts:134`, `email-intake/allowlist.ts`). Brief assembly #60 and Brief Sheet UI #61 are open.
- No handover entity exists: no `handover_note` in `packages/db/src/schema`; #71 is open and its AC says handover is workspace-internal with "no share link, email or export-to-third-party" on those surfaces, which conflicts with sharing a handover externally.
- Invitations exist (`packages/core/src/workspaces/invitations.ts:25-48`: hashed 32-byte token, 7-day TTL, rate limits), but they are workspace-scoped, not cross-workspace shares.
- No referral/credit tables in billing: `packages/db/src/schema/billing.ts` has plan, subscription, entitlement, usage_counter, billing_event only.
- Funnel scaffolding exists: `activation_event` with channel `referral`/`invite` and step `invite_sent` (`packages/db/src/schema/activation.ts:28-50`), `recordActivation` (`packages/core/src/activation/record.ts`), `funnelByCohort` (`funnel.ts`), admin Growth page (`apps/admin/app/(console)/growth/page.tsx`).

### Root Cause
Greenfield. The item to share (brief #60/#61, handover #71) has not been built, so a secure share link has no payload or access-controlled projection to expose.

### Affected Files
Would be: new share schema + migration, `packages/core` share domain, public `apps/web/app/(public)/share/[token]`, `packages/billing` referral credit, `packages/core/src/activation`, admin Growth page, i18n, registries (cross-tenant, core domains).

### Sibling Sweep
`apps/web/app/(public)/invite/[token]` is the closest token-page precedent. #506 (free alerts tier) is a sibling growth item.

### History
Founder request 2026-10-23. No prior implementation.

### Recommendation
Land #60 (brief assembly) and #61 (Brief Sheet) first; then implement brief sharing only. Handover sharing needs a product decision reconciling #71's "internal only" criterion. Requeue behind #60 and #61.

### Related Issues
#60, #61, #71, #506, #509 (activation funnel), #502.
