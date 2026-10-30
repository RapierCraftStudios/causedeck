output "zone_id" {
  description = "Cloudflare zone id."
  value       = cloudflare_zone.this.id
}

output "name_servers" {
  description = "Name servers to set at the registrar."
  value       = cloudflare_zone.this.name_servers
}

output "dns_record_ids" {
  description = "Record ids for app, api, admin (A) and site."
  value = merge(
    { for k, r in cloudflare_dns_record.app_hosts_a : k => r.id },
    { site = cloudflare_dns_record.site.id },
  )
}

output "app_hosts_proxied" {
  description = "Whether app, api and admin are proxied (false unless the residency decision is recorded)."
  value       = var.app_proxied
}

output "site_hostname" {
  description = "Hostname the marketing site is served on."
  value       = local.site_name
}
