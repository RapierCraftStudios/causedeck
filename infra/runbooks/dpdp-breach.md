# Runbook: DPDP personal data breach

Owner: Engineering lead
Last drilled: not yet drilled
Counsel-owned sections are marked `Counsel to confirm` until #117 is complete.

## Purpose

Handle a personal data breach under the Digital Personal Data Protection Act, 2023. The advocate or chamber is
the Data Fiduciary; CauseDeck is the Processor (PRD §9). The first Processor duty is to tell the affected
customer promptly so they can meet theirs.

## Triggers

Confirmed or suspected unauthorised access to, loss of, disclosure of or alteration of personal data held for a
workspace: a leaked credential with data access, a cross-tenant exposure, a lost backup or device, a wrong
recipient, a vendor notice. Also any event that opened [cert-in-6h](cert-in-6h.md) and may involve personal data.

## Roles

| Role               | Does                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| Incident commander | Runs the incident, keeps the breach register entry                                      |
| Engineering lead   | Assesses scope, approves customer notices                                               |
| Counsel            | Confirms duties, wording and any Board or principal notification (`Counsel to confirm`) |
| Support lead       | Delivers approved notices to customers (a human sends them)                             |

## Steps

1. **Assess** (target: within 2 hours). What data, which workspaces, how many principals, since when, is it
   still happening. Use ids only. Use the [evidence checklist](templates/evidence-checklist.md) and
   `infra/scripts/runbooks/evidence-export.sh` for the log range.
2. **Contain**. Revoke access, rotate affected secrets ([key-rotation](key-rotation.md)), disable the faulty
   path, restore from [restore](restore.md) only if integrity is the problem. Never restore a deleted workspace.
3. **Decide** with counsel: is it a personal data breach, which customers are affected, and what is owed to
   whom. Decision tree: affected workspaces found? **No**: record the assessment in the register and stop.
   **Yes**: notify those customers (step 4), then ask counsel about the Board and principals (step 5).
4. **Notify customers (Data Fiduciaries)** without undue delay, using the
   [customer notice](templates/customer-notice.md). One notice per affected workspace owner.
5. **Board and affected principals**: the Data Fiduciary decides and sends; where CauseDeck is asked to assist,
   provide facts and a draft. Obligations and deadlines: `Counsel to confirm`.
6. **Record keeping**: add the register entry (what, when, who was told and when, approval names, decisions) to
   the incident ticket and keep it with the evidence for as long as counsel advises (`Counsel to confirm`).

## Communications

- Customers first (step 4), then the Board and principals only as counsel confirms.
- No automated outbound messages go to courts, regulators, customers or any third party. Notices are drafted
  from the template, approved by a human (engineering lead plus counsel for wording) and sent by a human after
  approval; the approval and the send time go in the ticket.
- Notices state facts and ids only: no personal data and no matter content.

## Evidence

Encrypted log archive with manifest and hash (`evidence-export.sh`), the breach register entry, the approved
notices with approver names, the assessment notes and the containment timeline.

## Verification

Every affected workspace owner has a recorded notice (sent time, sender, approver); containment is verified
(the credential no longer works, the path is closed, alerts quiet); the register entry is complete.

## After action

[Post-incident review](templates/post-incident-review.md) within 5 working days; update the runbook and
`Last drilled`; file the tabletop or incident record under [drills](drills/README.md).
