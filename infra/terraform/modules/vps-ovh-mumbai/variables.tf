variable "datacenter" {
  description = "OVH VPS datacenter. India only: YNM (Mumbai). Any other value is rejected (D-009 residency)."
  type        = string
  default     = "YNM"

  validation {
    condition     = contains(["YNM"], var.datacenter)
    error_message = "datacenter must be YNM (OVH Mumbai); tenant data never leaves India."
  }
}

variable "project" {
  description = "Project name used in the display name."
  type        = string
  default     = "causedeck"
}

variable "env" {
  description = "Environment name (prod, staging, stage-b)."
  type        = string
}

variable "name_suffix" {
  description = "Optional suffix for the display name (for example db-primary), so several nodes can share an env."
  type        = string
  default     = ""
}

variable "plan_code" {
  description = "OVH catalogue plan code. vps-2027-model3 is the prod VPS-3, vps-2027-model1 the staging VPS-1."
  type        = string
  default     = "vps-2027-model3"

  validation {
    condition     = can(regex("^vps-[a-z0-9-]+$", var.plan_code))
    error_message = "plan_code must be an OVH VPS plan code such as vps-2027-model3."
  }
}

variable "plan_duration" {
  description = "Billing interval, ISO 8601. The catalogue prices a 12-month commitment as interval P1M with pricing mode upfront12."
  type        = string
  default     = "P1M"
}

variable "plan_pricing_mode" {
  description = "OVH pricing mode: default (monthly, no commitment) or upfront12 (12-month term, D-037)."
  type        = string
  default     = "upfront12"

  validation {
    condition     = contains(["default", "upfront12"], var.plan_pricing_mode)
    error_message = "plan_pricing_mode must be default or upfront12."
  }
}

variable "ovh_subsidiary" {
  description = "OVHcloud subsidiary that bills the order (country code, for example IN)."
  type        = string
  default     = "IN"
}

variable "vps_os" {
  description = "Operating system installed at order time."
  type        = string
  default     = "Ubuntu 24.04"

  validation {
    condition     = contains(["Ubuntu 24.04", "Debian 13"], var.vps_os)
    error_message = "vps_os must be Ubuntu 24.04 or Debian 13."
  }
}

variable "public_ssh_key" {
  description = "SSH public key pre-installed by OVH. Needs image_id as well; leave empty to add the deploy key through infra/scripts/bootstrap-vps.sh."
  type        = string
  default     = ""

  validation {
    condition     = !strcontains(var.public_ssh_key, "'")
    error_message = "public_ssh_key must not contain a single quote."
  }
}

variable "image_id" {
  description = "OVH image id (GET /vps/{serviceName}/images/available). Required when public_ssh_key is set."
  type        = string
  default     = ""

  validation {
    condition     = var.public_ssh_key == "" || var.image_id != ""
    error_message = "image_id is required when public_ssh_key is set (OVH requirement)."
  }
}

variable "automated_backup_days" {
  description = "Retention of the OVH automated backup option (it is a mandatory addon of the 2027 range): 1 or 7 days."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 7], var.automated_backup_days)
    error_message = "automated_backup_days must be 1 or 7 (the catalogue's option-auto-backup-2027-1 and -7)."
  }
}

variable "plan_options" {
  description = "Catalogue plan codes of the options ordered with the VPS. Null derives the mandatory 2027-range ones (local storage and automated backup) from plan_code."
  type        = list(string)
  default     = null
}
