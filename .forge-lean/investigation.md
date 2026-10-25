**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (feature part 3 of #502; no live defect)
**Task Type**: feature

### What Was Claimed
Add `POST /v1/inbound/whatsapp` (`apps/api/src/routes/inbound-whatsapp.ts`): signature verification, sender mapped to a verified link without an oracle, size/type allow-list, dedupe by provider message id; core receive logic stores the media in the linked user's workspace capture inbox (#43) and enqueues processing, modelled on inbound-email (#530). A forwarded PDF or voice note lands in the right workspace's capture inbox within a minute; unknown or unverified senders are dropped silently.

### What We Found
- Dependency #678 is closed and merged (7cb370dd): `packages/core/src/whatsapp-link/link.ts` has `whatsapp_link` (`packages/db/src/schema/whatsapp-link.ts:28`, one row per verified member+workspace, `e164`, `verifiedAt`, `consentAt`; unlink deletes the row). No inbound code exists (`apps/api/src/routes` has only `inbound-email.ts`).
- Template to copy: `apps/api/src/routes/inbound-email.ts:1-94` (raw body, provider.verify -> 400, per-item core call, 200 ack, drop reasons logged without PII); core `packages/core/src/email-intake/receive.ts:42-70` (resolve, channel gate, insert dedupe row with `onConflictDoNothing`, enqueue in the same tx); worker body `packages/core/src/email-intake/run.ts:150-290` (hash, dedupe, `store.put`, `blob` + `capture` insert, then `jobs.scan`/`jobs.process`); job `packages/core/src/jobs/definitions/email-intake.ts`.
- Workspace-free sender lookup must be a SECURITY DEFINER function, as `app_resolve_intake_address` (`packages/db/migrations/0059_email_intake.sql:77-88`, called at `packages/core/src/email-intake/address.ts:195`). `whatsapp_link` is under FORCE RLS, so it needs an `owner_definer_read` policy plus `app_resolve_whatsapp_sender(e164)`. Nothing prevents the same number being linked by several members/workspaces, so the function must return a row only when exactly one link matches.
- `'whatsapp'` is not a capture channel: `CAPTURE_CHANNELS` (`packages/db/src/schema/capture.ts:31-41`) has only `whatsapp_export`, and the DB check `capture_channel_chk` (`:114`, migration `0053_capture_inbox.sql:37`) enumerates them. Channels other than `manual`/`upload` are opt-in (`packages/capture/src/types.ts:12`, `packages/core/src/capture/channels.ts:49-60`). Other users of the list: `packages/validators/src/capture.ts`, `packages/capture/src/__tests__/lists.test.ts`, `packages/core/src/capture/retention.ts`.
- Allow-list/size caps: `packages/capture/src/allow-list.ts` (`resolveAllowedType`, `DEFAULT_SIZE_CAPS_BYTES`: pdf 50MB, ogg/m4a/mp3 25MB). A WhatsApp voice note is audio/ogg (opus).
- WhatsApp Cloud API delivers only a media id; bytes need a Graph API fetch with an access token, so the webhook cannot store media inline in 300 ms (the inbound-email handler's budget). Webhook verification is `X-Hub-Signature-256` HMAC-SHA256 over the raw body with the app secret, plus a GET `hub.challenge` handshake.
- API wiring: `apps/api/src/app.ts:54-59,119,127`, `apps/api/src/server.ts:12,137`, rate limit `'/v1/inbound'` already covers the path; guards `apps/api/src/__tests__/static-guards.test.ts:44`, `apps/api/src/__tests__/cross-tenant.test.ts:52`. Jobs registry `packages/core/src/jobs/registry.ts:40,193`; `apps/worker/src/__tests__/registry.test.ts:158`.

### Root Cause
Missing feature: nothing receives WhatsApp-forwarded media. Part 3 of #502 (parts #678 done, #679, #681 open).

### Affected Files
- packages/capture/src/whatsapp-inbound/* (new: provider interface, Meta signature verify, payload parse, type/size allow-list) + index export
- packages/db/src/schema/whatsapp-link.ts (+ new `whatsapp_inbound_message` dedupe table), schema/capture.ts (channel), migration + journal/snapshot
- packages/db registries: `src/index.test.ts`, `__tests__/rls/sql.test.ts`, `testing/cross-tenant-registry.ts`, `testing/two-tenants.ts`; `packages/core/src/lifecycle/deletion/erase.ts` PURGE_ORDER, export exporters if the guard requires
- packages/core/src/whatsapp-link/{receive,run}.ts (+ index), core package exports, `jobs/definitions/whatsapp-intake.ts`, `jobs/registry.ts`, `docs/engineering/core-domains.md` + `CORE_DOMAIN_DEPENDENCIES` (whatsapp-link -> capture)
- apps/api/src/routes/inbound-whatsapp.ts (new), `app.ts`, `server.ts`, `routes/v1/index.ts` if routes mount there, static-guards and cross-tenant tests, OpenAPI snapshot if one is checked in
- apps/worker registry/schedules tests; packages/validators/src/capture.ts; i18n channel labels if the catalog test enumerates channels

### Sibling Sweep
Same pattern: inbound email (#530) and the Razorpay webhook. Other places enumerating capture channels: validators, retention, `lists.test.ts`, web channel settings (grep `whatsapp_export` before finishing). Any new `@causedeck/core` runtime export needs `SERVICE_TESTS` or `NOT_A_SERVICE` in the cross-tenant registry.

### History
Inbound email landed in #530 (needs-human after ci.red); link/OTP in #678/#694. #678 needed-human outcomes came from registries and scope creep: keep strictly to the deliverables.

### Recommendation
One lane. Webhook verifies (provider injected; `null` = every call 400), parses text-free events, resolves sender by `app_resolve_whatsapp_sender`, applies the capture-channel gate and the type/size allow-list from the declared mime and size, inserts a dedupe row `(workspace_id, provider_message_id)` and enqueues `whatsapp.intake` in the same tx. The job downloads the media via the provider, stores bytes through the same blob/capture path as `runEmailIntake` (channel `whatsapp`), then scan/process. Unknown, unverified, ambiguous, disabled and disallowed senders get 200 and a logged reason only (no reply, no number logged). Open points for the implementer: exact provider (Meta Cloud API assumed) and whether media may be fetched in the webhook; keep the provider behind an interface with a shared-secret file/dev variant for tests.

### Related Issues
#502 (parent), #678 (dependency, closed), #679, #681 (siblings), #43, #530.
