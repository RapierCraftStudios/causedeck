# `terraform test` for R11 (#788): a proxied (orange-cloud) app hostname fails unless
# app_proxied = true is set together with a recorded decision reference (D-037). Run from the module:
#   terraform -chdir=infra/terraform/modules/cloudflare-zone test
# Providers are mocked, so no credentials or network are needed.

mock_provider "cloudflare" {}

variables {
  domain          = "example.in"
  account_id      = "00000000000000000000000000000000"
  vps_ipv4        = "203.0.113.10"
  pages_subdomain = "causedeck-site.pages.dev"
}

run "default_is_dns_only" {
  command = plan

  assert {
    condition     = output.app_hosts_proxied == false
    error_message = "app, api and admin must be DNS-only by default"
  }

  assert {
    condition     = alltrue([for k, r in cloudflare_dns_record.app_hosts_a : r.proxied == false])
    error_message = "no app host A record may be proxied by default"
  }
}

run "proxied_without_decision_fails" {
  command = plan

  variables {
    app_proxied = true
  }

  expect_failures = [var.app_proxied]
}

run "proxied_with_blank_decision_fails" {
  command = plan

  variables {
    app_proxied            = true
    residency_decision_ref = "   "
  }

  expect_failures = [var.app_proxied]
}

run "proxied_with_malformed_decision_fails" {
  command = plan

  variables {
    app_proxied            = true
    residency_decision_ref = "because i said so"
  }

  expect_failures = [var.residency_decision_ref]
}

run "proxied_with_decision_id_passes" {
  command = plan

  variables {
    app_proxied            = true
    residency_decision_ref = "D-037"
  }

  assert {
    condition     = output.app_hosts_proxied == true
    error_message = "app_proxied with a decision reference should proxy"
  }

  assert {
    condition     = alltrue([for k, r in cloudflare_dns_record.app_hosts_a : r.proxied == true])
    error_message = "app host A records should be proxied"
  }
}

run "proxied_with_adr_path_passes" {
  command = plan

  variables {
    app_proxied            = true
    residency_decision_ref = "docs/adr/0002-nextjs-app-router-node-runtime-india-residency.md"
  }

  assert {
    condition     = output.app_hosts_proxied == true
    error_message = "an ADR path is an accepted decision reference"
  }
}

# for_each keys must stay plan-time known: the AAAA set follows the static enable_ipv6 flag, and
# proxying does not change which records exist.
run "proxying_keeps_record_keys_stable" {
  command = plan

  variables {
    app_proxied            = true
    residency_decision_ref = "D-037"
    enable_ipv6            = true
    vps_ipv6               = "2001:db8::10"
  }

  assert {
    condition     = length(cloudflare_dns_record.app_hosts_aaaa) == 3 && length(cloudflare_dns_record.app_hosts_a) == 3
    error_message = "A and AAAA records for app, api and admin must exist regardless of proxying"
  }
}
