# 0049. Client status links: hashed token, security-definer read, no send

## Status

Proposed

## Date

2026-10-28

## Context

PRD #88 lets an advocate give a client a short, expiring, read-only status page. The page is signed out, so the token is the only credential, and what it shows is client-facing communication, which counsel must clear (#117). The legal-gated flag `status_links.enabled` keeps it dark until then.

## Decision drivers

- A leaked database must not leak working links.
- A viewer with a token must never reach anything but the authored note.
- Nothing may reach the client unless the advocate shares the link themselves.
- Viewer data is kept to what the advocate needs ("Viewed 3 times") and no longer than the link.

## Considered options

| Option                                                                           | Verdict  | Reason                                                                 |
| -------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| 256-bit random token, SHA-256 stored, read by a narrow SECURITY DEFINER function | Chosen   | Same shape as brief sharing (ADR 0038); no table access for the app    |
| Store the token                                                                  | Rejected | A database read would give working links                               |
| Send the link from CauseDeck (email, WhatsApp)                                   | Rejected | An outbound channel to a client is a legal surface; advocates share it |
| Render live matter data                                                          | Rejected | Leaks party names, notes and documents; only authored fields are shown |

## Decision

- The token is 256 random bits; only its SHA-256 is stored. The full URL is returned once at creation.
- `status_link` and `status_link_access` carry `workspace_id` under FORCE row-level security. The signed-out read goes through an owner-defined function that takes the hash and returns the authored payload, the advocate's name, the language and expiry, and nothing else.
- Expiry defaults to 7 days, at most 30 from creation; revoking is audited and immediate. An expired, revoked, unknown or rate-limited link, and any link while the flag is off, gets the same generic answer (a 404 while off).
- Views are rate limited per IP and token. `status_link_access` stores the time and a coarse user-agent class; the IP is only hashed into the rate-limit key.
- The module imports no transport and a static test enforces it. The page is GET only, with a nonce CSP, `Referrer-Policy: no-referrer`, `noindex` and no third-party requests.
- `system.status-link.retention` clears payloads 30 days after expiry and never reads the flag. Links are exported (without the hash) and removed in workspace deletion.

## Consequences

- A lost URL cannot be recovered; the advocate creates a new link.
- Counsel clearance (#117) is the only gate to turning the flag on.
