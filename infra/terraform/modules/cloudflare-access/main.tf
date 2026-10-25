# Access application and policy for the admin host; created only when enable_access = true.

resource "cloudflare_zero_trust_access_policy" "admin" {
  count = var.enable_access ? 1 : 0

  account_id = var.account_id
  name       = "admin-operators"
  decision   = "allow"
  include    = [for e in var.allowed_emails : { email = { email = e } }]
}

resource "cloudflare_zero_trust_access_application" "admin" {
  count = var.enable_access ? 1 : 0

  account_id       = var.account_id
  name             = "causedeck-admin"
  domain           = "admin.${var.domain}"
  type             = "self_hosted"
  session_duration = var.session_duration
  policies         = [{ id = cloudflare_zero_trust_access_policy.admin[0].id }]

  lifecycle {
    precondition {
      condition     = var.admin_proxied
      error_message = "Cloudflare Access only protects proxied hostnames: set app_proxied = true with residency_decision_ref before enable_access."
    }
    precondition {
      condition     = length(var.allowed_emails) > 0
      error_message = "allowed_emails must list at least one operator when enable_access is true."
    }
  }
}
