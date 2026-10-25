output "primary_endpoint" {
  description = "Redis primary endpoint (private), or an empty string when disabled."
  value       = var.enabled ? aws_elasticache_replication_group.main[0].primary_endpoint_address : ""
}
