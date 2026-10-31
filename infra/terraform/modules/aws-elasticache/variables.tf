variable "enabled" {
  description = "Create the Stage C resources. Off by default; Stage C is a skeleton until its triggers fire (docs in infra/runbooks/stage-c-orchestration.md)."
  type        = bool
  default     = false
}

variable "name" {
  description = "Name prefix."
  type        = string
}

# Kept as the India-only guard: its validation is asserted by test/stage-b-policy.test.mjs; the AWS provider region is set in the env root.
# tflint-ignore: terraform_unused_declarations
variable "region" {
  description = "Region. India only."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.region)
    error_message = "region must be an India region: ap-south-1 or ap-south-2."
  }
}

variable "tags" {
  description = "Tags on every resource."
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  description = "Private subnets for the cache."
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "Security groups allowed to reach the cache."
  type        = list(string)
  default     = []
}

variable "node_type" {
  description = "Cache node type."
  type        = string
  default     = "cache.t4g.small"
}
