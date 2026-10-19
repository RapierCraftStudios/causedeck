# Billing

`packages/billing` holds CauseDeck's own SaaS billing (#28, PRD PL-3, architecture §6.5): the plan
catalogue, the subscription state machine, seat proration, the `BillingProvider` contract with a
deterministic mock and the Razorpay adapter, and the daily reconcile. It bills workspaces for
CauseDeck only. The system never takes payments for an advocate's clients, and no card or bank
data touches our servers: customers authorise through Razorpay's hosted UPI Autopay mandate link.

Dev and CI need no credentials: `BILLING_PROVIDER` defaults to `mock`.

| Import | What |
|---|---|
| `@causedeck/billing` | Barrel, safe in `apps/web`: plans, GSTIN, proration, state machine |
| `@causedeck/billing/plans` | `PLAN_CATALOGUE`, `checkPlanConfig`, `mandateChargeNotice`, the UPI mandate cap |
| `@causedeck/billing/state-machine` | `TRANSITIONS`, `transition`, `applyProviderEvent`, `fromSubscriptionRow` |
| `@causedeck/billing/proration` | `prorateSeatIncrease` |
| `@causedeck/billing/service` | `createBillingService` (start, change seats, cancel, resume). Never touches the database |
| `@causedeck/billing/provider` | `createBillingProvider(env)`, the mock and Razorpay providers. Server-only |
| `@causedeck/billing/reconcile` | `reconcileSubscriptions` for the daily reconcile. Server-only |

## State machine

`packages/billing/src/state-machine.ts` is pure: `transition(snapshot, event, now)` returns the
next snapshot, and a move missing from `TRANSITIONS` throws `IllegalTransitionError`. Provider
webhooks map to events through `fromProviderEvent` (`subscription.pending` and `payment.failed`
are both `payment_failed`; `payment.captured` changes nothing because the charge arrives as
`subscription.charged`).

```mermaid
stateDiagram-v2
  [*] --> created: startSubscription
  created --> active: activated / charged
  active --> active: charged, seats/plan change, cancel at period end
  active --> past_due: payment_failed
  active --> grace: halted
  active --> paused: paused
  past_due --> active: charged
  past_due --> past_due: payment_failed
  past_due --> grace: halted
  grace --> active: charged
  grace --> downgraded: grace_expired (7 days)
  paused --> active: resumed
  created --> cancelled: cancelled
  active --> cancelled: cancelled, completed, charged with cancel at period end
  past_due --> cancelled: cancelled, completed
  grace --> cancelled: cancelled, completed
  paused --> cancelled: cancelled
  downgraded --> [*]
  cancelled --> [*]
```

`seats_changed`, `plan_changed` and `cancelled` are legal from `created`, `active`, `past_due` and
`grace`. `downgraded` and `cancelled` are terminal: the workspace starts a new subscription.

The `subscription.status` column stores the state as:

| State | `status` |
|---|---|
| `created` | `trialing` |
| `active` | `active` |
| `past_due` | `past_due` |
| `grace` | `past_due` with `grace_until` set |
| `paused` | `paused` |
| `cancelled` | `cancelled` |
| `downgraded` | `expired` |

## Proration

`packages/billing/src/proration.ts`, all in integer paise with bigint arithmetic:

- **Seat increase mid-cycle:** charged immediately for the rest of the period. Per line (paid
  seats, clerk seats): `round_half_up(added seats × unit price × remaining seconds / period
  seconds)`. Each line is rounded on its own, then the lines are summed. The time basis is the
  actual period in whole seconds, so 28/29/30/31-day months and leap years are exact.
- **Seat decrease:** never refunded. It is scheduled at the provider for the next cycle
  (`pendingSeats`) and applied on the next `subscription.charged`.
- **Plan change:** `plan_changed` keeps the state and records the new plan id. The billing
  service has no plan-change operation yet, so nothing is prorated for it.
