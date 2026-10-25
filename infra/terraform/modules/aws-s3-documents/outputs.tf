output "bucket_name" {
  description = "Primary documents bucket. Set S3_BUCKET to it."
  value       = aws_s3_bucket.documents.bucket
}

output "replica_bucket_name" {
  description = "Replica bucket in the second India region."
  value       = aws_s3_bucket.replica.bucket
}

output "kms_key_arn" {
  description = "Customer-managed key of the primary bucket."
  value       = aws_kms_key.primary.arn
}

output "workspace_prefix_policy_arn" {
  description = "IAM policy that scopes a principal tagged workspace_id to ws/<workspace_id>/."
  value       = aws_iam_policy.workspace_prefix.arn
}
