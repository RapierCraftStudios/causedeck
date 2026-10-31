output "vps_ipv4" {
  description = "VPS public IPv4."
  value       = local.vps_ipv4
}

output "vps_ipv6" {
  description = "VPS public IPv6."
  value       = local.vps_ipv6
}

output "dns_record_ids" {
  description = "DNS record ids (app, api, admin, site)."
  value       = module.zone.dns_record_ids
}

output "dns_app_hosts_proxied" {
  description = "Whether app, api and admin are proxied."
  value       = module.zone.app_hosts_proxied
}

output "pages_project_name" {
  description = "Cloudflare Pages project name."
  value       = module.pages.project_name
}

output "name_servers" {
  description = "Name servers to set at the registrar."
  value       = module.zone.name_servers
}