- The prorated `charge` is returned to the caller and collected by invoicing (#29).

## Dunning

The policy, implemented in `packages/billing/src/dunning.ts` and the `billing-dunning-tick` job by
#205 (still to land):

1. A failed charge (`payment.failed` / `subscription.pending`) moves the subscription to
   `past_due`. Razorpay retries the charge; the dunning schedule retries on day 1, 3, 5 and 7.
2. Each stage sends an in-app and email `billing.notice` (#23).
3. When the provider halts the subscription (`subscription.halted`) it enters `grace`:
   `GRACE_PERIOD_DAYS = 7` days of full access (`grace_until`).
4. After grace (`grace_expired`) the workspace is `downgraded` to read-only Junior limits. No data
   is ever deleted; a new subscription restores access.

## Test prices

Placeholder prices to validate pricing, kept as data in `packages/billing/src/plans.ts` (seeded by
`packages/db/src/seed/plans.ts`) so they change without code changes. All amounts are ex-GST;
18% GST (`GST_RATE_BPS = 1800`) is added on the invoice (#29). The snapshot test in
`packages/billing/src/__tests__/plans.test.ts` pins them.

| Plan id | Plan | Price (Rs) | Paise | Notes |
|---|---|---|---|---|
| `junior` | Junior | 0 | 0 | Free; 15 active matters, fair-use caps |
| `advocate-monthly-1` / `-2` / `-3` | Advocate (monthly) | 499 / 799 / 1,199 per month | 49,900 / 79,900 / 119,900 | |
| `advocate-annual-1` / `-2` / `-3` | Advocate (annual) | 4,990 / 7,990 / 11,990 per year | 499,000 / 799,000 / 1,199,000 | 10 × monthly |
| `chamber-seat-1` / `-2` / `-3` | Chamber | 499 / 649 / 899 per seat per month | 49,900 / 64,900 / 89,900 | Minimum 3 seats |
| clerk seat (chamber) | Clerk seat | 199 per seat per month | 19,900 | `CLERK_SEAT_PRICE_PAISE` |

## UPI Autopay mandate cap

UPI Autopay e-mandates debit up to Rs 15,000 per charge without the payer authenticating each
charge (`UPI_AUTOPAY_MANDATE_CAP_PAISE = 1_500_000`). A larger charge needs the payer to approve
it in their UPI app every time.

- **Plan config check:** `checkPlanConfig()` flags a fixed-price plan whose charge is above the
  cap (`upi-mandate-cap-exceeded`) and notes, for each per-seat plan, the most paid seats whose
  charge stays within it (`upi-mandate-cap-seats`). With the test prices no fixed plan is over the
  cap (the largest, `advocate-annual-3`, is Rs 11,990); chamber charges cross it above 30 seats
  (band 1), 23 seats (band 2) or 16 seats (band 3), counting clerk seats in the same charge.
- **Mandate flow copy:** `mandateChargeNotice(plan, { seats, clerkSeats })` returns one cycle's
  `chargePaise` and `requiresAdditionalAuth`. When it is true, the mandate and upgrade flow shows
  the copy at `MANDATE_ADDITIONAL_AUTH_MESSAGE_KEY` (`billing.mandate.additionalAuth.title` and
  `.body` in `packages/i18n/src/messages/*/settings.json`, ICU argument `{amount}` = the formatted
  cap, Rs 15,000) before sending the customer to the mandate link. The billing UI that renders it
  is #29.

## Secrets and the boot guard

- `RAZORPAY_SECRET` (the API key secret) and `RAZORPAY_WEBHOOK_SECRET` are parsed into `Secret`
  (`@causedeck/config/env`, #4). They print as `[REDACTED]` in logs, JSON and errors; only the SDK
  constructor (`createRazorpayProvider`) and, from #204, webhook signature verification call
  `.reveal()`.
  `RAZORPAY_KEY_ID` is not secret.
- With no billing keys set, `BILLING_PROVIDER` defaults to `mock` and the app boots.
- `BILLING_PROVIDER=razorpay` requires all three keys; a missing one fails boot naming the key,
  never echoing a value.
- In production, `BILLING_PROVIDER=mock` fails boot unless `ALLOW_MOCK_PROVIDERS=true` (meant for
  staging demos only). Tests: `packages/billing/src/__tests__/provider-select.test.ts`,
  `packages/config/src/env/__tests__/schema.test.ts`.

## Webhook secret rotation

Razorpay signs each webhook with the endpoint's secret (`X-Razorpay-Signature`, HMAC-SHA256);
the webhook route (#204) verifies it with `RAZORPAY_WEBHOOK_SECRET` in constant time. A webhook has
one secret at a time, so rotate like this:

1. Generate a new random secret (at least 32 bytes) and store it in the secret manager as the
   pending value of `RAZORPAY_WEBHOOK_SECRET` (#111).
2. In the Razorpay Dashboard (Settings → Webhooks), edit the CauseDeck webhook and set the new
   secret, then deploy the new value straight away.
3. Deliveries signed with the new secret before the deploy finishes are rejected with 400.
   Razorpay retries failed deliveries, and processing is idempotent by `x-razorpay-event-id`, so
   the retries apply once the new secret is live. The next daily reconcile reports anything still
   out of step.
4. Remove the old value. Rotate immediately if the secret may have leaked, and on any staff
   change with access to it.

The API key secret (`RAZORPAY_SECRET`) rotates the same way: generate a new key in the Dashboard,
deploy `RAZORPAY_KEY_ID` and `RAZORPAY_SECRET` together, then revoke the old key.

## Daily reconcile

`system.billing.reconcile` (`packages/core/src/jobs/definitions/billing-reconcile.ts`) runs daily
at 04:00 IST. It lists every current (not cancelled or expired) subscription that has a provider
id through the SECURITY DEFINER function `app_billing_reconcile_targets()` (ids only,
`0007_billing_reconcile`), reads each row inside `withWorkspace`, calls only
`provider.fetchSubscription`, and logs one `warn` per discrepancy (`billing reconcile
discrepancy`) plus a summary `info` (`billing reconcile complete`, `{ checked, discrepancies }`).

| `field` | Meaning |
|---|---|
| `status` | Local `status` differs from the provider status (`created`/`authenticated` = `trialing`, `pending`/`halted` = `past_due`, `completed` = `cancelled`) |
| `seats` | Local paid seats differ from the provider quantity |
| `current_period_end` | Period end differs (compared to the second) |
| `cancel_at_period_end` | Cancel-at-period-end flags differ |
| `missing_at_provider` | The provider does not know the subscription id |
| `fetch_failed` | Any other provider error (logged by error code only) |

It never mutates: no database writes and no provider call besides `fetchSubscription`. Logs carry
ids and the compared values only, never the billing email, GSTIN, payloads or secrets. A
discrepancy usually means a missed or failed webhook: check the webhook deliveries in the Razorpay
Dashboard and redeliver the event, which the idempotent webhook route applies once. Do not edit
`subscription` rows by hand.

## Switching to live

1. Get the live Razorpay key id, key secret and webhook secret (#111) into the secret manager.
2. Create one Razorpay plan per paid catalogue row (same amount in paise and interval) and pass
   their ids to `createBillingService({ providerPlanId })`. The mock accepts catalogue ids as-is.
3. Register the API's Razorpay webhook route (#204) in the Dashboard for the subscription and
   payment events, with the webhook secret.
4. Set `BILLING_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_SECRET` and
   `RAZORPAY_WEBHOOK_SECRET`, and leave `ALLOW_MOCK_PROVIDERS` unset. Boot fails if any key is
   missing.
5. Run one end-to-end subscription with a test-mode key first, then check that the next daily
   reconcile logs `billing reconcile complete` with no discrepancies.
