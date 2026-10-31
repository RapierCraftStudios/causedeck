output "hostname" {
  description = "CDN hostname."
  value       = local.host
}

output "record_id" {
  description = "DNS record id of static.<domain> (A)."
  value       = cloudflare_dns_record.static.id
}
