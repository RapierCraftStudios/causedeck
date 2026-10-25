# static.<tld>: proxied CDN host for hashed static assets only (no tenant data). Cache rules apply
# in order and a later matching rule overrides an earlier one, so the cache rule comes first and the
# bypass for requests carrying cookies or an Authorization header comes last and always wins.

locals {
  host = "static.${var.domain}"
}

resource "cloudflare_dns_record" "static" {
  zone_id = var.zone_id
  name    = local.host
  type    = "A"
  content = var.origin_ipv4
  ttl     = 1
  proxied = true
  comment = "Proxied CDN for hashed static assets"
}

resource "cloudflare_dns_record" "static_aaaa" {
  for_each = var.origin_ipv6 == "" ? toset([]) : toset(["static"])

  zone_id = var.zone_id
  name    = local.host
  type    = "AAAA"
  content = var.origin_ipv6
  ttl     = 1
  proxied = true
  comment = "Proxied CDN for hashed static assets"
}

resource "cloudflare_tiered_cache" "this" {
  zone_id = var.zone_id
  value   = "on"
}

resource "cloudflare_ruleset" "static_cache" {
  zone_id     = var.zone_id
  name        = "static-cdn-cache"
  description = "Cache hashed static paths only; bypass when cookies or Authorization are present"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules = [
    {
      description = "Cache hashed static assets"
      enabled     = true
      action      = "set_cache_settings"
      expression  = "(http.host eq \"${local.host}\" and (starts_with(http.request.uri.path, \"/_next/static/\") or http.request.uri.path.extension in {\"woff2\" \"woff\" \"ttf\" \"otf\" \"png\" \"jpg\" \"jpeg\" \"webp\" \"avif\" \"svg\" \"gif\" \"ico\"}))"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode    = "override_origin"
          default = 31536000
        }
        browser_ttl = {
          mode    = "override_origin"
          default = 31536000
        }
      }
    },
    {
      description = "Bypass cache for cookies or Authorization"
      enabled     = true
      action      = "set_cache_settings"
      expression  = "(http.host eq \"${local.host}\" and (http.cookie ne \"\" or any(http.request.headers[\"authorization\"][*] ne \"\")))"
      action_parameters = {
        cache = false
      }
    },
  ]
}
