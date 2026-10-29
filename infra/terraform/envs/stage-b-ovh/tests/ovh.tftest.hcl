# `terraform test` for the OVH Stage B root (#887). Run from the root:
#   terraform -chdir=infra/terraform/envs/stage-b-ovh test
# The provider is mocked: no credentials, network or orders.

mock_provider "ovh" {
  mock_data "ovh_vps" {
    defaults = {
      ips = ["2001:db8::10", "203.0.113.10"]
    }
  }
}

run "plans_a_primary_a_replica_and_two_app_nodes_in_ynm" {
  command = apply

  assert {
    condition     = length(output.node_datacenters) == 4
    error_message = "defaults must give db-primary, db-replica and two app nodes"
  }

  assert {
    condition     = alltrue([for name, dc in output.node_datacenters : dc == "YNM"])
    error_message = "every node must be in YNM (OVH Mumbai, D-009)"
  }

  assert {
    condition     = output.db_primary_ipv4 == "203.0.113.10" && output.db_replica_ipv4 == "203.0.113.10"
    error_message = "database addresses must come from the OVH data source"
  }

  assert {
    condition     = join(",", sort(keys(output.app_ipv4s))) == "1,2"
    error_message = "app nodes are keyed 1..N"
  }
}

run "app_node_count_scales_the_app_tier_only" {
  command = apply

  variables {
    app_node_count = 4
  }

  assert {
    condition     = length(output.app_ipv4s) == 4 && length(output.node_datacenters) == 6
    error_message = "four app nodes plus the two database nodes"
  }

  assert {
    condition     = alltrue([for name, dc in output.node_datacenters : dc == "YNM"])
    error_message = "every node must be in YNM"
  }
}

run "a_datacenter_outside_mumbai_is_rejected" {
  command = plan

  variables {
    vps_datacenter = "GRA"
  }

  expect_failures = [var.vps_datacenter]
}

run "a_single_app_node_is_rejected" {
  command = plan

  variables {
    app_node_count = 1
  }

  expect_failures = [var.app_node_count]
}

run "too_many_app_nodes_are_rejected" {
  command = plan

  variables {
    app_node_count = 9
  }

  expect_failures = [var.app_node_count]
}
