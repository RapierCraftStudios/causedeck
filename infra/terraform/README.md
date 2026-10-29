# Terraform: Cloudflare and the India VPS

> **Provider direction (D-037 amendment, 2026-10-27, #882).** Stage A runs on OVH Mumbai: prod on a
> VPS-3 (₹1,160/mo) and staging on its own VPS-1 (₹420/mo), on separate hosts (OVH India catalogue,
> 2026-10-27, ex-GST, 12-month term). `vps_provider` defaults to `ovh_mumbai` (`modules/vps-ovh-mumbai`,
> #885), which orders the VPS through the OVH API in the Mumbai datacenter `YNM`; `manual` takes the
> IPs of a hand-ordered host (#108) and plans no VPS at all. The DigitalOcean and Lightsail modules
> remain as alternatives. Stage B is a
> Postgres box (VPS-4 or dedicated) with a streaming replica and PgBouncer plus 2+ app VPS behind
> Cloudflare LB or DNS; Stage C is k3s or Docker Swarm. The AWS modules (RDS, S3, ALB, ECS) are
> optional, no longer the default ([ADR 0053](../../docs/adr/0053-stage-b-c-scale-path.md)).
> Residency (D-009) is unchanged: MinIO on the Mumbai host, off-host backups to S3 ap-south-2. App
> and API stay DNS-only by default (D-037, #788). Trade-offs: shared vCores, a traffic quota
> (500 GB/month on VPS-1, about 1 TB/month on VPS-3, then 10 Mbps), and a 12-month term.

Infrastructure that is not the application (#99): Cloudflare (zone, DNS, DNSSEC, Pages for
`apps/site`, the `static.<tld>` CDN host, optional Access and WAF) and the India VPS (DigitalOcean
BLR1, AWS Lightsail ap-south-1, OVH Mumbai, or a hand-ordered host) for `prod` and `staging`. The VPS runs `infra/scripts/bootstrap-vps.sh`
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
  modules/vps-ovh-mumbai         OVH VPS ordered through ovh_vps in YNM (Mumbai) only
  modules/aws-rds-postgres       Stage B RDS Postgres 17, CMK KMS, PITR, Hyderabad replica (#106)
  modules/aws-s3-documents       Stage B documents bucket: public block, versioning, SSE-KMS, replication
  modules/aws-alb-multinode      Stage B ALB (default multi-node entry), /readyz health check
  modules/cloudflare-lb          optional Cloudflare LB (enable_cloudflare_lb, off)
  modules/aws-ecs-fargate        Stage C skeleton (enabled = false)
  modules/aws-elasticache        Stage C skeleton (enabled = false)
  envs/{prod,staging}            roots; terraform.tfvars.example holds dummy values
  envs/stage-b-ovh               Stage B on rented OVH Mumbai servers: db primary, db replica, N app nodes (#887)
  envs/stage-b                   Stage B AWS variant (RDS, S3, ALB), optional, plan only in CI (#106)
  backend.tf.example             remote state (S3 ap-south-1, locking)
  test/                          policy.test.mjs (node); envs/prod/tests/residency.tftest.hcl is the terraform test
```

## Variables

| Variable                                | Default   | Purpose                                                        |
| --------------------------------------- | --------- | -------------------------------------------------------------- |
| `domain`                                | required  | Registered domain; each env owns its own zone (see below)      |
| `cloudflare_account_id`                 | required  | Cloudflare account                                             |
| `cloudflare_api_token`                  | required  | Sensitive; `TF_VAR_cloudflare_api_token`, scoped to zone + Pages |
| `vps_provider`                          | `ovh_mumbai` | `ovh_mumbai`, `do_blr1`, `lightsail_mumbai` or `manual` |
| `vps_datacenter`                        | `YNM`     | OVH datacenter; `YNM` (Mumbai) is the only accepted value (D-009) |
| `vps_ipv4`, `vps_ipv6`                  | `""`      | Host addresses for `manual` (`vps_ipv4` required, empty `vps_ipv6` skips AAAA records) |
| `vps_size`                              | `""`      | Droplet size, Lightsail bundle or OVH plan code; empty uses the env default (`vps-2027-model3` prod, `vps-2027-model1` staging) |
| `ovh_subsidiary`, `vps_os`, `ovh_pricing_mode` | `IN`, `Ubuntu 24.04`, `upfront12` | OVH billing subsidiary, OS (`Ubuntu 24.04` or `Debian 13`), 12-month term or monthly |
| `ovh_public_ssh_key`, `ovh_image_id`    | `""`      | Optional key OVH pre-installs; OVH requires the image id with it |
| `app_proxied`                           | `false`   | Proxy app/api/admin; requires `residency_decision_ref`         |
| `enable_app_waf`                        | `false`   | WAF and rate limits; requires `residency_decision_ref`         |
| `enable_access`                         | `false`   | Access for admin; needs the admin host proxied                 |
| `residency_decision_ref`                | `""`      | Pointer to the recorded founder decision D-037                 |
| `owner`, `ssh_allowlist`, `deploy_pubkey` | required | Tag, SSH allowlist (never `0.0.0.0/0`), deploy key             |

Outputs: `vps_ipv4`, `vps_ipv6`, `dns_record_ids`, `dns_app_hosts_proxied`, `pages_project_name`, `name_servers`.

Credentials come from the environment and are never committed: `TF_VAR_cloudflare_api_token`,
`DIGITALOCEAN_TOKEN` (do_blr1), `OVH_ENDPOINT`, `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET` and
`OVH_CONSUMER_KEY` (ovh_mumbai only; the `provider "ovh"` block is empty),
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (lightsail_mumbai and the state bucket). `manual` needs no
VPS credentials. Real values come from #107 (domain and Cloudflare token), #108 (VPS and SSH keys) and
#116 (GitHub environments). Validate and plan need only dummy values.

## OVH Mumbai and manual hosts

`ovh_mumbai` orders the VPS through OVH's order workflow (`ovh_vps`), so the account needs a default
payment method. Plan codes: `vps-2027-model3` (VPS-3, prod) and `vps-2027-model1` (VPS-1, staging);
the catalogue (`GET /order/catalog/public/vps`) prices a 12-month term as interval `P1M` with pricing
mode `upfront12` (`ovh_pricing_mode`, default `upfront12`; `default` is monthly with no commitment).
The 2027 range has two mandatory add-on families, which the module orders for you: local storage
(`option-storage-local-2027-modelN`, free) and the automated backup (`option-auto-backup-2027-1-modelN`,
or `-7-` with `automated_backup_days = 7`).
The module reads the addresses back with the `ovh_vps` data source. OVH VPS have no firewall or
volume API: after delivery run `infra/scripts/bootstrap-vps.sh` (ufw, deploy key, key-only SSH) by
hand or via the OVH-installed key. Reinstalling is never done by Terraform (`image_id` is ignored
after the order).

`manual` plans no VPS resource. Set `vps_provider = "manual"` and `vps_ipv4` (and `vps_ipv6` if the
host has one); Cloudflare records and the static CDN origin use those addresses.

### OVH API credentials and routes

Create the application and a consumer key restricted to the routes below (no `/*` wildcard), store
the four values as secrets of the GitHub environment `terraform-<env>` (`OVH_ENDPOINT`,
`OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`), and never put them in tfvars.
Per the provider's guide "Consumer key access rules for resources that place orders", `ovh_vps`
needs:

| Route                      | Methods                    | Used for                                                          |
| -------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `/order/*`                 | GET, POST                  | cart, VPS item, configuration (`vps_datacenter`, `vps_os`), checkout |
| `/me/order/*`              | GET, POST                  | pay the order, read its status and details                        |
| `/me/payment/method`       | GET                        | look up the default payment method                                |
| `/vps/*`                   | GET, POST, PUT             | read the VPS and its `ips`, terminate and confirm termination     |

Without `ovh_subsidiary` the provider also calls `GET /me`; the module always sets it, so that route
is not needed. `OVH_ENDPOINT` is the API region (for example `ovh-eu`); the endpoint for an India
account is confirmed when the keys are created (#108).

## Residency rules

- `app.<tld>`, `api.<tld>` and `admin.<tld>` are DNS-only (grey cloud): TLS terminates on the India
  VPS and matter data never transits Cloudflare edges.
- Only the Pages site and `static.<tld>` (hashed public assets, no tenant data) are proxied.
- `app_proxied = true` and `enable_app_waf = true` are rejected by a validation block unless
  `residency_decision_ref` is set (decision D-037); the reference must be a decision id (`D-037`) or
  an ADR path (`docs/adr/NNNN-name.md`). Cloudflare Access only protects proxied hostnames,
  so `enable_access` additionally needs `app_proxied`.
- VPS modules reject any region except `blr1` / `ap-south-1`, and OVH any datacenter except `YNM`
  (Mumbai); the env roots validate `vps_datacenter` too, whatever `vps_provider` is. The firewall opens only 80 and 443
  (tcp and udp) to the world and 22 to `ssh_allowlist`; Postgres, MinIO and admin ports are never public.
- Every VPS resource is tagged `project`, `env`, `owner`, `data_residency=in`.

## Stage B on rented servers (#887, default)

`envs/stage-b-ovh` orders a Postgres primary and a streaming replica (default plan `vps-2027-model4`,
VPS-4) and `app_node_count` app nodes (2 to 8, default plan `vps-2027-model3`) through
`modules/vps-ovh-mumbai`. Every node is in `YNM`: `vps_datacenter` rejects anything else, and the
module repeats the check. The for_each keys of the app nodes (`"1"` .. `"N"`) come from
`app_node_count` alone, so they are known at plan time. Outputs: `db_primary_ipv4`, `db_replica_ipv4`,
`app_ipv4s`, `app_ipv6s` and `node_datacenters`; DNS (DNS-only app and api records for every app node)
is set from them at cutover, not by this root. Postgres, PgBouncer and WAL-G run from
`infra/docker/compose.db.yml` on the two database nodes. Credentials are the same `OVH_*` environment
variables as for `ovh_mumbai`; the root has no backend, no credentials and no Cloudflare provider.

CI validates it and runs `terraform test` with a mocked provider (`envs/stage-b-ovh/tests`). It is
never planned there (a plan would reach the OVH order API) or applied: ordering servers spends money,
so the first apply is a manual, reviewed step ([runbook](../runbooks/stage-b-scale-out.md)). Policy
tests: `node --test infra/terraform/test/stage-b-policy.test.mjs`.

## Stage B on AWS (#106, optional)

These AWS modules are the optional Stage B path. The default is OVH Mumbai (above and the note at the top).

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

`terraform test` also runs for `envs/staging` (`tests/vps_provider.tftest.hcl`). The plan jobs set
dummy `OVH_*` values; the real ones are read only by apply and drift.

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
