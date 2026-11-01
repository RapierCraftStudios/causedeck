# Feature flags, kill switches and the access-mode registry

`packages/flags` (#22). Decisions: [ADR 0010](../adr/0010-feature-flags-db-backed-legal-gating-and-no-l5.md) (DB-backed flags, legal gating) and [ADR 0011](../adr/0011-access-mode-registry-closed-enum.md) (closed access-mode enum).

## Flags

Every flag is off by default and ships dark. ⚖ marks a legal-gated flag. A legal-gated flag turns on only through a staff action that records `legal_ack_by` and a note. The test `packages/flags/src/__tests__/docs.test.ts` checks that this table matches the registry (`packages/flags/src/keys.ts`).

| Key | Legal-gated | Kill switch | Consumed by |
| --- | --- | --- | --- |
| `invoices.enabled` | ⚖ yes | `KILL_INVOICES_ENABLED` | #83 fees and invoices, #120 counsel unlock; hides the `invoices` route (#11) |
| `limitation.enabled` | ⚖ yes | `KILL_LIMITATION_ENABLED` | #84 limitation tracker, #120 counsel unlock; hides the `limitation` route (#11) |
| `court.a2.retrieval` | ⚖ yes | `KILL_COURT_A2_RETRIEVAL` | #35 adapter framework, #120 counsel unlock |
| `court.live-tracking` | ⚖ yes | `KILL_COURT_LIVE_TRACKING` | #35 adapter framework, #493 display-board tracking, #120 counsel unlock |
| `court.khc-a2` | ⚖ yes | `KILL_COURT_KHC_A2` | #482 Karnataka HC cause-list watch (A2), #118 counsel clearance |
| `court.case-status` | ⚖ yes | `KILL_COURT_CASE_STATUS` | #483 case-status watch, refresh and on-device captcha solver (D-048 tier 4), #118 counsel clearance |
| `court.sanctioned-push` | ⚖ yes | `KILL_COURT_SANCTIONED_PUSH` | #35 adapter framework, #120 counsel unlock |
| `ai.bedrock` | no | `KILL_AI_BEDROCK` | #44 AI gateway, #112 Bedrock credentials |
| `ai.sarvam` | no | `KILL_AI_SARVAM` | #44 AI gateway, #51 voice capture, #113 Sarvam key |
| `capture.whatsapp-import` | ⚖ yes | `KILL_CAPTURE_WHATSAPP_IMPORT` | #55 WhatsApp export importer (#525 parser and server checks), #120 counsel unlock |
| `capture.email-forward` | no | `KILL_CAPTURE_EMAIL_FORWARD` | #54 email forward-in intake, #287 intake address card in settings integrations |
| `capture.ics-feed` | no | `KILL_CAPTURE_ICS_FEED` | #53 private ICS feed (`/api/ics/[token]`, the calendar settings page and its actions), #287 card in settings integrations (links to the calendar page) |
| `pwa.offline` | no | `KILL_PWA_OFFLINE` | #50 offline outbox, #65 offline cache |
| `billing.razorpay` | no | `KILL_BILLING_RAZORPAY` | #28 Razorpay subscriptions, #111 Razorpay account |
| `insights.enabled` | no | `KILL_INSIGHTS_ENABLED` | #85 insights dashboard, #966 gating; hides the `insights` route (404) and its nav entry; on for the demo workspaces (#985) |
| `workspace.export` | no | `KILL_WORKSPACE_EXPORT` | #31 export service, #288 export settings page (enables `Export workspace`) |
| `conflicts.check` | ⚖ yes | `KILL_CONFLICTS_CHECK` | #500 conflict-of-interest check on new-matter intake, counsel sign-off through #486 |
| `intake.enquiry_log` | ⚖ yes | `KILL_INTAKE_ENQUIRY_LOG` | #87 inbound enquiry log with conflict check and no auto-reply (ADR 0047), off until counsel clears it, #117 counsel deliverables |
| `status_links.enabled` | ⚖ yes | `KILL_STATUS_LINKS_ENABLED` | #88 advocate-authored expiring client status links (ADR 0050), off until counsel clears the wording and Rule 36 review, #117 counsel deliverables |
| `bench_facts` | ⚖ yes | `KILL_BENCH_FACTS` | #521 factual bench card (D-050), off until counsel clears it, #118 counsel clearance |
| `growth.free-alerts` | no | `KILL_GROWTH_FREE_ALERTS` | #506 free court-day alerts tier: discovery enrols the advocate's cases as case-status watches (free plan, up to its watch allowance) and each free workspace's delegated fetch spend is capped per IST month (`fetch.cost_micros`); runs on the mock fetch provider until the sources are cleared |
| `growth.onboarding-nudge` | no | `KILL_GROWTH_ONBOARDING_NUDGE` | #601 `system.onboarding.nudge` job: in-app and opt-in WhatsApp reminders for unfinished setup steps; WhatsApp runs on the mock sender until the provider approves the template |
| `captcha.bulk` | ⚖ yes | `KILL_CAPTCHA_BULK` | #492 bulk captcha scheduler (`packages/fetch/src/captcha`): runs only for a source whose registry row has `captcha_bulk_cleared` plus `captcha_bulk_approval_ref`, #118 counsel clearance. Per-host kill: `KILL_CAPTCHA_BULK_HOST_<HOST>` (host upper-cased, non-alphanumerics as `_`) |
| `m5_playbooks` | no | `KILL_M5_PLAYBOOKS` | #81 M5 playbooks and precedent bank, #901 backend (confirmed passages only; on for the demo workspace) |
| `adapters.workbench-fetch` | no | `KILL_ADAPTERS_WORKBENCH_FETCH` | #598 governed one-off fetch into the fixture workbench (staff-only, audited, body in memory only); mock provider until `ALTERLAB_API_KEY` is set, so enabling it plus the key is the live switch |

## Evaluation

`isEnabled(key, { workspaceId, userId? })` and `evaluateAll(ctx)` (`packages/flags/src/evaluate.ts`) apply these rules in order. The first rule that matches wins.

1. **Kill switch.** If `KILL_<KEY>` is true in the environment, the flag is off. This rule reads no database.
2. **Workspace override.** A `workspace_feature_flag` row for the workspace. This is a tenant table under FORCE RLS.
3. **Global row.** A `feature_flag` row. This is a global table that only staff manage.
4. **Registry default.** Always `false`.

Legal-gated flags follow an extra rule. A row counts as on only if it has `legal_ack_by` (and its note, which a check constraint enforces). A workspace row turns a legal flag on only while the global row is also on with its own acknowledgement. A workspace row on its own can never enable a legal flag. Any row may turn a flag off.

Using an unknown key fails at compile time, because `FlagKey` is a literal union. At runtime it throws `UnknownFlagError`.

### Cache

Each server process caches every workspace's flag rows in an LRU with a 15 s TTL (`packages/flags/src/cache.ts`).

- Writes to `feature_flag` or `workspace_feature_flag` fire `pg_notify('flag_changed', key)` through a trigger (migration `0012_flags`).
- `startFlagListener(db)` runs `LISTEN flag_changed` and empties the cache when a notification arrives, so a change reaches every process in well under 2 s.
- If a notification is lost, the TTL still bounds staleness to 15 s.
- The web app and the API start the listener once per process.

### Gating server code

- `requireFlag(key, ctx)` throws `FlagOffError` (`FEATURE_OFF`).
- The web app maps this to `notFound()` (`apps/web/lib/flags.ts`: `requireWorkspaceFlag`, and `placeholderPage`).
- The API maps it to `404 NOT_FOUND`, using `requireFlagMiddleware(key)` in `apps/api/src/middleware/flags.ts`.
- A dark feature therefore looks exactly like a route that does not exist. The response never names the flag.

### Clients

- The server evaluates the flags and passes only the boolean snapshot to the client: the workspace layout calls `evaluateAll`, and the result goes to `FlagsProvider`.
- `useFlag`, `useIsEnabled` and `<Feature flag=…>` (`@causedeck/flags/react`) read that snapshot. They are for UX only, such as hiding nav items.
- Rows, legal notes, `legal_ack_by` and descriptions never reach the client.
- Security-relevant decisions are always made on the server.

## Adding a flag

1. Add the key to `FLAGS` in `packages/flags/src/keys.ts`. Set `legalGated` and the consuming issues in `owner`.
2. Add its kill switch (`KILL_` + the key upper-cased, with every non-alphanumeric character as `_`) to `FLAG_KILL_SWITCHES` in `packages/config/src/env/kill-switches.ts`. A test keeps the two lists in sync.
3. Add a row to the table above. A test checks it.
4. Gate the server path with `requireFlag`. Gate the UI with `useFlag` or `<Feature>`, or with a nav item's `flag`.

**Naming.** Use `<area>.<capability>`, lower case (`bench_facts` is the one legacy underscore key, named by D-050), with dot-separated segments and hyphens inside a segment (`court.live-tracking`). Use `.enabled` for a whole area (`invoices.enabled`).

**Removing a flag.** Once its feature is launched and the flag is no longer needed, delete it from the registry, the kill-switch list and this table, and delete its rows in a migration.

## Legal-gating process

1. The feature ships behind a legal-gated flag, which stays off everywhere.
2. Counsel delivers the deliverable that unlocks it. These are tracked as `needs-human` issues, for example #120.
3. In the staff console (`/flags`, #311), a staff member with the `flags` capability (ops or admin) requests the enable. They give the legal note, tick the acknowledgement and enter a fresh TOTP code. This is `requestLegalEnable(db, asStaff(userId), { key, workspaceId?, legalAckNote })`, which records a pending `flag_change_request`. Nothing turns on yet, and only one request per (key, workspace) can be pending.
   - A different, enabled staff member with the `admin` role approves it, again with a fresh TOTP code (`approveLegalEnable`). Self-approval fails with `SELF_APPROVAL`, and a non-admin or disabled approver fails with `FORBIDDEN`. An admin may reject the request instead, or its requester may withdraw it (`rejectLegalEnable`).
   - The approval writes the row in the same transaction: `legal_ack_by` is the requester, `legal_ack_note` is the request's note, and `updated_by` is the approver.
   - Operators can still call `setFlag(db, asStaff(userId), { key, enabled: true, legalAckNote })` directly. Without a note it fails with `LEGAL_ACK_REQUIRED`. The console never uses it for a legal-gated enable.
   - To pilot the flag in one workspace, request the enable for that workspace, with its own note. The global row must also be legally on.
4. Every change writes a `flag.changed` audit event (actor, key, workspace, old value, new value, note) through the flag audit sink. Each request step also writes `flag.change_requested`, `flag.change_approved` or `flag.change_rejected`. #26 provides the real writer (`flagChangeAuditSink`), and the admin app installs it (`apps/admin/lib/flags.ts`).
5. Turning a legal flag off clears its acknowledgement. Turning it back on needs a new note.

## Kill-switch runbook

Use this when a flagged feature misbehaves in production and must stop now, without a deploy and without database access.

1. Set `KILL_<KEY>=1` (or `true`) in the service's environment for every process that serves the feature (web, API, worker).
2. Restart those processes. The switch takes effect immediately on restart: the evaluator checks it before it reads the cache or the database.
3. Confirm: the feature's routes return 404 and its nav entries disappear.
4. To restore the feature, remove the variable (or set it to `0`/`false`) and restart again.

A database change (staff toggling a row) needs no restart. It propagates within 15 s at most, and usually immediately through `LISTEN/NOTIFY`.

## Access-mode registry

- `access_mode_registry` is a global table. Each row is (`adapter_id`, `resource`, `mode`, `enabled`, counsel note, reviewer), one per adapter resource.
- A court-adapter capability must call `assertAccessMode({ adapterId, resource, requestedMode })` before it runs.
- The call throws `ACCESS_MODE_DENIED` in any of these cases:
  - there is no row;
  - the row is disabled;
  - either mode is `none`;
  - the requested mode differs from the registered one;
  - the mode is `device_user_triggered`, `official` or `licensed` and the row has no counsel note (reason `no-counsel-note`, #369).
- Court adapters call it through `assertAccessMode(adapterId, resource, mode)` in `@causedeck/adapters`, which throws `AccessModeViolationError` (same code and reason) and refuses a declared `none` without reading the registry ([ADR 0015](../adr/0015-court-adapter-framework.md)).
- The modes are a closed enum, fixed by [ADR 0011](../adr/0011-access-mode-registry-closed-enum.md) and pinned by `access-mode-guard.test.ts`.
- `seedAccessModes` (`packages/flags/src/seed.ts`) seeds the launch adapters:
  - `madras-hc` and `karnataka-hc` have `case-status` rows with mode `user_supplied`, enabled.
  - Their `a2-retrieval`, `live-tracking` and `sanctioned-push` rows exist but stay disabled until counsel signs off.

## Storage and tenancy

| Table | Kind | Notes |
| --- | --- | --- |
| `feature_flag` | global (`GLOBAL_TABLES`) | One row per key. Only staff write it. |
| `workspace_feature_flag` | tenant (FORCE RLS, `ws_isolation`) | One row per (workspace, key). Covered by the cross-tenant suite. |
| `access_mode_registry` | global (`GLOBAL_TABLES`) | One row per (adapter, resource). |
| `flag_change_request` | global (`GLOBAL_TABLES`) | Pending, approved or rejected legal-gated enables (#311). `workspace_id` is the target override, or null for the global row. Staff-only, with no RLS. The app role cannot delete rows. |

The issue sketched a single `feature_flag` table with a nullable `workspace_id` and a partial policy. The tenancy checks (`db:check`, `db:check-rls`, [tenancy.md](tenancy.md)) require tenant tables to have a NOT NULL `workspace_id` and the standard policy, so the per-workspace rows live in their own tenant table instead.
