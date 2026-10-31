output "cluster_arn" {
  description = "ECS cluster ARN, or an empty string when disabled."
  value       = var.enabled ? aws_ecs_cluster.main[0].arn : ""
}

output "worker_queues" {
  description = "Queues that get a worker service once enabled."
  value       = var.worker_queues
}
