variable "name" {
  description = "Name prefix, for example causedeck-stage-b."
  type        = string
}

variable "region" {
  description = "Primary region. India only."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.region)
    error_message = "region must be an India region: ap-south-1 or ap-south-2."
  }
}

variable "replica_region" {
  description = "Read replica region (Hyderabad). India only."
  type        = string
  default     = "ap-south-2"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.replica_region)
    error_message = "replica_region must be an India region: ap-south-1 or ap-south-2."
  }
}

variable "account_id" {
  description = "AWS account id that owns the KMS key policies."
  type        = string
}

variable "kms_admin_role_arns" {
  description = "IAM roles that administer the keys (no use of the key). Separation of duties with kms_user_role_arns."
  type        = list(string)
}

variable "kms_user_role_arns" {
  description = "IAM roles that use the keys (RDS service roles, restore tooling). Cannot administer them."
  type        = list(string)
  default     = []
}

variable "vpc_id" {
  description = "VPC of the primary instance."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets (at least two AZs) for the primary. Public subnets are never accepted by the policy test."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Provide at least two private subnets in different availability zones."
  }
}

variable "replica_vpc_id" {
  description = "VPC of the replica in replica_region."
  type        = string
}

variable "replica_private_subnet_ids" {
  description = "Private subnets for the replica."
  type        = list(string)

  validation {
    condition     = length(var.replica_private_subnet_ids) >= 2
    error_message = "Provide at least two private subnets for the replica."
  }
}

variable "allowed_security_group_ids" {
  description = "Security groups (app and worker nodes) allowed to reach Postgres on 5432. No CIDR ingress exists."
  type        = list(string)
}

variable "replica_allowed_security_group_ids" {
  description = "Security groups in replica_region allowed to reach the replica."
  type        = list(string)
  default     = []
}

variable "engine_version" {
  description = "Postgres major version. pgvector ships with RDS for Postgres 17."
  type        = string
  default     = "17"
}

variable "instance_class" {
  description = "Instance class of primary and replica."
  type        = string
  default     = "db.m7g.large"
}

variable "allocated_storage_gb" {
  description = "Initial storage in GiB (gp3, autoscaling to max_allocated_storage_gb)."
  type        = number
  default     = 100
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling in GiB."
  type        = number
  default     = 500
}

variable "multi_az" {
  description = "Multi-AZ standby for the primary."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention, which is also the PITR window. 14 days matches Stage A (#101)."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35 so PITR is always on."
  }
}

variable "deletion_protection" {
  description = "Block deletion of the primary."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags on every resource."
  type        = map(string)
  default     = {}
}
