# Drill records

Every runbook is exercised before launch and the evidence is stored here (#103). Tabletop drills cover
[cert-in-6h](../cert-in-6h.md) and [dpdp-breach](../dpdp-breach.md); technical drills cover [restore](../restore.md),
[dr-hyderabad](../dr-hyderabad.md) and [key-rotation](../key-rotation.md).

Add one file per drill from [TEMPLATE.md](TEMPLATE.md), named `YYYY-MM-DD-<runbook>.md`
(restore drills keep `YYYY-MM-DD-<monthly|dr>.md`). A drill without a sign-off does not count. After a signed
drill, update the runbook's `Last drilled` field and the row in [pending-launch-drills](pending-launch-drills.md).

Weekly restore drills run automatically (`.github/workflows/restore-drill.yml`, staging). The monthly restore
drill is run and signed off by a human. The DR rehearsal (`../dr-hyderabad.md`) must have one entry of type
`dr-rehearsal` before launch.

Restore records carry these extra fields:

```
Backup restored: <backup name>, target time <UTC>
Duration: <minutes> (RTO target 240)
Measured RPO: <seconds> (target 900)
Report: <link to the drill JSON>
```

Records hold ids and roles only: no secrets, no personal data.
