# Runbooks

Operational runbooks for CauseDeck: reviewed, testable documents with owners and drills (#103). A CI check
(`test/links.test.ts`) fails when a runbook lacks a required heading, an `Owner`, a `Last drilled` field, a
working internal link, or contains something that looks like a secret.

Owner: Engineering lead
Last drilled: not yet drilled (see [drills](drills/README.md))

## Purpose

One place to find what to do, who does it and how it is proven. Legal wording and contact details are owned by
counsel (#117) and are marked `Counsel to confirm` until that issue is complete. Contact numbers and secrets
are never written here: they are references to the secret manager.

## Triggers

Open the matching runbook when an alert fires ([on-call](on-call.md)), when a security or privacy event is
suspected, or when a scheduled rotation or drill falls due.

## Roles

| Role                   | Does                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| On-call primary        | First response, severity call, starts the incident ticket                           |
| Incident commander     | Runs the incident, owns the timeline and the clocks (the primary unless handed off) |
| Engineering lead       | Owner of every runbook; approves emergency key rotation and customer notices        |
| Founder                | Approves regulator and customer communication with counsel                          |
| Counsel                | Confirms legal wording, reporting duty and contacts (#117)                          |

## Index

| Runbook                                    | Use it for                                          | Owner            |
| ------------------------------------------ | --------------------------------------------------- | ---------------- |
| [on-call](on-call.md)                      | Rotation, severity P0 to P3, escalation, comms plan | Engineering lead |
| [cert-in-6h](cert-in-6h.md)                | Reportable cyber security incident, 6-hour clock    | Engineering lead |
| [dpdp-breach](dpdp-breach.md)              | Personal data breach, Processor duty to customers   | Engineering lead |
| [key-rotation](key-rotation.md)            | KEK, DEKs, secrets, SSH/deploy and backup keys      | Engineering lead |
| [restore](restore.md)                      | Point-in-time restore (RPO 15 min, RTO 4 h)         | Engineering lead |
| [dr-hyderabad](dr-hyderabad.md)            | Losing the VPS                                      | Engineering lead |
| [log-archive](log-archive.md)              | Lean 180-day log archive (no Loki), evidence retrieval | Engineering lead |
| [court-day-freeze](court-day-freeze.md)    | Deploy freeze in court windows (owned by #100)      | Engineering lead |
| [workspace-deletion](workspace-deletion.md) | Workspace deletion and crypto-erase                 | Engineering lead |
| [data-ops](data-ops/runbook.md)            | Source and adapter operations                       | Engineering lead |

Templates: [incident report](templates/incident-report.md), [customer notice](templates/customer-notice.md),
[post-incident review](templates/post-incident-review.md), [evidence checklist](templates/evidence-checklist.md).
Tools: `infra/scripts/runbooks/evidence-export.sh`, `infra/scripts/runbooks/rotate-kek.sh`.

## Severity matrix

| Priority | Meaning                                              | Acknowledge        | Runbooks                            |
| -------- | ---------------------------------------------------- | ------------------ | ----------------------------------- |
| P0       | Data loss risk, product down, confirmed breach       | 15 minutes, any hour | on-call, restore or incident runbook |
| P1       | Degraded for advocates, suspected security incident  | 30 minutes         | on-call, cert-in-6h                 |
| P2       | Needs a person within a working day                  | Next business day  | on-call                             |
| P3       | Improvement, trend, documentation                    | Weekly review      | on-call                             |

## Steps

1. Pick the runbook from the index and start the incident ticket (on-call).
2. Note the **detection time** in UTC. Every clock in these runbooks starts there.
3. Follow the runbook; record actions in the ticket as you go.

## Communications

No automated outbound messages go to courts, regulators, customers or any third party. Every notice is drafted
from a template, **approved by a human**, and **sent by a human**. This is the no auto-send guardrail.

## Evidence

Keep the ticket, the exported logs (`evidence-export.sh`) and the filled templates. Store drill records in
[drills](drills/README.md).

## Verification

`node --experimental-strip-types --no-warnings --test infra/runbooks/test/` checks structure, links and secrets.
The drill calendar below shows what has been exercised.

## After action

File a [post-incident review](templates/post-incident-review.md) within 5 working days of every P0/P1, update the
runbook and its `Last drilled` field.

## Drill calendar

| Runbook      | Drill                                   | Cadence                | Record                                              |
| ------------ | --------------------------------------- | ---------------------- | --------------------------------------------------- |
| cert-in-6h   | Tabletop (reportable incident scenario) | Before launch, yearly  | [pending](drills/pending-launch-drills.md)          |
| dpdp-breach  | Tabletop (customer notification)        | Before launch, yearly  | [pending](drills/pending-launch-drills.md)          |
| restore      | Technical (monthly human, weekly CI)    | Monthly                | [pending](drills/pending-launch-drills.md)          |
| dr-hyderabad | Technical rehearsal                     | Before launch, yearly  | [pending](drills/pending-launch-drills.md)          |
| key-rotation | Technical (`rotate-kek.sh` on staging)  | Before launch, yearly  | [pending](drills/pending-launch-drills.md)          |

Before launch every drill above needs a signed record under `drills/`; the dates in `Last drilled` are then
updated from `not yet drilled`.
