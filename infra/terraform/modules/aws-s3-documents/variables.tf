variable "name" {
  description = "Bucket name prefix, for example causedeck-stage-b. Buckets are <name>-documents and <name>-documents-replica."
  type        = string
}

variable "region" {
  description = "Primary bucket region. India only."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.region)
    error_message = "region must be an India region: ap-south-1 or ap-south-2."
  }
}

variable "replica_region" {
  description = "Cross-region replication target. India only."
  type        = string
  default     = "ap-south-2"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.replica_region) && var.replica_region != var.region
    error_message = "replica_region must be the other India region (ap-south-1 or ap-south-2)."
  }
}

variable "account_id" {
  description = "AWS account id that owns the KMS key policies."
  type        = string
}

variable "kms_admin_role_arns" {
  description = "IAM roles that administer the keys (no use of the key)."
  type        = list(string)
}

variable "app_role_arns" {
  description = "IAM roles of the app and worker nodes that read and write documents."
  type        = list(string)
}

variable "noncurrent_version_days" {
  description = "Days a noncurrent object version is kept before expiry."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Tags on every resource."
  type        = map(string)
  default     = {}
}
