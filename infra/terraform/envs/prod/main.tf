# prod root. Credentials come from the environment: TF_VAR_cloudflare_api_token (variable),
# DIGITALOCEAN_TOKEN (do_blr1), OVH_ENDPOINT/OVH_APPLICATION_KEY/OVH_APPLICATION_SECRET/
# OVH_CONSUMER_KEY (ovh_mumbai) and AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (lightsail_mumbai and
# the state bucket). Dummy values are enough for validate and plan; manual needs none of the VPS ones.

locals {
  env              = "prod"
  use_do           = var.vps_provider == "do_blr1"
  use_lightsail    = var.vps_provider == "lightsail_mumbai"
  use_ovh          = var.vps_provider == "ovh_mumbai"
  use_manual       = var.vps_provider == "manual"
  lightsail_region = "ap-south-1"

  tags = {
    project        = "causedeck"
    env            = local.env
    owner          = var.owner
    data_residency = "in"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "digitalocean" {}

# Credentials and the API endpoint come from OVH_ENDPOINT, OVH_APPLICATION_KEY,
# OVH_APPLICATION_SECRET and OVH_CONSUMER_KEY; nothing is configured here.
provider "ovh" {}

provider "aws" {
  region                      = local.lightsail_region
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

module "vps_do" {
  count  = local.use_do ? 1 : 0
  source = "../../modules/vps-do-blr1"

  env              = local.env
  region           = "blr1"
  size             = var.vps_size == "" ? "s-4vcpu-8gb" : var.vps_size
  data_volume_gb   = var.data_volume_gb
  ssh_allowlist    = var.ssh_allowlist
  deploy_pubkey    = var.deploy_pubkey
  bootstrap_url    = var.bootstrap_url
  bootstrap_sha256 = var.bootstrap_sha256
  tags             = local.tags
}

module "vps_lightsail" {
  count  = local.use_lightsail ? 1 : 0
  source = "../../modules/vps-lightsail-mumbai"

  env              = local.env
  region           = local.lightsail_region
  size             = var.vps_size == "" ? "medium_3_0" : var.vps_size
  data_volume_gb   = var.data_volume_gb
  ssh_allowlist    = var.ssh_allowlist
  deploy_pubkey    = var.deploy_pubkey
  bootstrap_url    = var.bootstrap_url
  bootstrap_sha256 = var.bootstrap_sha256
  tags             = local.tags
}

module "vps_ovh" {
  count  = local.use_ovh ? 1 : 0
  source = "../../modules/vps-ovh-mumbai"

  env               = local.env
  datacenter        = var.vps_datacenter
  plan_pricing_mode = var.ovh_pricing_mode
  plan_code         = var.vps_size == "" ? "vps-2027-model3" : var.vps_size
  ovh_subsidiary    = var.ovh_subsidiary
  vps_os            = var.vps_os
  public_ssh_key    = var.ovh_public_ssh_key
  image_id          = var.ovh_image_id
}

# With vps_provider = "manual" no VPS resource is planned: the operator ordered the box by hand and
# supplies its addresses. Every record below uses whichever of these resolves.
locals {
  vps_ipv4 = local.use_manual ? var.vps_ipv4 : one(concat(module.vps_do[*].ipv4, module.vps_lightsail[*].ipv4, module.vps_ovh[*].ipv4))
  vps_ipv6 = local.use_manual ? var.vps_ipv6 : one(concat(module.vps_do[*].ipv6, module.vps_lightsail[*].ipv6, module.vps_ovh[*].ipv6))

  # A plan-time constant (a function of variables only): the providers are dualstack, and manual
  # hosts only get AAAA records when vps_ipv6 is supplied.
  enable_ipv6 = local.use_manual ? var.vps_ipv6 != "" : true
}

module "pages" {
  source = "../../modules/cloudflare-pages"

  account_id   = var.cloudflare_account_id
  project_name = "causedeck-site-${local.env}"
  domain       = var.domain
  site_label   = var.site_label
}

module "zone" {
  source = "../../modules/cloudflare-zone"

  domain                 = var.domain
  account_id             = var.cloudflare_account_id
  vps_ipv4               = local.vps_ipv4
  vps_ipv6               = local.vps_ipv6
  enable_ipv6            = local.enable_ipv6
  app_proxied            = var.app_proxied
  residency_decision_ref = var.residency_decision_ref
  site_label             = var.site_label
  pages_subdomain        = module.pages.subdomain
  spf_value              = var.spf_value
  dkim_cnames            = var.dkim_cnames
  dmarc_value            = var.dmarc_value
  inbound_mx             = var.inbound_mx
}

module "static_cdn" {
  source = "../../modules/cloudflare-static-cdn"

  zone_id     = module.zone.zone_id
  domain      = var.domain
  origin_ipv4 = local.vps_ipv4
  origin_ipv6 = local.vps_ipv6
  enable_ipv6 = local.enable_ipv6
}

module "access" {
  source = "../../modules/cloudflare-access"

  enable_access  = var.enable_access
  account_id     = var.cloudflare_account_id
  domain         = var.domain
  admin_proxied  = module.zone.app_hosts_proxied
  allowed_emails = var.access_allowed_emails
}

module "waf" {
  source = "../../modules/cloudflare-waf"

  enable_app_waf         = var.enable_app_waf
  residency_decision_ref = var.residency_decision_ref
  zone_id                = module.zone.zone_id
  domain                 = var.domain
}
