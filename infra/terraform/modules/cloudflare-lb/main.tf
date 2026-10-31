# Optional alternative to the ALB (#106). Cloudflare Load Balancing steers DNS answers; with
# proxied = true it also puts tenant traffic through Cloudflare edges outside India, so the module
# cannot be enabled without residency_decision_ref and approval_doc (see variables.tf).

resource "cloudflare_load_balancer_monitor" "readyz" {
  count = var.enable_cloudflare_lb ? 1 : 0

  account_id     = var.account_id
  type           = "https"
  method         = "GET"
  path           = var.health_check_path
  expected_codes = "200"
  interval       = 60
  timeout        = 5
  retries        = 2
  description    = "causedeck readiness"
}

resource "cloudflare_load_balancer_pool" "app" {
  count = var.enable_cloudflare_lb ? 1 : 0

  account_id = var.account_id
  name       = "causedeck-app"
  monitor    = cloudflare_load_balancer_monitor.readyz[0].id

  origins = [for name, address in var.origin_addresses : {
    name    = name
    address = address
    enabled = true
  }]
}

resource "cloudflare_load_balancer" "app" {
  count = var.enable_cloudflare_lb ? 1 : 0

  zone_id          = var.zone_id
  name             = var.hostname
  default_pools    = [cloudflare_load_balancer_pool.app[0].id]
  fallback_pool    = cloudflare_load_balancer_pool.app[0].id
  proxied          = var.proxied
  steering_policy  = "off"
  session_affinity = "none"
}
