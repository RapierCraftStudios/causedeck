# stage-b-ovh root (#887): the rented-server Stage B path, the default after the D-037 amendment.
# A Postgres primary and a streaming replica on their own VPS, and N stateless app nodes, all in
# OVH Mumbai (YNM). Postgres, PgBouncer and WAL-G run from infra/docker/compose.db.yml on the two
# database nodes; the app tier runs infra/docker/compose.prod.yml on the app nodes. Credentials come
# from OVH_ENDPOINT, OVH_APPLICATION_KEY, OVH_APPLICATION_SECRET and OVH_CONSUMER_KEY; nothing is
# configured here. CI validates and tests this root (mocked providers) and never applies it: ordering
# servers spends money, so apply is a manual, reviewed step (infra/runbooks/stage-b-scale-out.md).
# The AWS variant stays in ../stage-b (plan-only).

locals {
  env = "stage-b"

  # Plan-time known: derived from a variable only, so for_each never waits on a provider.
  app_nodes = toset([for i in range(var.app_node_count) : tostring(i + 1)])
}

provider "ovh" {}

module "db_primary" {
  source = "../../modules/vps-ovh-mumbai"

  env               = local.env
  name_suffix       = "db-primary"
  datacenter        = var.vps_datacenter
  plan_code         = var.db_plan_code
  plan_pricing_mode = var.ovh_pricing_mode
  ovh_subsidiary    = var.ovh_subsidiary
  vps_os            = var.vps_os
  public_ssh_key    = var.ovh_public_ssh_key
  image_id          = var.ovh_image_id
}

module "db_replica" {
  source = "../../modules/vps-ovh-mumbai"

  env               = local.env
  name_suffix       = "db-replica"
  datacenter        = var.vps_datacenter
  plan_code         = var.db_plan_code
  plan_pricing_mode = var.ovh_pricing_mode
  ovh_subsidiary    = var.ovh_subsidiary
  vps_os            = var.vps_os
  public_ssh_key    = var.ovh_public_ssh_key
  image_id          = var.ovh_image_id
}

module "app" {
  source   = "../../modules/vps-ovh-mumbai"
  for_each = local.app_nodes

  env               = local.env
  name_suffix       = "app-${each.key}"
  datacenter        = var.vps_datacenter
  plan_code         = var.app_plan_code
  plan_pricing_mode = var.ovh_pricing_mode
  ovh_subsidiary    = var.ovh_subsidiary
  vps_os            = var.vps_os
  public_ssh_key    = var.ovh_public_ssh_key
  image_id          = var.ovh_image_id
}
