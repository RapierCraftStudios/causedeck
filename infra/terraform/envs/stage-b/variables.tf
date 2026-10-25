variable "aws_region" {
  description = "Primary AWS region. India only."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.aws_region)
    error_message = "aws_region must be an India region: ap-south-1 or ap-south-2."
  }
}

variable "replica_region" {
  description = "Replica region (Hyderabad). India only."
  type        = string
  default     = "ap-south-2"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.replica_region) && var.replica_region != var.aws_region
    error_message = "replica_region must be the other India region."
  }
}

variable "plan_with_dummy_credentials" {
  description = "Skip AWS credential and account validation so CI can plan with dummy credentials. Never true for a real apply."
  type        = bool
  default     = false
}

variable "account_id" {
  description = "AWS account id."
  type        = string
}

variable "owner" {
  description = "Owner tag."
  type        = string
}

variable "kms_admin_role_arns" {
  description = "IAM roles that administer the KMS keys."
  type        = list(string)
}

variable "kms_user_role_arns" {
  description = "IAM roles that use the RDS KMS key."
  type        = list(string)
  default     = []
}

variable "app_role_arns" {
  description = "IAM roles of the app and worker nodes (documents bucket access)."
  type        = list(string)
}

variable "vpc_id" {
  description = "VPC in the primary region."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets in the primary region (database)."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnets in the primary region (ALB)."
  type        = list(string)
}

variable "replica_vpc_id" {
  description = "VPC in the replica region."
  type        = string
}

variable "replica_private_subnet_ids" {
  description = "Private subnets in the replica region."
  type        = list(string)
}

variable "app_security_group_ids" {
  description = "Security groups of the app and worker nodes allowed to reach Postgres."
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate for the ALB."
  type        = string
}

variable "app_target_ids" {
  description = "Instance ids of the app nodes behind the ALB."
  type        = list(string)
  default     = []
}

variable "multi_az" {
  description = "Multi-AZ standby for the primary database."
  type        = bool
  default     = true
}

variable "domain" {
  description = "Registered domain, used by the optional Cloudflare LB."
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone id."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token. Supply via TF_VAR_cloudflare_api_token; never commit it."
  type        = string
  sensitive   = true
}

variable "enable_cloudflare_lb" {
  description = "Use the Cloudflare Load Balancer instead of the ALB. Off by default; needs residency_decision_ref and approval_doc."
  type        = bool
  default     = false
}

variable "residency_decision_ref" {
  description = "Pointer to the recorded founder decision D-037."
  type        = string
  default     = ""
}

variable "approval_doc" {
  description = "Path of the documented approval for the Cloudflare LB."
  type        = string
  default     = ""
}

variable "enable_stage_c" {
  description = "Create the Stage C skeletons (ECS Fargate cluster, ElastiCache). Off by default."
  type        = bool
  default     = false
}
