variable "name" {
  description = "Name prefix."
  type        = string
}

variable "region" {
  description = "ALB region. India only."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.region)
    error_message = "region must be an India region: ap-south-1 or ap-south-2."
  }
}

variable "vpc_id" {
  description = "VPC of the app nodes."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets (two AZs) for the load balancer."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "Provide at least two subnets in different availability zones."
  }
}

variable "certificate_arn" {
  description = "ACM certificate (ap-south-1) for the app and api hostnames."
  type        = string
}

variable "app_target_ids" {
  description = "Instance ids of the app nodes registered in the app target group."
  type        = list(string)
  default     = []
}

variable "app_port" {
  description = "Port the web container listens on."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "Readiness path checked on every target."
  type        = string
  default     = "/readyz"
}

variable "ingress_cidrs" {
  description = "CIDRs allowed to reach 80 and 443."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_waf" {
  description = "Associate web_acl_arn with the ALB. Off by default."
  type        = bool
  default     = false
}

variable "web_acl_arn" {
  description = "WAFv2 web ACL (regional, ap-south-1) used when enable_waf is true."
  type        = string
  default     = ""

  validation {
    condition     = var.web_acl_arn == "" || can(regex("^arn:aws:wafv2:ap-south-[12]:", var.web_acl_arn))
    error_message = "web_acl_arn must be a WAFv2 ARN in ap-south-1 or ap-south-2."
  }
}

variable "tags" {
  description = "Tags on every resource."
  type        = map(string)
  default     = {}
}
