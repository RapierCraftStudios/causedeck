**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature foundation; no live defect, blocks #679, #680, #681)
**Task Type**: feature

### What Was Claimed
Part 1 of #502: add `whatsapp_link` and an OTP challenge table, add `whatsapp` to the `notification_channel` enum, a core service (request OTP, verify, unlink, set categories) that only ever targets the owner's verified number (D-029), register tables and exports, and add `'whatsapp'` to `CHANNELS`.

### What We Found
- No WhatsApp link, OTP or consent storage exists; `packages/core/src/whatsapp/` is only the chat-export import (#526), unrelated.
- `packages/notifications/src/categories.ts:5` `CHANNELS = ['in_app','email','push']`; `packages/db/src/schema/notifications.ts:24` `NOTIFICATION_CHANNELS` and `:31` pgEnum `notification_channel` have the same three values.
- `packages/notifications/src/service.ts:132` validates pref channels with `z.enum(CHANNELS)`; `:366` lists prefs over `CHANNELS`; `:239` fan-out is hard-coded to `['email','push']`, so adding `whatsapp` creates no sends (delivery is #679). `resolve` (`:175`) defaults a channel off unless in `defaultChannels`.
- Latest migration is `20261024182641_activation_event.sql` (journal idx 90); the next free number must be taken on the milestone branch. No prior `ALTER TYPE ... ADD VALUE` migration exists, so the first one needs care (not usable in the same tx as the new value's use; the migration must not use the value).
- Registries to update: `packages/db/src/index.test.ts` (~l.40-133 table list), `packages/db/src/__tests__/rls/sql.test.ts:150-170` RLS catalog, `packages/db/src/testing/cross-tenant-registry.ts:120-150` TABLE_TESTS and `:271` SERVICE_TESTS (+ `NOT_A_SERVICE` for pure exports), `packages/db/src/testing/two-tenants.ts:1040-1070` seeders, `packages/core/src/lifecycle/deletion/erase.ts:60` PURGE_ORDER (guard: every tenant table purged), `packages/core/src/lifecycle/export/exporters.ts:300` exporters.
- Core domain wiring pattern: `packages/core/package.json:13` subpath export, `packages/core/src/index.ts:22`, `docs/engineering/core-domains.md:29/48/211` and `CORE_DOMAIN_DEPENDENCIES` (`packages/core/src/domains.test.ts`).

### Root Cause
Missing feature: the WhatsApp channel has no consent/verification model; #502 was split into #678-#681.

### Affected Files
- packages/db/src/schema/whatsapp-link.ts (new), schema/notifications.ts, schema/index.ts
- packages/db/migrations/<next>_whatsapp_link.sql + meta journal/snapshot
- packages/db/src/index.test.ts, __tests__/rls/sql.test.ts, testing/cross-tenant-registry.ts, testing/two-tenants.ts
- packages/notifications/src/categories.ts (+ its tests)
- packages/core/src/whatsapp-link/* (new), core index/package.json, lifecycle erase/export, docs/engineering/core-domains.md, domains test
- packages/core/src/__tests__/cross-tenant/services.test.ts

### Sibling Sweep
Same pattern as `email-intake` (per-user address, verified senders) and `notification_pref`. Other places that enumerate channels: `NOTIFICATION_CHANNELS`/`CHANNELS` only (checked via grep); the preferences UI iterates `CHANNELS` through `service.ts`, so a `whatsapp` column will appear in prefs listings; check web tests that count rows.

### History
`CHANNELS` last touched by a3a7e081 (category additions). #502 closed not_planned and split; siblings #679-#681 are open and depend on this.

### Recommendation
Implement in one lane. New tenant tables `whatsapp_link` (unique per workspace+user and unique verified number per user; CHECK E.164 `^\+[1-9][0-9]{7,14}$`; verified_at, consent_at, categories text[], unlinked state by deleting the row or `unlinked_at`) and `whatsapp_otp_challenge` (code hash only, expires_at, attempts with CHECK cap, consumed_at). Core domain `whatsapp-link` with `requestOtp`, `verifyOtp`, `unlink`, `setCategories`, and `getSendTarget` (returns the verified number only when verified, consented and not unlinked, for the owning user; the only way to obtain a destination). OTP: random 6 digits, stored hashed, constant-time compare, expiry and max attempts, resend cooldown; the sender is injected (no provider here). Add `'whatsapp'` to both enums and a hand-written migration `ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'whatsapp'`.

### Related Issues
#502 (parent), #679, #680, #681 (siblings), #493/#494 (deps of parent).
