variable "enable_access" {
  description = "Create the Access application and policy for the admin host. Off by default."
  type        = bool
  default     = false
}

variable "account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "domain" {
  description = "Registered domain; the admin host is admin.<domain>."
  type        = string
}

variable "admin_proxied" {
  description = "Whether admin.<domain> is proxied. Access only protects proxied hostnames, so enabling it needs the recorded residency decision."
  type        = bool
  default     = false
}

variable "allowed_emails" {
  description = "Operator email addresses allowed through Access."
  type        = list(string)
  default     = []
}

variable "session_duration" {
  description = "Access session length."
  type        = string
  default     = "8h"
}
