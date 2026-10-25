variable "region" {
  description = "DigitalOcean region. India only: blr1."
  type        = string
  default     = "blr1"

  validation {
    condition     = contains(["blr1"], var.region)
    error_message = "region must be blr1 (India); tenant data never leaves India."
  }
}

variable "project" {
  description = "Project name used in resource names and the project tag."
  type        = string
  default     = "causedeck"
}

variable "env" {
  description = "Environment name (prod or staging)."
  type        = string
}

variable "size" {
  description = "Instance size."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "data_volume_gb" {
  description = "Size of the data disk (Postgres, MinIO, WAL spool) in GB."
  type        = number
  default     = 100
}

variable "ssh_allowlist" {
  description = "IPs or CIDRs allowed to reach port 22. Never open to the world."
  type        = list(string)

  validation {
    condition     = length(var.ssh_allowlist) > 0 && !contains(var.ssh_allowlist, "0.0.0.0/0") && !contains(var.ssh_allowlist, "::/0")
    error_message = "ssh_allowlist must be non-empty and must not contain 0.0.0.0/0 or ::/0."
  }
}

variable "deploy_pubkey" {
  description = "SSH public key installed for the deploy user by infra/scripts/bootstrap-vps.sh."
  type        = string

  validation {
    condition     = !strcontains(var.deploy_pubkey, "'")
    error_message = "deploy_pubkey must not contain a single quote."
  }
}

variable "bootstrap_url" {
  description = "Raw URL of infra/scripts/bootstrap-vps.sh; pin it to a tag or commit for production."
  type        = string
  default     = "https://raw.githubusercontent.com/RapierCraftStudios/causedeck/main/infra/scripts/bootstrap-vps.sh"
}

variable "bootstrap_sha256" {
  description = "Optional sha256 of the bootstrap script; cloud-init refuses to run it on mismatch."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Resource tags; project, env, owner and data_residency=in are required."
  type        = map(string)

  validation {
    condition     = alltrue([for k in ["project", "env", "owner", "data_residency"] : contains(keys(var.tags), k)]) && try(var.tags["data_residency"], "") == "in"
    error_message = "tags must contain project, env, owner and data_residency = \"in\"."
  }
}

variable "image" {
  description = "Droplet image."
  type        = string
  default     = "ubuntu-24-04-x64"
}
