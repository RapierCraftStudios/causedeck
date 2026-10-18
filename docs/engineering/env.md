# Environment variables

Every app and package reads configuration through `@causedeck/config/env` (spike §3.2). Nothing
else reads `process.env`; ESLint's `no-process-env` rule enforces this outside
`packages/config/src/env` and `packages/config/scripts`.

```ts
import { serverEnv } from '@causedeck/config/env'; // server code only
import { clientEnv } from '@causedeck/config/env/client'; // browser-safe, NEXT_PUBLIC_* only

const env = serverEnv(); // validated once, then cached
if (env.EMAIL_PROVIDER === 'ses') sendWith(env.SES_SECRET_ACCESS_KEY.reveal());
```

## No credentials in dev and CI

Each integration has a provider switch that defaults to a mock or console provider (spike §9).
Credentials are validated only when the provider that needs them is selected, so the schema
boots with an empty environment plus `NODE_ENV`. CI uses the committed `.env.ci`, which holds no
secrets. Real credentials come from the `chore(human)` issues in the last column below (#109 for
Google OAuth, #110 SES, #111 Razorpay, #112 Bedrock, #113 Sarvam, #115 Sentry, #116 deploy secrets).

| Switch | Default | Real providers |
|---|---|---|
| `EMAIL_PROVIDER` | `console` | `ses`, `smtp` |
| `AI_PROVIDER` | `mock` | `bedrock`, `sarvam` |
| `STORAGE_PROVIDER` | `minio` | `minio`, `s3` |
| `BILLING_PROVIDER` | `mock` | `razorpay` |
| `AUTH_GOOGLE_ENABLED` | `false` | `true` |
| `SENTRY_ENABLED` | `false` | `true` |

## Rules

- **Dev defaults** (local Postgres, MinIO and Mailpit URLs from #5, plus dev-only placeholder
  secrets) apply only when `NODE_ENV` is not `production`.
- **Production** requires `DATABASE_URL`, `APP_URL`, `API_URL`, `BETTER_AUTH_SECRET` (at least 32
  characters, not the dev placeholder) and `KEK_BASE64` (exactly 32 bytes, not the dev placeholder).
  It rejects the mock providers (`console` email, `mock` AI, `mock` billing) unless
  `ALLOW_MOCK_PROVIDERS=true`.
- **India-only AI**: `AI_INDIA_ONLY` defaults to `true`. Turning it off in production needs
  `AI_INDIA_ONLY_OVERRIDE_ACK=I_UNDERSTAND`. While it is on, `BEDROCK_REGION` must be an India region.
- **Data residency**: `AWS_REGION` defaults to `ap-south-1` and `DATA_REGION` to `in`. A non-India
  value (anything except `ap-south-1`/`ap-south-2`, or a `DATA_REGION` other than `in`) is rejected
  unless `AWS_REGION_OVERRIDE_ACK=I_UNDERSTAND`.
- **Errors**: invalid configuration throws one `EnvValidationError` listing every invalid key.
  Messages never include the supplied values.
- **Secrets** are wrapped in `Secret`: `JSON.stringify`, `String()`, `util.inspect` and pino all
  print `[REDACTED]`. Call `reveal()` where the value is used.
- **Client env** holds only `NEXT_PUBLIC_*` keys. Importing `@causedeck/config/env` from a client
  module (`*.client.ts(x)`, `components/**`, `packages/ui/**`) fails lint, and calling it in a
  browser throws.
- **`SKIP_ENV_VALIDATION=1`** skips validation for Docker image builds only. Any other value is
  rejected. With validation skipped, values are raw strings (no `Secret` wrapping).
- **Kill switches**: every `KILL_<NAME>` key is parsed as a boolean into `env.killSwitches` (#22).

## Adding a key

1. Add the key and its metadata to `packages/config/src/env/schema.ts`, `providers.ts` or
   `client.ts`.
2. Run `pnpm env:example` and commit `.env.example`. `pnpm env:example:check` and the config unit
   tests fail if it is stale.
3. Add a row to the table below. A unit test checks that every schema key has a row.

## Keys

| Key | Type | Default | Required when | Owner issue | Real-credential issue |
|---|---|---|---|---|---|
| `NODE_ENV` | enum(development\|test\|production) | `development` | never (defaults to development) | #4 | — |
| `CI` | boolean | `false` | never | #3 | — |
| `LOG_LEVEL` | enum(fatal\|error\|warn\|info\|debug\|trace\|silent) | `info` | never (defaults to info) | #13 | — |
| `AWS_REGION` | string | `ap-south-1` | never (defaults to ap-south-1) | #4 | — |
| `DATA_REGION` | string | `in` | never (defaults to in) | #4 | — |
| `AWS_REGION_OVERRIDE_ACK` | literal(I_UNDERSTAND) | — | AWS_REGION or DATA_REGION outside India | #4 | — |
| `AI_INDIA_ONLY` | boolean | `true` | never (defaults to true) | #44 | — |
| `AI_INDIA_ONLY_OVERRIDE_ACK` | literal(I_UNDERSTAND) | — | NODE_ENV=production and AI_INDIA_ONLY=false | #44 | — |
| `ALLOW_MOCK_PROVIDERS` | boolean | `false` | never | #4 | — |
| `SKIP_ENV_VALIDATION` | literal(1) | — | never | #4 | — |
| `DATABASE_URL` | secret url | dev placeholder (non-prod only) | NODE_ENV=production | #6 | #116 |
| `DATABASE_URL_OWNER` | secret url | dev placeholder (non-prod only) | running migrations | #6 | #116 |
| `APP_URL` | url | `http://localhost:3000` (non-prod only) | NODE_ENV=production | #10 | — |
| `API_URL` | url | `http://localhost:3001` (non-prod only) | NODE_ENV=production | #14 | — |
| `BETTER_AUTH_SECRET` | secret (>= 32 chars) | dev placeholder (non-prod only) | NODE_ENV=production | #12 | #116 |
| `KEK_BASE64` | secret base64 (32 bytes) | dev placeholder (non-prod only) | NODE_ENV=production | #21 | #116 |
| `VAPID_PUBLIC_KEY` | string | — | VAPID_PRIVATE_KEY is set | #23 | #116 |
| `VAPID_PRIVATE_KEY` | secret | — | VAPID_PUBLIC_KEY is set | #23 | #116 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | url | — | never | #13 | — |
| `API_PORT` | port | `3001` | never (defaults to 3001) | #14 | — |
| `WORKER_PORT` | port | `3003` | never (defaults to 3003) | #15 | — |
| `GIT_SHA` | string | — | never | #13 | — |
| `EMAIL_PROVIDER` | enum(console\|ses\|smtp) | `console` | never (defaults to console) | #23 | — |
| `SES_REGION` | string | — | EMAIL_PROVIDER=ses | #23 | #110 |
| `SES_ACCESS_KEY_ID` | string | — | EMAIL_PROVIDER=ses | #23 | #110 |
| `SES_SECRET_ACCESS_KEY` | secret | — | EMAIL_PROVIDER=ses | #23 | #110 |
| `SMTP_URL` | secret url | dev placeholder (non-prod only) | EMAIL_PROVIDER=smtp | #23 | #110 |
| `AI_PROVIDER` | enum(mock\|bedrock\|sarvam) | `mock` | never (defaults to mock) | #44 | — |
| `BEDROCK_REGION` | string | `ap-south-1` | AI_PROVIDER=bedrock | #44 | #112 |
| `BEDROCK_ACCESS_KEY_ID` | string | — | AI_PROVIDER=bedrock | #44 | #112 |
| `BEDROCK_SECRET_ACCESS_KEY` | secret | — | AI_PROVIDER=bedrock | #44 | #112 |
| `BEDROCK_MODEL_ID` | string | — | AI_PROVIDER=bedrock | #44 | #112 |
| `SARVAM_API_KEY` | secret | — | AI_PROVIDER=sarvam | #44 | #113 |
| `STORAGE_PROVIDER` | enum(minio\|s3) | `minio` | never (defaults to minio) | #21 | — |
| `S3_ENDPOINT` | url | `http://localhost:9000` (non-prod only) | STORAGE_PROVIDER=minio | #21 | — |
| `S3_BUCKET` | string | `causedeck` (non-prod only) | always (dev default outside production) | #21 | — |
| `S3_ACCESS_KEY` | string | `causedeck` (non-prod only) | always (dev default outside production) | #21 | #116 |
| `S3_SECRET_KEY` | secret | dev placeholder (non-prod only) | always (dev default outside production) | #21 | #116 |
| `BILLING_PROVIDER` | enum(mock\|razorpay) | `mock` | never (defaults to mock) | #28 | — |
| `RAZORPAY_KEY_ID` | string | — | BILLING_PROVIDER=razorpay | #28 | #111 |
| `RAZORPAY_SECRET` | secret | — | BILLING_PROVIDER=razorpay | #28 | #111 |
| `RAZORPAY_WEBHOOK_SECRET` | secret | — | BILLING_PROVIDER=razorpay | #28 | #111 |
| `AUTH_GOOGLE_ENABLED` | boolean | `false` | never (defaults to false) | #12 | — |
| `GOOGLE_CLIENT_ID` | string | — | AUTH_GOOGLE_ENABLED=true | #12 | #109 |
| `GOOGLE_CLIENT_SECRET` | secret | — | AUTH_GOOGLE_ENABLED=true | #12 | #109 |
| `SENTRY_ENABLED` | boolean | `false` | never (defaults to false) | #13 | — |
| `SENTRY_DSN` | url | — | SENTRY_ENABLED=true | #13 | #115 |
| `NEXT_PUBLIC_APP_URL` | url | `http://localhost:3000` (non-prod only) | NODE_ENV=production | #10 | — |
| `KILL_*` | boolean | — | never | #22 | — |
