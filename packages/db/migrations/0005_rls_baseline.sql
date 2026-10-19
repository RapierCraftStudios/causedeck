-- Migration 0005_rls_baseline: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #208)
-- Row-level security baseline (#19 part 1, spike §4.1, docs/engineering/tenancy.md).
--   * GUC helpers app_current_workspace() / app_current_user() read the transaction-local settings
--     pinned by withWorkspace / withUser (packages/db/src/rls.ts).
--   * Every tenant table gets ENABLE + FORCE ROW LEVEL SECURITY and `ws_isolation` (the statements
--     are exactly what tenantPolicy() in packages/db/src/rls-policies.ts emits).
--   * organization (the tenant root) is readable as the current workspace or, before a workspace is
--     selected, by its members (app.user_id); member_self lets a user list their own memberships.
--   * FORCE binds the owner too, so the owner gets narrow read/purge policies used only by the
--     SECURITY DEFINER lookups below (pre-workspace flows that must see across tenants and return
--     ids or booleans, never other tenants' rows).
--   * Public defaults are revoked; the app role gets DML on the tables and EXECUTE on the functions.
CREATE FUNCTION app_current_workspace() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;--> statement-breakpoint
CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "member" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_self" ON "member" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (app_current_workspace() IS NULL AND user_id = app_current_user());--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "invitation" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "invitation" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
ALTER TABLE "workspace_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "workspace_settings" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "workspace_slug_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_slug_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "workspace_slug_history" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "workspace_slug_history" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_release" ON "workspace_slug_history" AS PERMISSIVE FOR DELETE TO causedeck_owner
  USING (expires_at <= now());--> statement-breakpoint
ALTER TABLE "job_effect" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_effect" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "job_effect" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "job_effect" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_purge" ON "job_effect" AS PERMISSIVE FOR DELETE TO causedeck_owner
  USING (true);--> statement-breakpoint
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "organization" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (id = app_current_workspace()) WITH CHECK (id = app_current_workspace());--> statement-breakpoint
CREATE POLICY "member_read" ON "organization" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    app_current_workspace() IS NULL
    AND EXISTS (
      SELECT 1 FROM member m WHERE m.workspace_id = organization.id AND m.user_id = app_current_user()
    )
  );--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "organization" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
-- Slugs held by any workspace (live or soft-deleted) or by an unexpired redirect, among `candidates`.
CREATE FUNCTION app_slug_taken(candidates text[]) RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.slug::text FROM organization o WHERE o.slug = ANY (candidates::citext[])
    UNION
    SELECT h.slug::text FROM workspace_slug_history h
    WHERE h.slug = ANY (candidates::citext[]) AND h.expires_at > now()
  $$;--> statement-breakpoint
-- Whether `wanted` is free for workspace `for_workspace` (its own redirects do not block it).
CREATE FUNCTION app_slug_available(wanted text, for_workspace uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT NOT EXISTS (
             SELECT 1 FROM organization o WHERE o.slug = wanted::citext AND o.id <> for_workspace
           )
       AND NOT EXISTS (
             SELECT 1 FROM workspace_slug_history h
             WHERE h.slug = wanted::citext AND h.expires_at > now() AND h.workspace_id <> for_workspace
           )
  $$;--> statement-breakpoint
-- Drop expired redirects for `slugs`, whichever workspace they belonged to, so a slug can be reused.
CREATE FUNCTION app_release_expired_slugs(slugs text[]) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    DELETE FROM workspace_slug_history h
    WHERE h.slug = ANY (slugs::citext[]) AND h.expires_at <= now()
  $$;--> statement-breakpoint
-- The live workspace a slug points at, directly or through an unexpired redirect.
CREATE FUNCTION app_resolve_slug(wanted text) RETURNS TABLE (workspace_id uuid, redirected boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.id, false FROM organization o
    WHERE o.slug = wanted::citext AND o.deleted_at IS NULL
    UNION ALL
    SELECT h.workspace_id, true
    FROM workspace_slug_history h JOIN organization o ON o.id = h.workspace_id
    WHERE h.slug = wanted::citext AND h.expires_at > now() AND o.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization c WHERE c.slug = wanted::citext AND c.deleted_at IS NULL
      )
    LIMIT 1
  $$;--> statement-breakpoint
-- The workspace of the invitation with this token hash (the caller then scopes to it).
CREATE FUNCTION app_invitation_workspace(hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT i.workspace_id FROM invitation i WHERE i.token_hash = hash $$;--> statement-breakpoint
-- Retention sweep: delete job_effect rows completed before `cutoff` in every workspace.
CREATE FUNCTION app_purge_job_effects(cutoff timestamptz) RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH gone AS (DELETE FROM job_effect j WHERE j.completed_at < cutoff RETURNING 1)
    SELECT count(*) FROM gone
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_current_workspace(), app_current_user(), app_slug_taken(text[]),
  app_slug_available(text, uuid), app_release_expired_slugs(text[]), app_resolve_slug(text),
  app_invitation_workspace(text), app_purge_job_effects(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_workspace(), app_current_user(), app_slug_taken(text[]),
  app_slug_available(text, uuid), app_release_expired_slugs(text[]), app_resolve_slug(text),
  app_invitation_workspace(text), app_purge_job_effects(timestamptz) TO causedeck_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE causedeck_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO causedeck_app;
