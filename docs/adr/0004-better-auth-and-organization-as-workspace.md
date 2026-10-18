# 0004. Better Auth with the organization plugin as workspaces

## Status

Accepted

## Date

2026-10-18

## Context

Users are advocates, juniors and clerks. They sign in from phones in court, and one person can belong to several workspaces (chambers). Credentials for identity providers are human-provided (D-040). Session data and user records must stay in India with the rest of the data. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Auth row) and [§6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture) (Sessions), and in D-038.

## Decision drivers

- Users and sessions are stored in our own India-hosted Postgres.
- Organizations with roles (owner, advocate, junior, clerk, viewer) map directly to workspaces.
- Google OAuth, email magic link and passkeys, plus 2FA for owners.
- Works in dev and CI without real credentials.

## Considered options

| Option                                                     | Verdict  | Reason                                                                                           |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Better Auth (Drizzle adapter) with the organization plugin | Chosen   | Self-hosted in our database; organizations, passkeys, magic link and 2FA as plugins              |
| Supabase Auth                                              | Rejected | Couples auth to the Supabase platform and its hosting regions; no first-class organization model |
| Clerk                                                      | Rejected | User data is held by a hosted third party outside India; per-user pricing                        |
| Auth.js (NextAuth)                                         | Rejected | No built-in organizations, roles, passkey management or 2FA; much of it would be custom code     |

## Decision

- Better Auth with the Drizzle adapter, configured in `packages/auth`.
- Sign-in methods: Google OAuth, email magic link and passkeys. Owners must use 2FA.
- **The Better Auth organization plugin is the workspace.** Membership roles are owner, advocate, junior, clerk and viewer. The active organization sets `app.workspace_id` for RLS (ADR 0003).
- Sessions are httpOnly, Secure, SameSite=Lax cookies, with CSRF protection on server actions.
- Google client credentials and the email transport are `needs-human`. Dev and CI use a console transport.

## Consequences

- Positive: identity data stays in India. Workspaces and roles need no custom membership model.
- Negative: we operate auth ourselves (key rotation, security updates, abuse controls).
- Negative: we depend on Better Auth's plugin API, which is younger than the alternatives'.

## Revisit when

- Enterprise customers require SAML or SCIM that Better Auth cannot provide.
- A serious security issue in Better Auth is not fixed promptly.

## Links

- [Spike §6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture)
- [ADR 0003](0003-postgres-17-pgvector-drizzle-rls-multitenancy.md)
- [DECISIONS.md](../../DECISIONS.md) D-038, D-040
