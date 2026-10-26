# Terraform: Cloudflare and the India VPS

Infrastructure that is not the application (#99): Cloudflare (zone, DNS, DNSSEC, Pages for
`apps/site`, the `static.<tld>` CDN host, optional Access and WAF) and the India VPS (DigitalOcean
BLR1 or AWS Lightsail ap-south-1) for `prod` and `staging`. The VPS runs `infra/scripts/bootstrap-vps.sh`
on first boot; the compose stack (`infra/docker/compose.prod.yml`) is deployed by #100.

```
infra/terraform/
  modules/cloudflare-zone        zone, DNSSEC, app/api/admin/site records, SES email records
  modules/cloudflare-pages       Pages project for apps/site + custom domain
  modules/cloudflare-static-cdn  proxied static.<tld>, cache rules, tiered cache
  modules/cloudflare-access      admin Access application (enable_access, off)
  modules/cloudflare-waf         managed rules + rate limit (enable_app_waf, off)
  modules/vps-do-blr1            DigitalOcean droplet, firewall, volume, backups
  modules/vps-lightsail-mumbai   Lightsail instance, public ports, disk, snapshots
  modules/aws-rds-postgres       Stage B RDS Postgres 17, CMK KMS, PITR, Hyderabad replica (#106)
  modules/aws-s3-documents       Stage B documents bucket: public block, versioning, SSE-KMS, replication
  modules/aws-alb-multinode      Stage B ALB (default multi-node entry), /readyz health check
  modules/cloudflare-lb          optional Cloudflare LB (enable_cloudflare_lb, off)
  modules/aws-ecs-fargate        Stage C skeleton (enabled = false)
  modules/aws-elasticache        Stage C skeleton (enabled = false)
  envs/{prod,staging}            roots; terraform.tfvars.example holds dummy values
  envs/stage-b                   Stage B root composing the #106 modules (plan only in CI)
  backend.tf.example             remote state (S3 ap-south-1, locking)
  test/                          policy.test.mjs (node); envs/prod/tests/residency.tftest.hcl is the terraform test
```

## Variables

| Variable                                | Default   | Purpose                                                        |
| --------------------------------------- | --------- | -------------------------------------------------------------- |
| `domain`                                | required  | Registered domain; each env owns its own zone (see below)      |
| `cloudflare_account_id`                 | required  | Cloudflare account                                             |
| `cloudflare_api_token`                  | required  | Sensitive; `TF_VAR_cloudflare_api_token`, scoped to zone + Pages |
| `vps_provider`                          | `do_blr1` | `do_blr1` or `lightsail_mumbai`; both modules expose the same outputs |
| `app_proxied`                           | `false`   | Proxy app/api/admin; requires `residency_decision_ref`         |
| `enable_app_waf`                        | `false`   | WAF and rate limits; requires `residency_decision_ref`         |
| `enable_access`                         | `false`   | Access for admin; needs the admin host proxied                 |
| `residency_decision_ref`                | `""`      | Pointer to the recorded founder decision D-037                 |
| `owner`, `ssh_allowlist`, `deploy_pubkey` | required | Tag, SSH allowlist (never `0.0.0.0/0`), deploy key             |

Outputs: `vps_ipv4`, `vps_ipv6`, `dns_record_ids`, `dns_app_hosts_proxied`, `pages_project_name`, `name_servers`.

