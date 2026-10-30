# Evidence checklist - template

Logs are kept at least 180 days in India (Loki, `infra/monitoring/log-retention`, #102). Verify with
`bash infra/monitoring/log-retention/verify-retention.sh`.

- [ ] Detection time and source recorded (alert, report, person) in UTC
- [ ] Time range chosen: from `<detection - 24 h>` to `<now>`, widened if the start is unknown
- [ ] Export: `EVIDENCE_KEY_FILE=<key file> bash infra/scripts/runbooks/evidence-export.sh --from <UTC> --to <UTC>`
- [ ] Archive, manifest and `.sha256` stored in India object storage; hash recorded in the ticket
- [ ] Key custody: the archive key is held by two named people
- [ ] Relevant alerts, Grafana views and deploy history attached (ids only, no matter content)
- [ ] Host snapshot or image taken before changes where a host is suspected
- [ ] Nothing deleted or rewritten; changes logged in the ticket with times
