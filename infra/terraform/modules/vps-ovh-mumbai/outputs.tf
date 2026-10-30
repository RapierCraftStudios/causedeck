output "ipv4" {
  description = "Public IPv4."
  value       = local.ipv4
}

output "ipv6" {
  description = "Public IPv6."
  value       = local.ipv6
}

output "instance_id" {
  description = "OVH service name of the VPS."
  value       = ovh_vps.this.name
}

output "datacenter" {
  description = "OVH datacenter the VPS was ordered in (always YNM)."
  value       = var.datacenter
}
