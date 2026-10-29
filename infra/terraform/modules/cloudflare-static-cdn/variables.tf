variable "zone_id" {
  description = "Cloudflare zone id."
  type        = string
}

variable "domain" {
  description = "Registered domain; the CDN host is static.<domain>."
  type        = string
}

variable "origin_ipv4" {
  description = "Public IPv4 of the India VPS serving the hashed static assets."
  type        = string
}

variable "origin_ipv6" {
  description = "Public IPv6 of the VPS; used as the AAAA content when enable_ipv6 is set."
  type        = string
  default     = ""
}

variable "enable_ipv6" {
  description = "Create the AAAA record. A plan-time constant (not derived from origin_ipv6, which is unknown until the VPS exists)."
  type        = bool
  default     = false
}
