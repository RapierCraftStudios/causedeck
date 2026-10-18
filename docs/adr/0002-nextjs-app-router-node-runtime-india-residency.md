# 0002. Next.js App Router on the Node runtime with India data residency

## Status

Accepted

## Date

2026-10-18

## Context

The product app holds privileged legal matter data. Primary data and logs must stay in India (D-009, D-033), and CERT-In requires 180-day logs within Indian jurisdiction. The mobile client is an installable PWA, not a native app (D-036, which supersedes D-008). The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Web app, Marketing site and API rows), [§3.1](../engineering/13-technical-architecture-spike.md#31-bootstrap-stage-a-launch-to-about-1000-paid-seats) and [§3.3](../engineering/13-technical-architecture-spike.md#33-cloudflare-and-data-residency), and in D-036 and D-037.

## Decision drivers

- Matter data must not be processed or terminated outside India.
- A single React codebase for desktop, tablet and Android (PWA with Web Share Target).
- Server-rendered pages, and mutations without a separate HTTP hop.
- Low bootstrap cost (about ₹6–12k per month for infrastructure).

## Considered options

| Option                                      | Verdict  | Reason                                                                                                            |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Next.js App Router, Node runtime, India VPS | Chosen   | RSC and Server Actions with code that runs only in India; standard containers                                     |
| Next.js on the edge runtime / Vercel        | Rejected | Edge functions run in non-India regions by default, which breaks residency                                        |
| Remix or a Vite SPA plus a separate API     | Rejected | An extra HTTP hop for every mutation, and the PWA and RSC ecosystem around Next.js is weaker                      |
| App and API proxied through Cloudflare      | Rejected | TLS would terminate at Cloudflare edges outside India; allowed only if the founder accepts that trade-off (D-037) |

## Decision

- `apps/web` uses Next.js (latest stable) with the App Router, React Server Components and Server Actions for UI mutations. Route Handlers serve webhooks and uploads. It always runs on the **Node runtime, never edge**, so that data stays in the India region.
- `apps/api` is Hono on Node (`/v1`, OpenAPI) for webhooks, integrations and future mobile. The web app calls domain services directly.
- `apps/site` is a Next.js static export on Cloudflare Pages, with no tenant data.
- **Cloudflare is DNS-only for `app.` and `api.`**, so TLS terminates on the India VPS (Caddy) and matter data never transits non-India edges.
- Static assets (`/_next/static`, fonts, images) are served from `static.<tld>`, proxied and cached through Cloudflare. They carry no tenant data.
- Cloudflare WAF on the app is used only if the founder accepts the residency trade-off (D-037). Until then, Caddy rate limits and fail2ban protect the app.

## Consequences

- Positive: residency holds by construction. Standard Docker images run unchanged at every scale stage.
- Negative: no edge rendering or Cloudflare WAF for the app at bootstrap, so latency outside India is higher.
- Negative: static assets need their own host (`static.<tld>`), which the app and its CSP must reference.

## Revisit when

- Spike §3.2 Stage B triggers: p95 latency > 400 ms, DB CPU > 60%, or > 1k seats. App containers then move behind a load balancer on 2+ nodes.
- Stage C trigger: > 10k seats or several teams. Containers then move to ECS Fargate or k3s in ap-south-1.
- The founder accepts the Cloudflare residency trade-off for WAF (D-037), or Cloudflare offers India-only TLS termination.

## Links

- [Spike §3.1–§3.3](../engineering/13-technical-architecture-spike.md#3-runtime-topology)
- [DECISIONS.md](../../DECISIONS.md) D-009, D-033, D-036, D-037
