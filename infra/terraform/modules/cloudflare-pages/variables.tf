variable "account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "project_name" {
  description = "Pages project name."
  type        = string
}

variable "domain" {
  description = "Registered domain."
  type        = string
}

variable "site_label" {
  description = "\"site\" (site.<domain>) or \"@\" (apex)."
  type        = string
  default     = "site"
}

variable "production_branch" {
  description = "Git branch deployed to production."
  type        = string
  default     = "main"
}

variable "node_version" {
  description = "Node version for the Pages build (matches .nvmrc)."
  type        = string
  default     = "22"
}
