# 0048. Legal-gated billing flag and ledger retention

## Status

Proposed

## Date

2026-10-26

## Context

Fees and invoices to clients (#83) are legal-gated: GST treatment (forward or reverse charge, exempt supplies, pure-agent disbursements) needs counsel and CA review before any workspace relies on it (#120). [ADR-0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md) already gates such features behind a flag that stays off until staff record a legal acknowledgement. Part 1 adds the tables and inputs only. The tables hold a client's money history, so they meet two duties that pull apart: a ledger must be kept for the statutory period, and a client can ask for erasure under DPDP.

## Decision drivers

- Nothing billing-related is reachable while the flag is off.
- CauseDeck records money; it never moves it.
- Money is exact: integer paise, never a float.
- A ledger line outlives the person's details, but personal data does not outlive an erasure request.

## Considered options

| Option                                         | Verdict  | Reason                                                                              |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| Keep lines, anonymise the free text on erasure | Chosen   | Totals and tax figures stay auditable; no personal data remains                     |
| Delete a client's ledger lines on erasure      | Rejected | Breaks the books and the statutory retention duty                                   |
| Cascade deletes from person and matter         | Rejected | One erasure would silently remove invoices, payments and ledger lines               |
| Reuse `saas_invoice` for client invoices       | Rejected | Different supplier, numbering series and legal gate; kept apart (`saas-invoice.ts`) |

## Decision

- `fee_agreement`, `fee_invoice`, `fee_invoice_line`, `payment` and `client_ledger_entry` are tenant tables under FORCE RLS on `app.workspace_id` (`packages/db/src/schema/fees.ts`). Money columns are `bigint` paise with non-negative CHECKs; payments and ledger amounts are strictly positive, with a `direction` of debit or credit.
- Every consumer sits behind the legal-gated `invoices.enabled` flag ([flags](../engineering/flags.md)). The flag turns on only through the staff acknowledgement process (#120). Until then no route, action or job in the fees domain runs.
- Matter, person and invoice links are `NO ACTION` (checked at statement end, so a workspace delete still cascades): erasing or merging a person or deleting a matter cannot delete money records.
- Retention: ledger lines, invoices and payments are kept for the statutory period (eight years from the end of the financial year of the entry, to be confirmed by counsel). The DPDP sweep does not delete them. It clears `client_ledger_entry.description`, sets `anonymised_at` and anonymises the `person` row's details. A CHECK keeps an anonymised line free of description text.
- After the retention period, a later job may delete anonymised lines; that job is separate work and is not part of this decision.
- Issued invoices are immutable in later parts (#869): corrections are a credit entry, never an edit.

## Consequences

- Positive: books stay complete after an erasure; the flag keeps the feature dark.
- Negative: a person with ledger lines cannot be hard-deleted; the sweep must anonymise first.
- Accepted: the retention period is an assumption until counsel confirms it.

## Revisit when

- Counsel sets the retention period or a different anonymisation rule.
- Money movement (payment gateways for client fees) is considered.
