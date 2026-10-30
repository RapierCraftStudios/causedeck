output "enabled" {
  description = "Whether the Cloudflare load balancer exists."
  value       = var.enable_cloudflare_lb
}

output "hostname" {
  description = "Load balancer hostname, or an empty string when disabled."
  value       = var.enable_cloudflare_lb ? cloudflare_load_balancer.app[0].name : ""
}
