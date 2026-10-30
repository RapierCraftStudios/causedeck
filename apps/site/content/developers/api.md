# CauseDeck developer API (v1)

Read case status, cause lists, orders and notices, and receive change webhooks. The machine-readable
spec is [`apps/api/openapi/v1.json`](../../../api/openapi/v1.json) (OpenAPI 3.1); the API also serves
it at `/openapi.json` and an interactive reference at `/docs`.

## Authentication, scopes and quotas

Create an API key in your workspace and send it as a bearer token:

```
Authorization: Bearer <api key>
```

A key belongs to one workspace and carries scopes. A call to a route without the matching scope is
rejected.

| Scope             | Allows                           |
| ----------------- | -------------------------------- |
| `cases:read`      | `GET /v1/cases/{cnr}`            |
| `causelists:read` | `GET /v1/causelists`             |
| `orders:read`     | `GET /v1/orders`                 |
| `notices:read`    | `GET /v1/notices`                |
| `webhooks:write`  | `/v1/webhook-endpoints` (manage) |

Each call is metered against the key's monthly quota. Responses carry `x-quota-used`; when the quota
is used up the API answers `429` with `x-quota-limit` and `x-quota-used`. Keys can only call the
public paths in this document.

## Errors

Errors are `application/problem+json` using the shared `Problem` schema in the spec.

## Data sources

Records carry `as_of` (when the record was captured) and `official_url` (a link to the court's own
copy, or `null` where there is none). Only data from cleared sources or contributed copies is served,
and personal data only for your own matters (see the court data posture). Where the data comes from,
and the attribution each source's licence requires, is on the
[Data sources and licences](/legal/data-sources) page.

## Endpoints

### `GET /v1/cases/{cnr}`

Status of one case by CNR.

```
curl -H "Authorization: Bearer $KEY" https://<api-host>/v1/cases/<CNR>
```

### `GET /v1/causelists`

Cause lists. Query: `forum`, `date` (ISO date), `advocate`, `limit`.

```
curl -H "Authorization: Bearer $KEY" "https://<api-host>/v1/causelists?forum=<forum>&date=2026-10-24"
```

### `GET /v1/orders`

Orders. Query: `case` (16-character CNR), `limit`.

```
curl -H "Authorization: Bearer $KEY" "https://<api-host>/v1/orders?case=<CNR>"
```

### `GET /v1/notices`

Notices. Query: `forum`, `limit`.

```
curl -H "Authorization: Bearer $KEY" "https://<api-host>/v1/notices?forum=<forum>"
```

## Webhooks

Register an HTTPS receiver with `POST /v1/webhook-endpoints` (the signing secret, `whsec_...`, is
returned once). List endpoints with `GET /v1/webhook-endpoints`; remove one with
`DELETE /v1/webhook-endpoints/{id}`.

Event types: `status.changed`, `order.added`, `causelist.matched`, fired for watched items.

Each delivery carries `x-causedeck-event`, `x-causedeck-delivery` (stable across retries),
`x-causedeck-timestamp` (unix seconds) and `x-causedeck-signature`. The signature is
`v1=<hex>`, the HMAC-SHA256 of `<timestamp>.<raw body>` under your endpoint secret. Recompute it,
compare in constant time, and reject old timestamps. Failed deliveries are retried.
