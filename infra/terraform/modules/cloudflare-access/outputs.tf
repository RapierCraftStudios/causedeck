output "application_id" {
  description = "Access application id, or null when Access is disabled."
  value       = one(cloudflare_zero_trust_access_application.admin[*].id)
}
