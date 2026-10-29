variable "vps_datacenter" {
  description = "OVH datacenter for every node. YNM (Mumbai) is the only value allowed (D-009 residency)."
  type        = string
  default     = "YNM"

  validation {
    condition     = contains(["YNM"], var.vps_datacenter)
    error_message = "vps_datacenter must be YNM (OVH Mumbai); tenant data never leaves India (D-009)."
  }
}

variable "db_plan_code" {
  description = "OVH plan code of the Postgres primary and its streaming replica (VPS-4 by default, 8 vCPU / 24 GB). A dedicated server is ordered by hand when VPS-4 is outgrown."
  type        = string
  default     = "vps-2027-model4"
}

variable "app_plan_code" {
  description = "OVH plan code of each stateless app node (VPS-3 by default, as in Stage A prod)."
  type        = string
  default     = "vps-2027-model3"
}

variable "app_node_count" {
  description = "Number of app nodes (web, api, admin, worker) behind DNS or the Cloudflare LB. Two or more; the keys are 1..N and known at plan time."
  type        = number
  default     = 2

  validation {
    condition     = var.app_node_count >= 2 && var.app_node_count <= 8 && floor(var.app_node_count) == var.app_node_count
    error_message = "app_node_count must be a whole number from 2 to 8 (Stage B is multi-node; past 8 move to Stage C)."
  }
}

variable "ovh_subsidiary" {
  description = "OVHcloud subsidiary that bills the orders."
  type        = string
  default     = "IN"
}

variable "ovh_pricing_mode" {
  description = "OVH pricing mode: upfront12 (12-month term, D-037) or default (monthly, no commitment)."
  type        = string
  default     = "upfront12"

  validation {
    condition     = contains(["upfront12", "default"], var.ovh_pricing_mode)
    error_message = "ovh_pricing_mode must be upfront12 or default."
  }
}

variable "vps_os" {
  description = "Operating system ordered with every node: Ubuntu 24.04 or Debian 13."
  type        = string
  default     = "Ubuntu 24.04"
}

variable "ovh_public_ssh_key" {
  description = "Optional SSH public key OVH pre-installs (needs ovh_image_id). Empty: install the deploy key with bootstrap-vps.sh."
  type        = string
  default     = ""
}

variable "ovh_image_id" {
  description = "OVH image id, required when ovh_public_ssh_key is set."
  type        = string
  default     = ""
}
