output "dns_name" {
  description = "ALB DNS name. Point app.<tld> and api.<tld> at it with DNS-only records."
  value       = aws_lb.app.dns_name
}

output "zone_id" {
  description = "Route 53 hosted zone id of the ALB (for alias records)."
  value       = aws_lb.app.zone_id
}

output "security_group_id" {
  description = "Security group of the ALB; allow it on the app nodes."
  value       = aws_security_group.alb.id
}

output "target_group_arn" {
  description = "App target group."
  value       = aws_lb_target_group.app.arn
}
