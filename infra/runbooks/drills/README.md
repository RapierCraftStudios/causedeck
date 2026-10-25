# Restore drill log

Weekly drills run automatically (`.github/workflows/restore-drill.yml`, staging). The monthly
drill is run and signed off by a human. Add one file per drill, `YYYY-MM-DD-<monthly|dr>.md`:

```
Date: 2026-11-01
Type: monthly | dr-rehearsal
Operator: <name>
Backup restored: <backup name>, target time <UTC>
Duration: <minutes> (RTO target 240)
Measured RPO: <seconds> (target 900)
Report: <link to the drill JSON>
Findings: <none | list with follow-up issues>
Signed off by: <name>
```

A drill without a sign-off file does not count. The DR rehearsal (`../dr-hyderabad.md`) must have
one entry of type `dr-rehearsal` before launch.
