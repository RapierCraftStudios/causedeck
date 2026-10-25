# aws-rds-postgres

Stage B database (#106): RDS Postgres 17 in `ap-south-1` with a read replica in `ap-south-2`
(Hyderabad). Plan-able with dummy credentials, applied only by the gated workflow.

- Encryption: storage, backups, replica and Performance Insights use customer-managed KMS keys
  (rotation on). Key administrators and key users are different principals.
- Backups: `backup_retention_days` (default 14, 7 to 35) is the PITR window.
- Network: private subnets, `publicly_accessible = false`, ingress only from service security
  groups, `rds.force_ssl = 1`.
- pgvector: the parameter group family is `postgres17`; the migration runs `CREATE EXTENSION vector`.
- Regions: `region` and `replica_region` accept only `ap-south-1` and `ap-south-2`, and the providers
  are checked against them.

Providers: the root passes the default `aws` provider (primary) and `aws.replica`.

Inputs are in `variables.tf`; outputs: `endpoint` (private), `replica_endpoint`, `kms_key_arn`,
`replica_kms_key_arn`, `master_user_secret_arn`. The app reads them only through `DATABASE_URL`.
