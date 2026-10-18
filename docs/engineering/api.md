# API conventions (`apps/api`)

`apps/api` is the public, versioned REST surface (spike §1, §2): webhooks (Razorpay, email inbound), future mobile clients and integrations. The web app calls domain services directly and does not go through it. It is a Hono app on `@hono/node-server`. Routes are defined with `@hono/zod-openapi`, so the zod schemas both validate requests and generate the OpenAPI document.

```sh
pnpm --filter @causedeck/api dev              # tsx watch src/server.ts on API_PORT (3001)
pnpm --filter @causedeck/api test             # app.request() against Testcontainers Postgres
pnpm --filter @causedeck/api openapi:export   # regenerate apps/api/openapi/v1.json
pnpm --filter @causedeck/api openapi:check    # fail if the committed document is stale
```

Endpoints outside the version prefix:

| Path | What |
|---|---|
| `/healthz`, `/readyz` | `@causedeck/observability` health handlers (#13). `readyz` runs a `db` check (`select 1`) |
| `/openapi.json` | OpenAPI 3.1 document |
| `/docs` | Scalar API reference |

## Layout

- `src/app.ts`: `createApp(deps)`. Everything stateful (db, Better Auth, logger, stores, clock) is injected.
- `src/server.ts`: the process entry point. It reads env, sets up telemetry, Better Auth and the server, and handles graceful shutdown.
- `src/middleware/*`: one concern per file.
- `src/routes/v1/*`: route groups. Handlers call `@causedeck/core` services and never contain SQL. `static-guards.test.ts` enforces this.
- `packages/validators/src/api/*`: request and response schemas, shared with clients.

Global middleware order:

1. request logger (opens the request context)
2. request id
3. secure headers
4. CORS
5. body limit
6. health and docs (no auth)
7. `/v1`, in this order:
   1. resolve principal
   2. CSRF
   3. rate limit
   4. idempotency
   5. route (`requireAuth`, then workspace, then validation, then handler)

## Versioning

- Every endpoint lives under `/v1`. Additive changes are allowed: new endpoints, new optional fields, new enum values that clients must tolerate.
- A breaking change creates `/v2`. The old version keeps working until it is retired.
- Deprecations are signalled with the `Deprecation` and `Sunset` headers (RFC 9745 and RFC 8594) and a `Link: <...>; rel="deprecation"` to the migration note.

## Authentication and security annotations

- `resolvePrincipal` sets `c.var.principal`, in this order of precedence:
  1. If an `Authorization: Bearer <token>` header is present, the token goes to the injected `BearerResolver`. API keys and personal access tokens arrive later. Until then every token is rejected, and an `Authorization` header never falls back to the cookie.
  2. Otherwise, the Better Auth session cookie.
- Define routes with `defineRoute()`:
  - By default it adds OpenAPI `security` (`sessionCookie` or `bearerToken`) and the `requireAuth` middleware, which runs before validation. An anonymous caller therefore gets 401, not 422.
  - `public: true` marks routes that authenticate in some other way (webhooks verify signatures). They get `security: []` and `x-public: true`.
- `assertRouteSecurity(app)` lists every `/v1` route that has neither annotation, including plain `get`/`post` handlers that bypass the OpenAPI registry. `security.test.ts` fails if the list is not empty.
- Workspace-scoped routes add `requireWorkspace(db)`:
  - The workspace id comes from the `:workspaceId` path param, or else the `x-workspace-id` header.
  - It must be a uuid (422), and the caller must be a member (403; the same answer whether or not the workspace exists).
  - Handlers run queries through `c.var.withWorkspace(fn)`, which uses `withWorkspace` from `@causedeck/db` to pin `app.workspace_id` and `app.user_id` for one transaction (spike §4.1, RLS in #19).
- Authorization beyond membership goes through `can()` (#20).

## Errors

Every error is `application/problem+json` (RFC 9457):

```json
{
  "type": "urn:causedeck:problem:validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request is invalid.",
  "code": "VALIDATION",
  "requestId": "4b0c…",
  "errors": [{ "path": "query.limit", "message": "Too small: expected number to be >=1" }]
}
```

| `code` | Status | When |
|---|---|---|
| `VALIDATION` | 422 | zod rejected `body`/`query`/`param`/`header`; malformed JSON; invalid cursor. `errors[]` has one entry per field |
| `UNAUTHENTICATED` | 401 | no valid session or token |
| `FORBIDDEN` | 403 | not a member, CSRF origin mismatch |
| `NOT_FOUND` | 404 | unknown path or resource |
| `CONFLICT` | 409 | idempotency key reused with a different request, or still in progress |
| `PAYLOAD_TOO_LARGE` | 413 | body over the limit |
| `RATE_LIMITED` | 429 | rate limit exceeded |
| `INTERNAL` | 500 | anything unexpected |

- The codes are stable. They extend the web `safeAction` set with `RATE_LIMITED` and `PAYLOAD_TOO_LARGE`, and live in `@causedeck/validators/api` (`API_ERROR_CODES`).
- Unexpected errors are logged with the `requestId`. The response is a generic `INTERNAL` with no message and no stack.
- `requestId` matches the `x-request-id` response header. A well-formed incoming `x-request-id` is reused.

## Pagination

- Lists are cursor-based: `?limit=&cursor=`. `limit` defaults to 50, max 100.
- Responses are `{ "data": [...], "nextCursor": "..." | null }`.
- Cursors are opaque (base64url keyset positions). Clients must not build or parse them. A tampered cursor gives 422 with `errors[0].path = "query.cursor"`.

## Idempotency

- `POST` requests may send `Idempotency-Key` (1–255 visible ASCII characters). Keys are scoped to the authenticated user and stored in `api_idempotency_key`, a global table.
- The first request claims the key and runs.
- Repeating the same method, path and body within 24 h replays the stored status, body and `Content-Type`/`Location` headers, with `Idempotency-Replayed: true`. The handler does not run again.
- The same key with a different request, or while the first is still running, gives 409 `CONFLICT`.
- 5xx responses and thrown errors release the key, so the client may retry with it.
- Keys expire 24 h after the first request. `IdempotencyStore.purgeExpired` deletes old rows (to be scheduled with the retention sweep).

## Rate limits

- Fixed window per route group:
  - **Default:** 120 requests/min per user, or per client IP when anonymous.
  - **Groups:** configured by path prefix in `createApp({ rateLimit: { groups } })`, e.g. `{ '/v1/exports': { limit: 10, windowMs: 60_000 } }`. Each group has its own counters.
- Every `/v1` response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds).
- Over the limit, the response is 429 `RATE_LIMITED` with `Retry-After`.
- The client IP comes from the socket. Set `trustProxy` only behind a proxy that overwrites `X-Forwarded-For`.
- The in-memory store suits a single instance. Swap in a shared `RateLimitStore` when the API scales out.
- Health endpoints are never limited.

## Body limits

- Bodies over 1 MB are rejected with 413.
- Webhook groups may raise or lower their own limit with `createApp({ bodyLimit: { groups: { '/v1/webhooks/razorpay': 5 * 1024 * 1024 } } })`.

## CORS, CSRF and headers

- **CORS:**
  - Only the configured origins (`APP_URL`) get `Access-Control-Allow-Origin`, echoed exactly, with `Access-Control-Allow-Credentials: true`. There is never a wildcard.
  - Exposed headers: `x-request-id`, `RateLimit-*`, `Retry-After`, `Idempotency-Replayed`.
- **CSRF:** a cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` must carry an `Origin` that is one of the configured origins, or it gets 403. Bearer-token callers are exempt, because the token is not an ambient credential.
- **Headers on every response:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site` and `X-Frame-Options: DENY`.
- Authenticated responses also get `Cache-Control: no-store`.

## Webhook verification pattern

Used by #28 (Razorpay) and, in the Capture milestone, by email inbound:

1. Register the route with `defineRoute({ public: true, ... })` under `/v1/webhooks/<provider>`, and set the provider's body limit.
2. Read the raw body (`await c.req.text()`) and verify the provider signature over those exact bytes before parsing. Use a constant-time compare. A bad signature gets 401 with no detail.
3. Parse and validate with zod only after verification.
4. Deduplicate on the provider's event id. Enqueue the work to pg-boss with that id as the idempotency key (see `once()` in `@causedeck/core/jobs`).
5. Answer 2xx quickly. Never do the work inline.

Secrets come from the env (#109 for Razorpay).

## OpenAPI

- `/openapi.json` is generated from the registered routes. `apps/api/openapi/v1.json` is the committed copy.
- `openapi.test.ts` and `pnpm --filter @causedeck/api openapi:check` fail when they differ. After changing a route or schema, run `openapi:export` and commit the result.
- Name shared schemas with zod's `.meta({ id })` in `@causedeck/validators/api` so they appear under `components.schemas`.

## Graceful shutdown

On `SIGTERM` (or `SIGINT`) the server:

1. stops accepting connections
2. closes idle keep-alive sockets
3. waits up to 10 s for in-flight requests
4. force-closes whatever is left
5. ends the database pool and telemetry
6. exits 0

The Docker image (`infra/docker/api.Dockerfile`) runs node directly so the signal reaches it.
