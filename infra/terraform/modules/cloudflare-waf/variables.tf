variable "enable_app_waf" {
  description = "Create the managed WAF rules and rate limits. Off by default; needs residency_decision_ref."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_app_waf || length(trimspace(var.residency_decision_ref)) > 0
    error_message = "enable_app_waf = true requires residency_decision_ref (the recorded founder decision accepting the residency trade-off, D-037)."
  }
}

variable "residency_decision_ref" {
  description = "Reference to the recorded residency decision (D-037)."
  type        = string
  default     = ""
}

variable "zone_id" {
  description = "Cloudflare zone id."
  type        = string
}

variable "domain" {
  description = "Registered domain."
  type        = string
}

variable "rate_limit_requests" {
  description = "Requests allowed per IP per 10 seconds on api.<domain> before blocking."
  type        = number
  default     = 100
}
