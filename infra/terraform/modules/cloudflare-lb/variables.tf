variable "enable_cloudflare_lb" {
  description = "Create the Cloudflare Load Balancer. Off by default: the ALB is the default entry. Needs residency_decision_ref and approval_doc."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_cloudflare_lb || (length(trimspace(var.residency_decision_ref)) > 0 && length(trimspace(var.approval_doc)) > 0)
    error_message = "enable_cloudflare_lb = true requires residency_decision_ref (the recorded founder decision accepting the residency trade-off, D-037) and approval_doc (the path of the approval record)."
  }
}

variable "residency_decision_ref" {
  description = "Reference to the recorded residency decision (D-037)."
  type        = string
  default     = ""
}

variable "approval_doc" {
  description = "Path or URL of the documented approval, for example docs/adr/0053-stage-b-c-scale-path.md#approval."
  type        = string
  default     = ""
}

variable "account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone id."
  type        = string
}

variable "hostname" {
  description = "Load balancer hostname, for example app.example.in."
  type        = string
}

variable "origin_addresses" {
  description = "Origin app node addresses (name => IP or hostname)."
  type        = map(string)
  default     = {}
}

variable "health_check_path" {
  description = "Readiness path used by the monitor."
  type        = string
  default     = "/readyz"
}

variable "proxied" {
  description = "Proxy the hostname through Cloudflare. False keeps it DNS-only (no traffic through the edge)."
  type        = bool
  default     = false

  validation {
    condition     = !var.proxied || length(trimspace(var.residency_decision_ref)) > 0
    error_message = "proxied = true requires residency_decision_ref (D-037)."
  }
}
