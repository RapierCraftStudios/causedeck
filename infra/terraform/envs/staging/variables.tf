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
  description = "India VPS provider: ovh_mumbai (default, D-037), do_blr1, lightsail_mumbai, or manual (a hand-ordered host; supply vps_ipv4 and optionally vps_ipv6)."
  type        = string
  default     = "ovh_mumbai"

  validation {
    condition     = contains(["ovh_mumbai", "do_blr1", "lightsail_mumbai", "manual"], var.vps_provider)
    error_message = "vps_provider must be ovh_mumbai, do_blr1, lightsail_mumbai or manual."
  }
}

variable "vps_datacenter" {
  description = "OVH datacenter for ovh_mumbai. YNM (Mumbai) is the only value allowed (D-009 residency)."
  type        = string
  default     = "YNM"

  validation {
    condition     = contains(["YNM"], var.vps_datacenter)
    error_message = "vps_datacenter must be YNM (OVH Mumbai); tenant data never leaves India (D-009)."
  }
}

variable "vps_ipv4" {
  description = "Public IPv4 of the host when vps_provider = manual. Ignored for the other providers."
  type        = string
  default     = ""

  validation {
    condition     = var.vps_provider != "manual" || can(cidrhost("${var.vps_ipv4}/32", 0))
    error_message = "vps_provider = manual requires vps_ipv4 to be a valid IPv4 address."
  }
}

variable "vps_ipv6" {
  description = "Public IPv6 of the host when vps_provider = manual. Empty creates no AAAA records."
  type        = string
  default     = ""

  validation {
    condition     = var.vps_ipv6 == "" || can(cidrhost("${var.vps_ipv6}/128", 0))
    error_message = "vps_ipv6 must be empty or a valid IPv6 address."
  }
}

variable "ovh_subsidiary" {
  description = "OVHcloud subsidiary that bills the order (ovh_mumbai)."
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
  description = "Operating system ordered with the OVH VPS: Ubuntu 24.04 or Debian 13."
  type        = string
  default     = "Ubuntu 24.04"
}

variable "ovh_public_ssh_key" {
  description = "Optional SSH public key OVH pre-installs on the VPS (needs ovh_image_id). Empty: install the deploy key with bootstrap-vps.sh."
  type        = string
  default     = ""
}

variable "ovh_image_id" {
  description = "OVH image id, required when ovh_public_ssh_key is set."
  type        = string
  default     = ""
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

  validation {
    condition     = var.residency_decision_ref == "" || can(regex("^(D-[0-9]+|docs/adr/[0-9]{4}-[A-Za-z0-9._-]+\\.md)", var.residency_decision_ref))
    error_message = "residency_decision_ref must start with a decision id (D-<number>, e.g. D-037) or an ADR path (docs/adr/NNNN-name.md)."
  }
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
  description = "Provider size (droplet size, Lightsail bundle or OVH plan code). Empty uses the env default."
  type        = string
  default     = ""
}

variable "data_volume_gb" {
  description = "Data disk size in GB."
  type        = number
  default     = 50
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
