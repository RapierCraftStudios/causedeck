# Incident report (CERT-In) - template

Copy to the incident ticket. Fields in `<angle brackets>` are filled by a human. Wording and the reporting
channel are `Counsel to confirm` (#117). A human reviews and sends this; nothing is sent automatically.

- Incident id: `<INC-YYYY-NNN>`
- Detection time (UTC): `<YYYY-MM-DDThh:mm:ssZ>`
- Report due (UTC, detection + 6 h): `<YYYY-MM-DDThh:mm:ssZ>`
- Reported by / approved by: `<name>` / `<name>`
- Reporting channel: `<CERT-In channel, Counsel to confirm>`

## What happened

Category from the directions (see [cert-in-6h](../cert-in-6h.md)): `<category>`

Summary: `<2-5 sentences, ids only, no personal data>`

## Impact

Systems: `<services, hosts>` · Workspaces affected: `<count or ids>` · Data categories: `<ids only, none, unknown>`

## Indicators and evidence

Log range (UTC): `<from>` to `<to>` · Evidence archive: `<evidence-<id>.tar.enc>` · SHA-256: `<hash>`

## Actions taken and status

`<containment, eradication, recovery, owner and time for each>`

## Follow-up

Full report due: `<date, Counsel to confirm>` · Customer notices: `<see customer-notice, sent by a human>`
