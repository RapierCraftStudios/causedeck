-- Migration 20261025020100_sso_provider_lookup: hand-written (one policy, one function, one grant), no table changes; reviewed before commit.
-- Reviewed-by: Claude (agent, #683)
-- SSO sign-in (#683, #508 part 2). The Better Auth SSO plugin resolves a provider by email domain
-- or provider id before any workspace is known, so the app role cannot read the FORCE RLS table
-- `sso_provider` directly. `app_sso_provider_lookup` is the narrow, keyed read (the `app_slug_taken`
-- pattern): SECURITY DEFINER, it returns at most ONE enabled provider for an exact provider id or an
-- exact domain, never a list, so no query can enumerate other tenants' providers. The owner role is
-- reachable only through definer functions (`owner_definer_read`, the 0006 pattern); the app role
-- gets no SELECT on the table and no view over it. The one caller that needs the protocol settings
-- is the auth server finishing a sign-in, which names the provider by its unguessable id (or the
-- domain the user typed); the core service that edits providers never returns `config`.
-- Only a provider whose domain was proven by DNS (`domain_verified_at`) is returned, so an
-- organisation can never sign in, or link existing accounts, for a domain it does not control.
-- Providers are written through the owner-only core service only. Expand only.
CREATE POLICY "owner_definer_read" ON "sso_provider" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION "app_sso_provider_lookup"(p_provider_id text, p_domain text)
  RETURNS TABLE (
    id text,
    issuer text,
    domain text,
    oidc_config text,
    saml_config text,
    organization_id text,
    user_id text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT
      p.id::text,
      p.issuer,
      p.domain,
      CASE WHEN p.protocol = 'oidc' THEN p.config::text END,
      CASE WHEN p.protocol = 'saml' THEN p.config::text END,
      p.workspace_id::text,
      p.created_by::text
    FROM sso_provider p
    WHERE p.enabled AND p.domain_verified_at IS NOT NULL
      AND ((p_provider_id IS NOT NULL AND p.id::text = p_provider_id)
        OR (p_provider_id IS NULL AND p_domain IS NOT NULL AND p.domain = lower(btrim(p_domain))))
    LIMIT 1
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_sso_provider_lookup"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_sso_provider_lookup"(text, text) TO causedeck_app;
