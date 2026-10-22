# 0024. ICS import and the private calendar feed

## Status

Proposed

## Date

2026-10-23

## Context

A lawyer's phone calendar is where hearing dates already live. PRD CA-5 and docs/product/09 §2.5 (O8) and §3 ask for two things: **calendar out**, a private feed of confirmed hearings and deadlines the lawyer subscribes to, and **calendar in**, an ICS import so years of diary entries need no retyping. OAuth calendar read is v1, legal-gated and not built here (CA-11). Two rules shape the design. Calendar providers fetch a feed on their own servers outside India, so the URL is a secret and the content is minimal by default (docs/product/09 §8). And an imported event never silently changes a hearing date: a differing date is a proposal or a conflict ([ADR 0016](0016-proceeding-state-machine-and-next-date-rules.md), [ADR 0023](0023-automation-ladder-and-undo.md)). This ADR records how #53 is built.

## Decision drivers

- A feed URL is a bearer credential: unguessable, hashed at rest, revocable and rotatable at once, 404 for everything else.
- What leaves India must be the least that is useful: no party names unless asked, no sensitive matters, nothing unconfirmed.
- An import is deterministic (no model), cannot overwrite a confirmed date, and stores nothing about events that are not hearings.
- The feed and the import write nothing outward: no invitation, attendee, email or message.
- Feed state (SEQUENCE, cancelled dates) must survive between fetches so calendar apps see updates and removals.

## Considered options

| Option                                                                  | Verdict  | Reason                                                                                                      |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| A feed per (workspace, user) in a new `ics_feed` table                  | Chosen   | Scope, party names, last fetch, revocation and the disclosure version are per user                          |
| Reuse the workspace-wide `workspace_integration` row of kind `ics_feed` | Rejected | One token per workspace has no owner to apply `can()` to and none of the per-feed columns                   |
| Resolve the token with a `SECURITY DEFINER` function                    | Chosen   | The workspace is unknown until the token resolves and every table is under FORCE RLS; same shape as 0053    |
| Make the feed route use the owner database role                         | Rejected | It would bypass row-level security for the whole request, not only for one lookup                           |
| Persist per-feed UID state (`ics_feed_event`: SEQUENCE, hash, snapshot) | Chosen   | SEQUENCE bumps and 30-day CANCELLED events cannot be derived from the current rows alone                    |
| Recompute SEQUENCE from `updated_at`                                    | Rejected | A listing's date moves by replacing the canonical row, so the old UID would just vanish without a cancel    |
| Parse with `ical.js`, resolve zones with `Intl`                         | Chosen   | Handles RRULE, EXDATE and malformed input; IANA and Windows zone names work without a VTIMEZONE in the file |
| Hand-written parser                                                     | Rejected | RFC 5545 folding, recurrence and time zones are easy to get subtly wrong                                    |

## Decision

