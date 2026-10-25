# Runbook: CERT-In 6-hour incident reporting

Owner: Engineering lead
Last drilled: not yet drilled
Legal wording, the reporting channel and contact details: `Counsel to confirm` (#117). Contact details are
references to the secret manager, never written here.

## Purpose

Report a reportable cyber security incident to CERT-In within 6 hours of detection, with the evidence to
support it. Engineering owns the structure and the technical steps; counsel owns the wording and the call on
whether an event is reportable.

## Triggers

Any suspected event in one of these categories (the Annexure I list of the CERT-In directions of 28 April 2022;
`Counsel to confirm` against the current text):

- targeted scanning or probing of critical networks and systems
- compromise of critical systems or information
- unauthorised access to IT systems or data
- defacement of a website, or intrusion into it with unauthorised changes
- malicious code attacks (virus, worm, trojan, bot, spyware, ransomware)
- attacks on servers (database, mail, DNS) and network devices (routers, switches)
- identity theft, spoofing and phishing attacks
- denial of service (DoS) and distributed denial of service (DDoS) attacks
- attacks on applications (for example web applications) and on cloud computing systems
- data breach and data leak
- attacks on IoT devices, digital payment systems, and through malicious or fake mobile apps
- unauthorised access to social media accounts, and attacks on systems using AI/ML, big data or blockchain

When unsure, treat it as reportable and start the clock; counsel can withdraw a report, nobody can recover a
missed one. Typical CauseDeck sources: Alertmanager P0/P1 ([on-call](on-call.md)), anomalous access in the
audit log, a customer report, a provider notice, a leaked credential.

## Roles

| Role               | Does                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Incident commander | Records detection time, owns the clock, assigns the rest                                    |
| Evidence lead      | Runs the export, keeps the chain of custody                                                 |
| Engineering lead   | Approves the report content and sends it (or delegates to the commander)                    |
| Counsel            | Confirms reportability and wording, advises on other duties ([dpdp-breach](dpdp-breach.md)) |

## Steps

**The 6-hour clock starts at detection**, meaning the moment any person or alert first made the event known to
the team, not when it is confirmed. Write the time in UTC in the ticket: `T0`.

Decision tree:

1. Is it in a category above, or could it be? **Yes or unsure**: go to 2. **No**: record why in the ticket and
   stop; re-assess if facts change.
2. Declare P0 ([on-call](on-call.md)); name the incident commander; note `T0` and `T0 + 6 h` (the due time).
3. Contain first, without destroying evidence: revoke the credential, isolate the host or service, block the
   source. Follow [key-rotation](key-rotation.md) (emergency path) if a key or secret may be exposed.
4. Start evidence collection (below) immediately; it runs while you assess.
5. Fill the [incident report](templates/incident-report.md) with what is known at `T0 + 4 h`; unknowns are
   written as unknown. Do not wait for the full picture.
6. A human approves the report; send it through the channel counsel confirmed by `T0 + 6 h`.
7. Does personal data seem involved? Open [dpdp-breach](dpdp-breach.md) in parallel.
8. Send follow-up information as it becomes available; track it in the ticket.

## Communications

- CERT-In: one report by `T0 + 6 h`, then updates (template above). Channel and contacts: `Counsel to confirm`.
- Customers: through [dpdp-breach](dpdp-breach.md) when their data is involved.
- No automated outbound messages go to courts, CERT-In, customers or any third party. Every report and notice is
  approved by a human and sent by a human after approval.
- Internal: incident ticket and the on-call channel; ids only, no matter content or personal data.

## Evidence

Logs are kept at least 180 days in India (Loki, #102; `infra/monitoring/loki/loki-config.yml`). Use the
[evidence checklist](templates/evidence-checklist.md). Export the range around `T0`:

```sh
export LOKI_URL=<internal Loki URL>
export EVIDENCE_KEY_FILE=<path of the key file from custody>
bash infra/scripts/runbooks/evidence-export.sh --from <UTC start> --to <UTC end> --out <dir>
```

The script writes an encrypted archive, a manifest with SHA-256 per file and a `.sha256` of the archive; copy it
to India object storage (`EVIDENCE_S3_ENDPOINT` and `EVIDENCE_S3_BUCKET`, endpoint checked by the India guard).
Record the archive hash in the report.

## Verification

- The report was sent by a human before `T0 + 6 h`; the send time is in the ticket.
- `sha256sum -c <archive>.sha256` passes, and the manifest entry count matches the export output.
- Retention still holds: `bash infra/monitoring/log-retention/verify-retention.sh`.

## After action

[Post-incident review](templates/post-incident-review.md) within 5 working days; update this runbook and
`Last drilled`; file the tabletop or incident record under [drills](drills/README.md).
