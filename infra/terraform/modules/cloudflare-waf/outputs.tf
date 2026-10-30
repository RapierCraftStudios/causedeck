output "managed_ruleset_id" {
  description = "Managed WAF ruleset id, or null when the WAF is disabled."
  value       = one(cloudflare_ruleset.managed[*].id)
}
