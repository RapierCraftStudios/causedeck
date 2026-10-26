# 0043. Incident and key rotation policy

## Status

Proposed

## Date

2026-10-25

## Context

CauseDeck holds advocates' client data in India. The CERT-In directions require reporting cyber security
incidents within 6 hours of detection, and the DPDP Act makes the advocate or chamber the Data Fiduciary with
CauseDeck as Processor (PRD §9). Keys (KEK, per-workspace DEKs, secrets, SSH, backup) need a rotation cadence and
an emergency path. #103 turns this into runbooks in `infra/runbooks`.

## Decision drivers

- A missed legal clock cannot be recovered; a withdrawn report can.
- Legal wording belongs to counsel (#117); structure and technical steps belong to engineering.
- The no auto-send guardrail applies to every notice.
- Procedures only count when exercised and the evidence is stored.

## Considered options

| Option                                     | Verdict  | Reason                                                   |
| ------------------------------------------ | -------- | -------------------------------------------------------- |
| Start the clock at detection, report early | Chosen   | A withdrawn report can be recovered, a missed one cannot |
| Report only after confirmation             | Rejected | Risks missing the 6-hour window                          |
| Automate customer notices                  | Rejected | Violates the no auto-send guardrail                      |

## Decision

- The clock starts at **detection** (first awareness by a person or alert), is written in UTC in the incident
  ticket, and the report is due at detection + 6 h. When unsure whether an event is reportable, start the clock.
- The incident commander owns the clock; the engineering lead owns each runbook and approves emergency rotation;
  counsel confirms wording and reportability (`Counsel to confirm` markers stay until #117 completes).
- As Processor, CauseDeck notifies the affected customer first (DPDP runbook); Board and principal notification is
  the Data Fiduciary's, with CauseDeck assisting.
- No automated outbound message goes to a court, regulator, customer or other third party. Notices are drafted from
  templates, approved by a human and sent by a human.
- Evidence comes from the 180-day India log store (Loki, #102), exported by `evidence-export.sh` into an encrypted
  archive with a manifest and hash, stored in India.
- Rotation cadence: KEK, backup and evidence keys 12 months; session, API, SSH and deploy keys 6 months; emergency
  rotation revokes first and rotates second, any time, with the engineering lead's recorded approval. KEK rotation
  re-wraps DEKs through `rotate-kek.sh` (`rewrapAll`), without rewriting data.
- Every runbook has an owner and a `Last drilled` field, enforced in CI (`infra/runbooks/test/links.test.ts`). Drill
  records live in `infra/runbooks/drills/` and are required before launch.

## Consequences

- Runbooks are checked like code: structure, links and secrets fail CI when broken.
- Until the first drills happen, `Last drilled` reads `not yet drilled` and launch is gated on the records.
- Stage A KEK rotation is limited by `EnvKeyProvider.fromEnv` naming the env KEK `kek-1`; the runbook states the gap.

## Revisit when

- Counsel completes #117 and the `Counsel to confirm` markers are resolved.
- `EnvKeyProvider.fromEnv` can name the env KEK, lifting the Stage A rotation limit.
- The first drills (tabletop and technical) produce findings.
