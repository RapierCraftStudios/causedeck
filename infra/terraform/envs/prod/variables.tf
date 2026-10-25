variable "domain" {
  description = "Registered domain (the Cloudflare zone)."
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to the zone and Pages. Supply via TF_VAR_cloudflare_api_token; never commit it."
  type        = string
  sensitive   = true
}

variable "vps_provider" {
  description = "India VPS provider: do_blr1 or lightsail_mumbai."
  type        = string
  default     = "do_blr1"

  validation {
    condition     = contains(["do_blr1", "lightsail_mumbai"], var.vps_provider)
    error_message = "vps_provider must be do_blr1 or lightsail_mumbai."
  }
}

variable "app_proxied" {
  description = "Proxy app, api and admin through Cloudflare. Off by default for residency; needs residency_decision_ref."
  type        = bool
  default     = false

  validation {
    condition     = !var.app_proxied || length(trimspace(var.residency_decision_ref)) > 0
    error_message = "app_proxied = true requires residency_decision_ref (the recorded founder decision accepting the residency trade-off, D-037)."
  }
}

variable "enable_app_waf" {
  description = "Create the Cloudflare WAF and rate limit rules. Off by default; needs residency_decision_ref."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_app_waf || length(trimspace(var.residency_decision_ref)) > 0
    error_message = "enable_app_waf = true requires residency_decision_ref (the recorded founder decision accepting the residency trade-off, D-037)."
  }
}

variable "enable_access" {
  description = "Create the Cloudflare Access application for the admin host. Off by default; needs app_proxied."
  type        = bool
  default     = false
}

variable "residency_decision_ref" {
  description = "Reference to the recorded residency decision (D-037), e.g. a decision log id or issue URL."
  type        = string
  default     = ""
}

variable "owner" {
  description = "Owner tag on every resource."
  type        = string
}

variable "ssh_allowlist" {
  description = "IPs or CIDRs allowed to SSH to the VPS."
  type        = list(string)
}

variable "deploy_pubkey" {
  description = "SSH public key for the deploy user."
  type        = string
}

variable "access_allowed_emails" {
  description = "Operator emails allowed through Cloudflare Access (used when enable_access)."
  type        = list(string)
  default     = []
}

variable "vps_size" {
  description = "Provider size slug (droplet size or Lightsail bundle). Empty uses the module default."
  type        = string
  default     = ""
}

variable "data_volume_gb" {
  description = "Data disk size in GB."
  type        = number
  default     = 100
}

variable "bootstrap_url" {
  description = "Raw URL of infra/scripts/bootstrap-vps.sh; pin to a tag or commit."
  type        = string
  default     = "https://raw.githubusercontent.com/RapierCraftStudios/causedeck/main/infra/scripts/bootstrap-vps.sh"
}

variable "bootstrap_sha256" {
  description = "Optional sha256 of the bootstrap script."
  type        = string
  default     = ""
}

variable "site_label" {
  description = "\"site\" (site.<domain>) or \"@\" (apex) for the Pages site."
  type        = string
  default     = "site"
}

variable "spf_value" {
  description = "SES SPF TXT value; fill after SES verification."
  type        = string
  default     = ""
}

variable "dkim_cnames" {
  description = "SES DKIM CNAMEs (name => target); fill after SES verification."
  type        = map(string)
  default     = {}
}

variable "dmarc_value" {
  description = "DMARC TXT value."
  type        = string
  default     = ""
}

variable "inbound_mx" {
  description = "Inbound MX records."
  type = list(object({
    host     = string
    priority = number
  }))
  default = []
}
