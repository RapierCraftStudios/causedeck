# Zone, DNSSEC and records. app, api and admin are DNS-only (grey cloud) unless app_proxied is set
# together with residency_decision_ref; only the Pages site record is proxied here (static.<tld> is
# proxied by cloudflare-static-cdn). Cloudflare tags do not exist for DNS resources.

locals {
  app_hosts = toset(["app", "api", "admin"])
  site_name = var.site_label == "@" ? var.domain : "${var.site_label}.${var.domain}"
}

resource "cloudflare_zone" "this" {
  account = {
    id = var.account_id
  }
  name = var.domain
  type = "full"
}

resource "cloudflare_zone_dnssec" "this" {
  zone_id = cloudflare_zone.this.id
  status  = "active"
}

resource "cloudflare_dns_record" "app_hosts_a" {
  for_each = local.app_hosts

  zone_id = cloudflare_zone.this.id
  name    = "${each.value}.${var.domain}"
  type    = "A"
  content = var.vps_ipv4
  ttl     = 1
  proxied = var.app_proxied
  comment = "India VPS (${each.value}); DNS-only unless app_proxied with residency_decision_ref"
}

resource "cloudflare_dns_record" "app_hosts_aaaa" {
  for_each = var.enable_ipv6 ? local.app_hosts : toset([])

  zone_id = cloudflare_zone.this.id
  name    = "${each.value}.${var.domain}"
  type    = "AAAA"
  content = var.vps_ipv6
  ttl     = 1
  proxied = var.app_proxied
  comment = "India VPS (${each.value}); DNS-only unless app_proxied with residency_decision_ref"
}

# Marketing site on Cloudflare Pages: proxied (no tenant data).
resource "cloudflare_dns_record" "site" {
  zone_id = cloudflare_zone.this.id
  name    = local.site_name
  type    = "CNAME"
  content = var.pages_subdomain
  ttl     = 1
  proxied = true
  comment = "Cloudflare Pages (apps/site)"
}

resource "cloudflare_dns_record" "spf" {
  for_each = var.spf_value == "" ? toset([]) : toset(["spf"])

  zone_id = cloudflare_zone.this.id
  name    = var.domain
  type    = "TXT"
  content = var.spf_value
  ttl     = 1
  comment = "SES SPF"
}

resource "cloudflare_dns_record" "dkim" {
  for_each = var.dkim_cnames

  zone_id = cloudflare_zone.this.id
  name    = "${each.key}.${var.domain}"
  type    = "CNAME"
  content = each.value
  ttl     = 1
  proxied = false
  comment = "SES DKIM"
}

resource "cloudflare_dns_record" "dmarc" {
  for_each = var.dmarc_value == "" ? toset([]) : toset(["dmarc"])

  zone_id = cloudflare_zone.this.id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = var.dmarc_value
  ttl     = 1
  comment = "DMARC"
}

resource "cloudflare_dns_record" "inbound_mx" {
  for_each = { for mx in var.inbound_mx : mx.host => mx }

  zone_id  = cloudflare_zone.this.id
  name     = var.domain
  type     = "MX"
  content  = each.value.host
  priority = each.value.priority
  ttl      = 1
  comment  = "Inbound mail"
}
