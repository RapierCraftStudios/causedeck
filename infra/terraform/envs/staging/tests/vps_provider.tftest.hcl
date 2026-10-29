# `terraform test` for the VPS provider options (#885): ovh_mumbai (default) and manual. Run from the
# env root:
#   terraform -chdir=infra/terraform/envs/ENV test
# Providers are mocked, so no credentials or network are needed. The OVH data source is mocked with
# one IPv4 and one IPv6 address, like the real `ips` list.

mock_provider "cloudflare" {}
mock_provider "digitalocean" {}
mock_provider "aws" {}

mock_provider "ovh" {
  mock_data "ovh_vps" {
    defaults = {
      ips = ["2001:db8::10", "203.0.113.10"]
    }
  }
}

variables {
  domain                = "example.in"
  cloudflare_account_id = "00000000000000000000000000000000"
  cloudflare_api_token  = "dummy"
  owner                 = "founder"
  ssh_allowlist         = ["203.0.113.4/32"]
  deploy_pubkey         = "ssh-ed25519 AAAAdummy deploy@example"
}

run "default_provider_is_ovh_mumbai" {
  command = apply

  assert {
    condition     = var.vps_provider == "ovh_mumbai" && length(module.vps_ovh) == 1
    error_message = "the default provider must be ovh_mumbai and plan one OVH VPS"
  }

  assert {
    condition     = length(module.vps_do) == 0 && length(module.vps_lightsail) == 0
    error_message = "only the selected provider module may be planned"
  }

  assert {
    condition     = output.vps_ipv4 == "203.0.113.10" && output.vps_ipv6 == "2001:db8::10"
    error_message = "the OVH addresses must be split by family and feed the DNS records"
  }
}

run "manual_plans_no_vps_and_uses_supplied_ips" {
  command = apply

  variables {
    vps_provider = "manual"
    vps_ipv4     = "198.51.100.7"
    vps_ipv6     = "2001:db8::7"
  }

  assert {
    condition     = length(module.vps_ovh) == 0 && length(module.vps_do) == 0 && length(module.vps_lightsail) == 0
    error_message = "manual must not plan any VPS resource"
  }

  assert {
    condition     = output.vps_ipv4 == "198.51.100.7" && output.vps_ipv6 == "2001:db8::7"
    error_message = "manual must use the supplied addresses"
  }
}

run "manual_without_ipv6_is_allowed" {
  command = apply

  variables {
    vps_provider = "manual"
    vps_ipv4     = "198.51.100.7"
  }

  assert {
    condition     = output.vps_ipv6 == ""
    error_message = "an empty vps_ipv6 must stay empty (no AAAA records)"
  }
}

run "manual_requires_an_ipv4" {
  command = plan

  variables {
    vps_provider = "manual"
  }

  expect_failures = [var.vps_ipv4]
}

run "manual_rejects_a_malformed_ipv4" {
  command = plan

  variables {
    vps_provider = "manual"
    vps_ipv4     = "not-an-ip"
  }

  expect_failures = [var.vps_ipv4]
}

run "do_and_lightsail_remain_selectable" {
  command = plan

  variables {
    vps_provider = "do_blr1"
  }

  assert {
    condition     = length(module.vps_do) == 1 && length(module.vps_ovh) == 0
    error_message = "do_blr1 must still plan the DigitalOcean module"
  }
}
