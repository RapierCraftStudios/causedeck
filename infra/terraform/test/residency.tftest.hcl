# `terraform test` for the residency and safety invariants. Run from an env root:
#   terraform -chdir=infra/terraform/envs/prod test -test-directory=../../test
# Providers are mocked, so no credentials or network are needed.

mock_provider "cloudflare" {}
mock_provider "digitalocean" {}
mock_provider "aws" {}

variables {
  domain                = "example.in"
  cloudflare_account_id = "00000000000000000000000000000000"
  cloudflare_api_token  = "dummy"
  owner                 = "founder"
  ssh_allowlist         = ["203.0.113.4/32"]
  deploy_pubkey         = "ssh-ed25519 AAAAdummy deploy@example"
}

run "defaults_keep_app_hosts_dns_only" {
  command = plan

  assert {
    condition     = output.dns_app_hosts_proxied == false
    error_message = "app, api and admin must be DNS-only by default"
  }
}

run "proxying_requires_residency_decision" {
  command = plan

  variables {
    app_proxied = true
  }

  expect_failures = [var.app_proxied]
}

run "proxying_allowed_with_decision" {
  command = plan

  variables {
    app_proxied            = true
    residency_decision_ref = "D-037-accepted"
  }

  assert {
    condition     = output.dns_app_hosts_proxied == true
    error_message = "app_proxied with a residency decision should proxy"
  }
}

run "waf_requires_residency_decision" {
  command = plan

  variables {
    enable_app_waf = true
  }

  expect_failures = [var.enable_app_waf]
}

run "unknown_provider_is_rejected" {
  command = plan

  variables {
    vps_provider = "aws_us_east"
  }

  expect_failures = [var.vps_provider]
}
