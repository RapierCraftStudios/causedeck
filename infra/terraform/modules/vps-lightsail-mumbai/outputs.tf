output "ipv4" {
  description = "Public IPv4 (static IP)."
  value       = aws_lightsail_static_ip.this.ip_address
}

output "ipv6" {
  description = "Public IPv6."
  value       = try(aws_lightsail_instance.this.ipv6_addresses[0], "")
}

output "instance_id" {
  description = "Provider instance id."
  value       = aws_lightsail_instance.this.id
}

output "firewall_id" {
  description = "Provider firewall (public ports) id."
  value       = aws_lightsail_instance_public_ports.this.id
}

output "data_volume_id" {
  description = "Data disk id."
  value       = aws_lightsail_disk.data.id
}
