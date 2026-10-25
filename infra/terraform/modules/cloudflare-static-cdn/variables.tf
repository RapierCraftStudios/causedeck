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
  description = "Public IPv6 of the VPS; empty skips the AAAA record."
  type        = string
  default     = ""
}
