output "endpoint" {
  description = "Private primary endpoint (host:port). Resolves only inside the VPC."
  value       = aws_db_instance.primary.endpoint
}

output "replica_endpoint" {
  description = "Private Hyderabad read replica endpoint."
  value       = aws_db_instance.replica.endpoint
}

output "kms_key_arn" {
  description = "Customer-managed KMS key of the primary."
  value       = aws_kms_key.primary.arn
}

output "replica_kms_key_arn" {
  description = "Customer-managed KMS key of the replica."
  value       = aws_kms_key.replica.arn
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret holding the master password (rotated by RDS)."
  value       = aws_db_instance.primary.master_user_secret[0].secret_arn
  sensitive   = true
}

output "security_group_id" {
  description = "Security group of the primary."
  value       = aws_security_group.primary.id
}

output "required_extensions" {
  description = "Extensions the migration must create after cutover."
  value       = ["vector", "pg_stat_statements"]
}
