# Managed rules and rate limits for the app hostnames. Only meaningful when the hostnames are
# proxied, which requires the residency decision; both are off by default.

resource "cloudflare_ruleset" "managed" {
  count = var.enable_app_waf ? 1 : 0

  zone_id     = var.zone_id
  name        = "app-managed-waf"
  description = "Cloudflare managed ruleset for app, api and admin"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules = [
    {
      description = "Execute the Cloudflare Managed Ruleset"
      enabled     = true
      action      = "execute"
      expression  = "(http.host in {\"app.${var.domain}\" \"api.${var.domain}\" \"admin.${var.domain}\"})"
      action_parameters = {
        id = "efb7b8c949ac4650a09736fc376e9aee"
      }
    },
  ]
}

resource "cloudflare_ruleset" "rate_limit" {
  count = var.enable_app_waf ? 1 : 0

  zone_id     = var.zone_id
  name        = "api-rate-limit"
  description = "Per-IP rate limit on the API host"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [
    {
      description = "Rate limit api"
      enabled     = true
      action      = "block"
      expression  = "(http.host eq \"api.${var.domain}\")"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = var.rate_limit_requests
        mitigation_timeout  = 10
      }
    },
  ]
}
