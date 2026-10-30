output "rds_endpoint" {
  description = "Private RDS endpoint. Build DATABASE_URL from it with sslmode=verify-full."
  value       = module.rds.endpoint
}

output "rds_replica_endpoint" {
  description = "Private Hyderabad replica endpoint."
  value       = module.rds.replica_endpoint
}

output "s3_bucket" {
  description = "Documents bucket. Set S3_BUCKET to it."
  value       = module.documents.bucket_name
}

output "alb_dns_name" {
  description = "ALB DNS name for the DNS-only app and api records."
  value       = module.alb.dns_name
}

output "cloudflare_lb_enabled" {
  description = "Whether the Cloudflare Load Balancer is used."
  value       = module.cloudflare_lb.enabled
}
