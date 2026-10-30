# Pages project for apps/site. The build runs from the monorepo root and publishes the static
# export (`output: 'export'`) from apps/site/out. Production builds main; every other branch gets a
# preview deployment.

locals {
  custom_domain = var.site_label == "@" ? var.domain : "${var.site_label}.${var.domain}"
}

resource "cloudflare_pages_project" "site" {
  account_id        = var.account_id
  name              = var.project_name
  production_branch = var.production_branch

  build_config = {
    build_command   = "pnpm install --frozen-lockfile && pnpm --filter @causedeck/site build"
    destination_dir = "apps/site/out"
    root_dir        = "/"
    build_caching   = true
  }

  deployment_configs = {
    production = {
      env_vars = {
        NODE_VERSION = { type = "plain_text", value = var.node_version }
        PNPM_VERSION = { type = "plain_text", value = "10" }
      }
    }
    preview = {
      env_vars = {
        NODE_VERSION = { type = "plain_text", value = var.node_version }
        PNPM_VERSION = { type = "plain_text", value = "10" }
      }
    }
  }
}

resource "cloudflare_pages_domain" "site" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.site.name
  name         = local.custom_domain
}
