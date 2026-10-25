### Approach
Greenfield Terraform under `infra/terraform` (five Cloudflare modules, two India-only VPS modules, prod and staging roots), a `terraform.yml` workflow, and a dependency-free node policy test that runs in the lane. A `terraform test` file repeats the residency rules in CI. Terraform and tflint are not installed on the host, so HCL was not validated locally.

### Changes
- infra/terraform/modules/cloudflare-zone: zone, DNSSEC, app/api/admin A/AAAA gated on `app_proxied` + `residency_decision_ref`, site CNAME, SES SPF/DKIM/DMARC/MX variables.
- modules/cloudflare-pages: Pages project (static export of apps/site, production and preview) and custom domain.
- modules/cloudflare-static-cdn: proxied static.<tld>, tiered cache, cache rule for hashed paths and a last-winning cookie/Authorization bypass.
- modules/cloudflare-access, cloudflare-waf: count-gated, off by default; WAF needs the residency ref.
- modules/vps-do-blr1, vps-lightsail-mumbai: region validation, firewall (80/443 tcp+udp world, 22 allowlist), data disk, snapshots, tags, cloud-init running bootstrap-vps.sh, identical outputs.
- envs/prod, envs/staging: roots, variables, outputs, dummy `terraform.tfvars.example`.
- infra/terraform/backend.tf.example, README.md, test/policy.test.mjs, test/residency.tftest.hcl.
- .github/workflows/terraform.yml: static checks, PR plan comment, weekly drift, manual environment-gated apply.
- package.json: `test:ci-scripts` also runs the terraform policy test. .gitignore: Terraform state, tfvars, generated backend.tf.

### Acceptance Criteria Status
- R1 ✅ (instrumented) .github/workflows/terraform.yml validate and plan jobs
- R2 ✅ infra/terraform/modules/cloudflare-zone/main.tf:30-55, variables.tf (validation), test/policy.test.mjs, test/residency.tftest.hcl
- R3 ✅ modules/cloudflare-static-cdn/main.tf
- R4 ✅ modules/cloudflare-pages/main.tf
- R5 ✅ modules/vps-*/variables.tf region validation, outputs.tf
- R6 ✅ modules/vps-do-blr1/main.tf firewall, vps-lightsail-mumbai/main.tf public ports, policy test
- R7 ✅ backup_policy / AutoSnapshot add-on, README "Disks and snapshots"
- R8 ✅ backend.tf.example, sensitive variables, policy test
- R9 ✅ modules/cloudflare-access, cloudflare-waf
- R10 ✅ cloudflare-zone variables and records
- R11 ✅ terraform.yml (plan comment, drift cron, apply environment)
- R12 ✅ tags in modules and envs, README cost table

### Verification
- V1 `node --test infra/terraform/test/policy.test.mjs`: 26 pass. It fails (2 failures) when `proxied = var.app_proxied` on the app hosts is replaced with `proxied = true`.
- V2 compose-prod, compose-dev and policy tests: 54 pass.
- V3 prettier --check on the changed files: pass. `forgedock check`: PASS.
- checks.mjs widened to full turbo because a workflow changed; not run (no TS package touched, full lint is forbidden locally).
- Not run locally: terraform fmt/validate/plan/test, tflint, checkov, actionlint (tools unavailable).

### Notes
- Each env creates its own zone, so staging needs its own domain.
- `enable_access` requires the admin host proxied (Access only protects proxied hosts), hence the residency decision.
- Credentials come from the environment (TF_VAR_cloudflare_api_token, DIGITALOCEAN_TOKEN, AWS_*). The drift and apply jobs need repo variables/secrets listed in the README (#116).
- Provider schemas (Cloudflare v5, Lightsail add_on) were written from memory and are checked by CI only; expect possible fmt/validate fixes on first CI run.

## Fix: terraform fmt alignment
Aligned `=` in the locals block of envs/prod/main.tf and envs/staging/main.tf to the longest key (`lightsail_region`) so `terraform fmt -check` passes. V1 re-run: 26 pass.
