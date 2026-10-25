output "project_name" {
  description = "Pages project name."
  value       = cloudflare_pages_project.site.name
}

output "subdomain" {
  description = "<project>.pages.dev hostname (CNAME target)."
  value       = cloudflare_pages_project.site.subdomain
}

output "custom_domain" {
  description = "Custom domain attached to the project."
  value       = cloudflare_pages_domain.site.name
}