Credentials come from the environment and are never committed: `TF_VAR_cloudflare_api_token`,
`DIGITALOCEAN_TOKEN` (do_blr1), `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (lightsail_mumbai and the
state bucket). Real values come from #107 (domain and Cloudflare token), #108 (VPS and SSH keys) and
#116 (GitHub environments). Validate and plan need only dummy values.

## Residency rules

- `app.<tld>`, `api.<tld>` and `admin.<tld>` are DNS-only (grey cloud): TLS terminates on the India
  VPS and matter data never transits Cloudflare edges.
- Only the Pages site and `static.<tld>` (hashed public assets, no tenant data) are proxied.
- `app_proxied = true` and `enable_app_waf = true` are rejected by a validation block unless
  `residency_decision_ref` is set (decision D-037). Cloudflare Access only protects proxied hostnames,
  so `enable_access` additionally needs `app_proxied`.
- VPS modules reject any region except `blr1` / `ap-south-1`. The firewall opens only 80 and 443
  (tcp and udp) to the world and 22 to `ssh_allowlist`; Postgres, MinIO and admin ports are never public.
- Every VPS resource is tagged `project`, `env`, `owner`, `data_residency=in`.

## Stage B (#106)

`envs/stage-b` composes the RDS, S3, ALB and optional Cloudflare LB modules and the disabled Stage C
skeletons. Region variables (`aws_region`, `replica_region`, each module's `region`) accept only
`ap-south-1` and `ap-south-2`. `enable_cloudflare_lb` (default `false`) needs `residency_decision_ref`
and `approval_doc`, like `app_proxied`; the ALB is the default entry. `enable_stage_c` (default
`false`) gates ECS Fargate and ElastiCache. `plan_with_dummy_credentials = true` lets CI plan without
AWS credentials; it is never set for a real apply.

**Nothing in Stage B is applied automatically.** CI validates and plans it with
`terraform.tfvars.example`; the workflow has no apply or drift path for it. Apply is manual and gated
(see `infra/runbooks/stage-b-scale-out.md`). Policy tests: `node --test infra/terraform/test/stage-b-policy.test.mjs`.

## Apply order

1. Create the state bucket (S3 `ap-south-1`, versioning, encryption, public access blocked) and copy
   `backend.tf.example` to `envs/<env>/backend.tf` (git-ignored).
2. `terraform init` and `terraform apply` in `envs/staging`, then `envs/prod`. The VPS and Pages
   project are created first; the zone, DNS records, CDN rules and DNSSEC follow in the same run.
3. Set the name servers from `name_servers` at the registrar and add the DS record for DNSSEC.
4. Fill the SES variables once SES is verified (below), re-apply.

Staging needs its own domain (for example `example-staging.in`), because each env creates its zone.

## SES DNS

After verifying the domain in SES (ap-south-1) set in `terraform.tfvars`:

- `spf_value = "v=spf1 include:amazonses.com ~all"`
- `dkim_cnames = { "<token1>._domainkey" = "<token1>.dkim.amazonses.com", ... }` (three tokens)
- `dmarc_value = "v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>"`
- `inbound_mx = [{ host = "inbound-smtp.ap-south-1.amazonaws.com", priority = 10 }]`

Empty values create no records.

## Pages (apps/site)

Build command `pnpm install --frozen-lockfile && pnpm --filter @causedeck/site build`, root `/`,
output `apps/site/out` (static export), `NODE_VERSION=22`. Production deploys `main`; every other
branch gets a preview deployment. Custom domain: `site.<tld>` by default, or the apex with `site_label = "@"`.
The site build is a stub until the site app lands, so the first deployment stays empty.

## Disks and snapshots

- DigitalOcean: weekly droplet backups (Sunday 20:00 UTC, 01:30 IST, outside court hours) via
  `backup_policy`; the data volume is encrypted at rest by DigitalOcean (no toggle).
- Lightsail: daily automatic snapshot at 20:00 UTC (`snapshot_time_utc`); disks and snapshots are
  encrypted at rest by AWS.
- Provider snapshots are a second line; database durability is WAL-G to object storage (#101).

## State and secrets

State lives in an S3 bucket in `ap-south-1` with `encrypt = true` and lockfile locking
(`use_lockfile`). Tokens are `sensitive` variables supplied from the environment, not stored in
tfvars; the state holds only values the providers require. Outputs never include tokens.

## CI and drift

`.github/workflows/terraform.yml` runs fmt, validate, tflint, checkov and `terraform test` on PRs that
touch `infra/terraform/**`, and plans staging and prod with the example tfvars (dummy credentials,
`-backend=false`), posting the plan to the PR. Apply is `workflow_dispatch` only and runs in the
GitHub environment `terraform-<env>`, which must have required reviewers (configured in #116). A
weekly scheduled run plans against real state with `-detailed-exitcode` and fails on drift; it runs
when the repository variable `TF_BACKEND_CONFIGURED` is `true`. Repository variable `TF_STATE_BUCKET`
and environment secrets `CLOUDFLARE_API_TOKEN`, `DIGITALOCEAN_TOKEN`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `TF_OWNER`, `TF_DOMAIN`, `TF_CLOUDFLARE_ACCOUNT_ID`, `TF_SSH_ALLOWLIST`
(JSON list), `TF_DEPLOY_PUBKEY` are set in #116.

Local checks (no Terraform needed): `node --test infra/terraform/test/policy.test.mjs`.

## Monthly cost estimate (staging + prod)

Indicative list prices, converted at about ₹85 per USD; confirm before ordering.

| Item                                                        | USD/month | INR/month |
| ----------------------------------------------------------- | --------- | --------- |
| prod: DO `s-4vcpu-8gb` droplet                              | 48        | ~4,100    |
| prod: weekly backups (20% of droplet) + 100 GB volume       | 9.6 + 10  | ~1,700    |
| staging: DO `s-2vcpu-4gb` droplet + 50 GB volume + backups  | 24 + 5 + 4.8 | ~2,900 |
| Cloudflare (Free: zone, Pages, Access up to 50 users)       | 0         | 0         |
| **Total**                                                   | **~101**  | **~8,700** |

This sits inside the ₹6k to 12k target. Lightsail (`medium_3_0` about $40, `small_3_0` about $20 plus
disks and snapshots) lands in the same range. Object storage, SES and monitoring are costed in their own issues.
