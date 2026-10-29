variable "enabled" {
  description = "Create the Stage C resources. Off by default; Stage C is a skeleton until its triggers fire (docs in infra/runbooks/stage-c-orchestration.md)."
  type        = bool
  default     = false
}

variable "name" {
  description = "Name prefix."
  type        = string
}

# tflint-ignore: terraform_unused_declarations
# Kept as the India-only guard: its validation is asserted by test/stage-b-policy.test.mjs; the AWS provider region is set in the env root.
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

variable "worker_queues" {
  description = "pg-boss queues that get their own autoscaled worker service."
  type        = list(string)
  default     = ["default"]
}
