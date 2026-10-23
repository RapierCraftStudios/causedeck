# Court data: DPDP posture

Status: draft for counsel (#118). Decision: [D-048](../../DECISIONS.md). Issue: #486.
Items marked ⚖ need counsel's opinion before they are relied on; they are collected in the last section.

Party names in court records are personal data under the DPDP Act (D-003). This document says what
CauseDeck does with them in the shared (global) court-data layer and which controls enforce it.

## Scope: the stores

| Store | Holds | Party data | Control |
| --- | --- | --- | --- |
| `contributed_document` | Public cause lists and published orders a workspace opted in to share (#485) | Yes | Retention job, erasure service (below) |
| `fetch_log` | One row per external fetch: source id, URL hash, status, tier, cost (#479) | No (content-free) | None needed; the app role can only insert and select |
| `source` | The source registry (#478) | No | Carries each source's data class and retention |
| Raw judgments corpus (#484) | Judgments and orders with provenance | Yes | Not built yet: it must use the same retention and erasure paths before it ships |

Workspace-owned data (matters, documents, the contribution ledger) is covered by the workspace
lifecycle (export, deletion, memory erasure), not by this document.

## Purpose limitation

Court data is processed for two purposes only: the lawyer's own matters (listings, status, notices
that concern them) and the court's own public listing, reused so other advocates see the same
public document. It is not used to profile individuals, rate judges or advocates, or build
person-level datasets (D-049, D-050). ⚖ Whether reuse across workspaces stays inside the original purpose of publication.

## Lawful basis per data class

Every source carries a `data_class` (`source.data_class`, default `personal`):

| Data class | Meaning | Basis (proposed) | API exposure |
| --- | --- | --- | --- |
| `personal` | Records name parties or other people | ⚖ Legitimate use of data made publicly available by the person or under law; the advocate's own matters | Never |
| `mixed` | Some records name people, some do not | As `personal` until split | Never |
| `non-personal` | Notices, holiday lists, bench rosters without party data | Not personal data | Allowed once the API exists (#487) |

An untagged source is `personal`: the safe value. The API layer must call `exposableThroughApi` and
serve only `non-personal` sources. ⚖ Whether any court record may be exposed through the API.

## Retention per source kind

Retention is set per source in the registry (`source.retention_days`, default 30) and enforced by
the daily job `system.court-data.retention` (04:15 IST). A shared copy past
`least(retention_until, contributed_at + retention_days)` is blanked: its content is removed and
`withdrawn_at` is set. The row (hash, source, dates) stays so the same text is not stored again.
Shortening a source's retention applies to copies already stored.

| Source kind | Retention | Note |
| --- | --- | --- |
| `court` (cause lists, orders) | Registry value per source; 30 days until a source says otherwise | ⚖ The right period per court |
| `notice`, `news`, `licensed`, `corpus` | Registry value per source | ⚖ Corpus retention (#484) |

Each run that blanks anything writes a `court_data.expired` audit event (counts and source ids).

## Erasure and correction requests

A person can ask for their name to be removed from the shared stores. Staff (ops or admin) file the
request through `eraseCourtDataSubject`: it masks the name (case-insensitive, any spacing) in every
live shared copy with `[erased]` and writes a `court_data.erased` audit event holding a hash of the
name, the count and the reason, never the name. The stored hash of the original text is kept so
contributing the unmasked text again lands on the masked copy.

Where the law does not allow erasure (a court order that must stay public, a legal-hold duty), the
request is declined and the decision and its reason are recorded by staff. ⚖ Which records may
lawfully be erased. Correction requests are handled by the contributing workspace and the source;
⚖ whether CauseDeck owes a correction channel for text it did not author. Requests are answered within
30 days. ⚖ The statutory period.

## No resale of personal data

Personal data from court records is never sold, licensed or bulk-exported to third parties, and it
is not part of any paid API tier. ⚖ Wording for institutional and API contracts.

## Republishing policy

Before any API exposes court data, a public policy states what is republished, from which sources,
and how a person asks for removal. Until then nothing from `personal` or `mixed` sources leaves the
product. No full-text republication of copyrighted news (D-048). ⚖ Publishing court text on the open web and indexing by search engines.

## Processors

| Processor | Role | Data | Status |
| --- | --- | --- | --- |
| AlterLab | Fetches public pages for the governed fetch layer, India proxy | Public page content in transit; no workspace data | ⚖ Processor agreement (#488) |

Other processors (hosting, storage) are listed in the workspace privacy documents. Residency
follows D-009: stores stay in India.

## Breach handling

A breach touching these stores follows the platform incident process: contain, assess, record in the
audit log, notify the Data Protection Board and affected people as the law requires. ⚖ Whether a
breach of already-public court text is notifiable, and the notification timeline.

## ⚖ Items for counsel

1. Whether reuse across workspaces stays inside the purpose of publication.
2. The lawful basis for `personal` and `mixed` sources.
3. Whether any court record may be exposed through the API.
4. The retention period per court and for the raw corpus (#484).
5. Which records may lawfully be erased, and which erasure requests must be declined.
6. Whether a correction channel is owed for text CauseDeck did not author.
7. The statutory period for answering erasure and correction requests.
8. Contract wording that bars resale of personal data (institutions, API).
9. Publishing court text on the open web and search-engine indexing.
10. The AlterLab processor agreement (#488).
11. Whether a breach of already-public court text is notifiable, and the timeline.
