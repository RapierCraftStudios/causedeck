# OVH Mumbai (YNM) VPS ordered through the OVH order workflow (ovh_vps). The account needs a default
# payment method; the API consumer key must allow /order/* and /vps/* (see ../../README.md).
# OVH VPS have no per-instance firewall or volume API: the host firewall (ufw: 80 and 443 to the
# world, 22 from the allowlist) and the deploy key come from infra/scripts/bootstrap-vps.sh, run by
# hand over SSH after the order is delivered. The data disk is the VPS root disk.

locals {
  display_name = join("-", compact([var.project, var.env, var.name_suffix]))

  # vps-2027-modelN carries two mandatory addon families: local storage and the automated backup.
  model = try(regex("^vps-2027-(model[0-9]+)$", var.plan_code), null)

  derived_options = local.model == null ? [] : [
    "option-storage-local-2027-${local.model}",
    "option-auto-backup-2027-${var.automated_backup_days}-${local.model}",
  ]

  plan_options = var.plan_options == null ? local.derived_options : var.plan_options

  configuration = [
    { label = "vps_datacenter", value = var.datacenter },
    { label = "vps_os", value = var.vps_os },
  ]
}

resource "ovh_vps" "this" {
  display_name   = local.display_name
  ovh_subsidiary = var.ovh_subsidiary

  plan = [{
    duration      = var.plan_duration
    plan_code     = var.plan_code
    pricing_mode  = var.plan_pricing_mode
    configuration = local.configuration
  }]

  plan_option = length(local.plan_options) == 0 ? null : [for code in local.plan_options : {
    duration      = var.plan_duration
    plan_code     = code
    pricing_mode  = var.plan_pricing_mode
    quantity      = 1
    configuration = []
  }]

  public_ssh_key = var.public_ssh_key == "" ? null : var.public_ssh_key
  image_id       = var.image_id == "" ? null : var.image_id

  lifecycle {
    # Reinstalling is a manual, data-destroying act; never let a changed image id do it.
    ignore_changes = [image_id, public_ssh_key]
  }
}

# The resource does not export addresses; read them from the data source once ordered.
data "ovh_vps" "this" {
  service_name = ovh_vps.this.name
}

locals {
  ipv4 = try(tolist([for ip in data.ovh_vps.this.ips : ip if !strcontains(ip, ":")])[0], null)
  ipv6 = try(tolist([for ip in data.ovh_vps.this.ips : ip if strcontains(ip, ":")])[0], null)
}