- **Tables** (migration 0056, FORCE RLS): `ics_feed` (`token_hash` unique, `scope` `mine` or `workspace`, `include_parties`, `created_at`, `rotated_at`, `last_fetched_at`, `revoked_at`, `disclosure_version`; one active feed per user per workspace), `ics_feed_event` (per feed and UID: `sequence`, `content_hash`, `changed_at`, `cancelled_at`, `snapshot`) and `ics_import_event` (per calendar UID, or UID and day for an RRULE instance: highest `sequence`, `capture_id`, `proposal_id`, `anchor_id`, review status and the hearing-like event's own text). The old `workspace_integration` kind `ics_feed` stays in the schema and is unused; the integrations page links to the calendar page instead.
- **Token.** 32 random bytes, base64url, only the sha256 hex is stored. The full URL is returned once by create and rotate. `app_ics_feed_resolve(token_hash)` returns the workspace, feed, user, scope and options of a non-revoked feed and nothing else; the route compares the hash again in constant time. Unknown, revoked, flag-off, malformed and no-longer-permitted feeds are the same bodyless 404. 60 requests per hour per feed, then 429.
- **Content.** One all-day `VEVENT` per confirmed (not `proposed`) canonical listing (`UID listing-{id}@causedeck`) and per open obligation with a due date (`obligation-{id}@causedeck`), with an `Asia/Kolkata` `VTIMEZONE`. `SUMMARY` is `Hearing: W.P. 12345/2026 (Court 12, Item 37)`, `LOCATION` the forum and hall, `DESCRIPTION` a deep link that needs sign-in. Party names and the obligation's own text appear only when the feed's `includeParties` is on (off by default, with the reason shown). Sensitive matters are never in a feed. There is no `ATTENDEE`, `ORGANIZER`, `METHOD` or alarm.
- **Scopes.** `mine` is the matters the user owns that they may read (`matterVisibilityPredicate`, so restrictions apply; the matter graph has no separate assignment table yet, so "assigned" adds nothing today), for any role with `matter.read`. `workspace` is owners only, chosen explicitly, and is re-checked at every fetch so a demoted owner's feed stops.
- **Change and removal.** `SEQUENCE` starts at 0 and goes up whenever an event's content changes. A removed date stays as `STATUS:CANCELLED` for 30 days (SEQUENCE bumped once), then is dropped; a date that returns is confirmed again with a higher SEQUENCE. The ETag is the sha256 of the body (DTSTAMP is the time of the last change, so an unchanged feed is byte-identical) and `If-None-Match` gets 304. `Cache-Control: private, max-age=300`.
- **Disclosure.** Creating a feed needs the member to acknowledge "Your calendar app may fetch this feed from servers outside India. We keep the content minimal." The acknowledged version (`CALENDAR_DISCLOSURE_VERSION`) is stored on the feed.
- **Import.** The `ics` capture channel (opt-in per workspace, ADR 0021) feeds `capture.process`, which calls `runIcsImport` for that channel. Events are scored for hearing-likeness (case number via the adapter normalisers, keywords, location, time of day); the rest are counted and dropped, and events that look personal and sensitive (medical and the like) or belong to a sensitive matter are dropped too. A hearing-like event is matched to exactly one readable proceeding of the importer's workspace by case type, number and year (the number alone when the printed type finds nothing, and only if one proceeding has it); otherwise it is listed unmatched. Matched events become `next_date` drafts with `source.input = calendar`; the engine stages a proposal, or a conflict card when the day differs from a confirmed date. An event for a day that is already confirmed and names an item number is a `listing_update`. The importer never confirms or overwrites a date.
- **Evidence.** Each matched event gets a `calendar_event` anchor (UID, DTSTAMP and the VEVENT text) on a document of the matched matter that holds that one event as its own `.ics`, so the other entries of a diary file never reach another matter.
- **Idempotence.** `ics_import_event` is unique per workspace and UID. Only a higher SEQUENCE of a known UID is processed again; it dismisses that event's earlier open proposal and stages a new one. The capture result reports "3 new, 2 changed, 10 unchanged".
- **Review.** Each row is confirmed or skipped on its own (confirm is the engine's `acceptProposal`, with its undo); there is no bulk confirm. An unmatched event can be attached to a matter as an undated note (a manual capture hinted at the matter) or skipped. No matter is created from a calendar event.

## Consequences

- Positive: the feed is the "already in my phone" win while the least possible leaves India; revocation and rotation are immediate.
- Positive: an import cannot change a date by itself, and a re-import never duplicates proposals.
- Negative: a feed fetch writes (feed state and `last_fetched_at`); the writes are small and skipped when nothing changed apart from the timestamp.
- Negative: a floating time or an unknown zone is read as India time (a diagnostic is recorded for an unknown zone).
- Negative: the printed case type is a guess from the words before the number; the number-only fallback needs exactly one proceeding to match.
- Negative: `ical.js` is MPL-2.0 (file-level copyleft; used unmodified as a dependency).

## Revisit when

- Google or Outlook OAuth calendar read is built (v1, legal-gated), which makes the feed less central.
- Matter assignments exist as data (extend `mine` to assigned matters).
- A feed is fetched often enough that writing state on each fetch matters (move it to the worker).
