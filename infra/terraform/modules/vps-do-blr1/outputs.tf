output "ipv4" {
  description = "Public IPv4."
  value       = digitalocean_droplet.this.ipv4_address
}

output "ipv6" {
  description = "Public IPv6."
  value       = digitalocean_droplet.this.ipv6_address
}

output "instance_id" {
  description = "Provider instance id."
  value       = digitalocean_droplet.this.id
}

output "firewall_id" {
  description = "Provider firewall id."
  value       = digitalocean_firewall.this.id
}

output "data_volume_id" {
  description = "Data volume id."
  value       = digitalocean_volume.data.id
}
