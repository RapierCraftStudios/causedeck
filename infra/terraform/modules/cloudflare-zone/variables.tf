variable "domain" {
  description = "Registered domain (the Cloudflare zone name), e.g. example.in."
  type        = string
}

variable "account_id" {
  description = "Cloudflare account id that owns the zone."
  type        = string
}

variable "vps_ipv4" {
  description = "Public IPv4 of the India VPS (origin for app, api and admin)."
  type        = string
}

variable "vps_ipv6" {
  description = "Public IPv6 of the India VPS; used as the AAAA content when enable_ipv6 is set."
  type        = string
  default     = ""
}

variable "enable_ipv6" {
  description = "Create the AAAA records. A plan-time constant (not derived from vps_ipv6, which is unknown until the VPS exists)."
  type        = bool
  default     = false
}

variable "app_proxied" {
  description = "Proxy app, api and admin through Cloudflare. Off by default: matter data must not transit Cloudflare edges (D-037)."
  type        = bool
  default     = false

  validation {
    condition     = !var.app_proxied || length(trimspace(var.residency_decision_ref)) > 0
    error_message = "app_proxied = true requires residency_decision_ref (the recorded founder decision accepting the residency trade-off, D-037)."
  }
}

variable "residency_decision_ref" {
  description = "Reference to the recorded residency decision (D-037) that allows proxying app hostnames."
  type        = string
  default     = ""

  validation {
    condition     = var.residency_decision_ref == "" || can(regex("^(D-[0-9]+|docs/adr/[0-9]{4}-[A-Za-z0-9._-]+\\.md)", var.residency_decision_ref))
    error_message = "residency_decision_ref must start with a decision id (D-<number>, e.g. D-037) or an ADR path (docs/adr/NNNN-name.md)."
  }
}

variable "site_label" {
  description = "Record name for the marketing site: \"site\" (site.<domain>) or \"@\" (apex)."
  type        = string
  default     = "site"
}

variable "pages_subdomain" {
  description = "<project>.pages.dev hostname of the Pages project (CNAME target for the site)."
  type        = string
}

# Email DNS: filled after SES verification (see README, "SES DNS"). Empty values create nothing.
variable "spf_value" {
  description = "SPF TXT value for the apex, e.g. \"v=spf1 include:amazonses.com ~all\"."
  type        = string
  default     = ""
}

variable "dkim_cnames" {
  description = "SES DKIM CNAMEs: record name (<token>._domainkey) => target (<token>.dkim.amazonses.com)."
  type        = map(string)
  default     = {}
}

variable "dmarc_value" {
  description = "DMARC TXT value for _dmarc, e.g. \"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.in\"."
  type        = string
  default     = ""
}

variable "inbound_mx" {
  description = "MX records for inbound mail (e.g. SES inbound in ap-south-1)."
  type = list(object({
    host     = string
    priority = number
  }))
  default = []
}
