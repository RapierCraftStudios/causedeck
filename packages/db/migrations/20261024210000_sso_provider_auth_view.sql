-- Migration 20261024210000_sso_provider_auth_view: hand-written (one policy, one view, one grant), no table changes; reviewed before commit.
-- Reviewed-by: Claude (agent, #683)
-- SSO sign-in (#683, #508 part 2). The Better Auth SSO plugin resolves a provider by email domain
-- or provider id before any workspace is known, so it cannot read the FORCE RLS table `sso_provider`
-- as the app role. `sso_provider_auth` is the plugin's read model: owned by the owner role, which
-- can read the table only through `owner_definer_read` (the 0006 pattern), so a view owner's
-- privileges are the only widening, and the view lists enabled providers only. It carries the
-- protocol settings (client secrets) because the plugin needs them to finish a sign-in: only the
-- auth server reads it, and the core service that edits providers never returns `config`.
-- Providers are written through the owner-only core service, never through this view. Expand only.
CREATE POLICY "owner_definer_read" ON "sso_provider" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE VIEW "sso_provider_auth" AS
  SELECT
    p.id::text AS provider_id,
    p.issuer,
    p.domain,
    CASE WHEN p.protocol = 'oidc' THEN p.config::text END AS oidc_config,
    CASE WHEN p.protocol = 'saml' THEN p.config::text END AS saml_config,
    p.workspace_id::text AS organization_id,
    p.created_by::text AS user_id
  FROM "sso_provider" p
  WHERE p.enabled;--> statement-breakpoint
REVOKE ALL ON "sso_provider_auth" FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON "sso_provider_auth" TO causedeck_app;
