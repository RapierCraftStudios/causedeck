-- Migration 0033_staff_console_reads: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #310)
-- The staff console's workspace metadata lookup and platform staff audit (#310, part of #27; spike
-- §4.2, §6; PRD PL-6). Every table they read is under FORCE RLS, so, as with
-- app_end_staff_support_sessions (0026) and app_usage_rollup_targets (0018):
--   * owner_definer_read on member and workspace_feature_flag lets only the owner (and so only
--     definer functions) read them across workspaces. organization (0006), subscription (0007),
--     audit_event (0008) and usage_counter (0018) already have one.
--   * app_staff_workspace_search(q, max), app_staff_workspace_metadata(ws) and
--     app_staff_audit_events(before_at, before_id, max) are SECURITY DEFINER and first refuse
--     (42501) unless app.user_id is an enabled staff_user: the web app shares causedeck_app, so the
--     gate lives here, not only in the admin proxy. Core calls them inside withUser(staff).
--   * They return metadata only: no matter, document, memory, party or draft content, no member
--     data beyond the owner's email, and no audit metadata, IP or user agent.
-- Additive only; the previous release never calls the functions.
CREATE POLICY "owner_definer_read" ON "member" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "workspace_feature_flag" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
-- Raise unless the acting user (app.user_id) is an enabled staff member.
CREATE FUNCTION app_staff_require_caller() RETURNS void
  LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
  AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM staff_user s WHERE s.user_id = app_current_user() AND s.disabled_at IS NULL
      ) THEN
        RAISE EXCEPTION 'staff console reads need an enabled staff user'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END
  $$;--> statement-breakpoint
-- The metadata row of each workspace in `ids`, newest first. Called only by the definer functions.
CREATE FUNCTION app_staff_workspace_rows(ids uuid[])
  RETURNS TABLE (
    workspace_id uuid, slug text, name text, kind text, plan_id text, seats integer,
    clerk_seats integer, member_count integer, owner_email text, storage_bytes bigint,
    created_at timestamptz, last_active_at timestamptz, deleted_at timestamptz, flags jsonb
  )
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT o.id, o.slug::text, o.name, o.kind, coalesce(s.plan_id, o.plan_id), s.seats,
           s.clerk_seats,
           (SELECT count(*)::integer FROM member m
             WHERE m.workspace_id = o.id AND m.status = 'active'),
           (SELECT u.email FROM member m JOIN "user" u ON u.id = m.user_id
             WHERE m.workspace_id = o.id AND m.role = 'owner'
             ORDER BY m.joined_at, m.id LIMIT 1),
           coalesce((SELECT c.value FROM usage_counter c
                      WHERE c.workspace_id = o.id AND c.key = 'storage.bytes'
                      ORDER BY c.period_start DESC LIMIT 1), 0),
           o.created_at,
           (SELECT max(a.created_at) FROM audit_event a WHERE a.workspace_id = o.id),
           o.deleted_at,
           coalesce((SELECT jsonb_agg(jsonb_build_object('key', f.key, 'enabled', f.enabled)
                                      ORDER BY f.key)
                       FROM workspace_feature_flag f WHERE f.workspace_id = o.id), '[]'::jsonb)
      FROM organization o
      LEFT JOIN LATERAL (
        SELECT x.plan_id, x.seats, x.clerk_seats FROM subscription x
         WHERE x.workspace_id = o.id
         ORDER BY x.status IN ('cancelled', 'expired'), x.created_at DESC
         LIMIT 1
      ) s ON true
     WHERE o.id = ANY (ids)
     ORDER BY o.created_at DESC, o.id
  $$;--> statement-breakpoint
-- Workspaces whose slug is `q` or starts with it, or whose owner's email is `q`.
CREATE FUNCTION app_staff_workspace_search(q text, max integer)
  RETURNS TABLE (
    workspace_id uuid, slug text, name text, kind text, plan_id text, seats integer,
    clerk_seats integer, member_count integer, owner_email text, storage_bytes bigint,
    created_at timestamptz, last_active_at timestamptz, deleted_at timestamptz, flags jsonb
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    #variable_conflict use_column
    DECLARE
      needle text := lower(btrim(coalesce(q, '')));
      pattern text;
    BEGIN
      PERFORM app_staff_require_caller();
      IF needle = '' THEN
        RETURN;
      END IF;
      pattern := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
      RETURN QUERY
        SELECT r.* FROM app_staff_workspace_rows(ARRAY(
          SELECT o.id FROM organization o WHERE lower(o.slug::text) LIKE pattern
          UNION
          SELECT m.workspace_id FROM member m JOIN "user" u ON u.id = m.user_id
           WHERE m.role = 'owner' AND lower(u.email) = needle
        )) r
        LIMIT least(greatest(coalesce(max, 20), 1), 50);
    END
  $$;--> statement-breakpoint
-- One workspace's metadata row (none when it does not exist).
CREATE FUNCTION app_staff_workspace_metadata(ws uuid)
  RETURNS TABLE (
    workspace_id uuid, slug text, name text, kind text, plan_id text, seats integer,
    clerk_seats integer, member_count integer, owner_email text, storage_bytes bigint,
    created_at timestamptz, last_active_at timestamptz, deleted_at timestamptz, flags jsonb
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    #variable_conflict use_column
    BEGIN
      PERFORM app_staff_require_caller();
      RETURN QUERY SELECT r.* FROM app_staff_workspace_rows(ARRAY[ws]) r;
    END
  $$;--> statement-breakpoint
-- Staff actions (actor_kind 'staff'), newest first, older than the cursor (before_at, before_id)
-- when given. The session id is the support or auth session the event targets, else metadata.supportSessionId.
CREATE FUNCTION app_staff_audit_events(before_at timestamptz, before_id uuid, max integer)
  RETURNS TABLE (
    id uuid, created_at timestamptz, actor_user_id uuid, action text, workspace_id uuid,
    session_id text, outcome text
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    #variable_conflict use_column
    DECLARE
      cursor_at timestamptz := before_at;
    BEGIN
      PERFORM app_staff_require_caller();
      -- The exact (microsecond) time of the cursor row, which a client may have rounded.
      IF before_id IS NOT NULL THEN
        SELECT coalesce(a.created_at, before_at) INTO cursor_at
          FROM (SELECT 1) one LEFT JOIN audit_event a ON a.id = before_id;
      END IF;
      RETURN QUERY
        SELECT a.id, a.created_at, a.actor_user_id, a.action, a.workspace_id,
               CASE WHEN a.target_kind IN ('support_session', 'session') THEN a.target_id
                    ELSE a.metadata ->> 'supportSessionId' END,
               a.outcome::text
          FROM audit_event a
         WHERE a.actor_kind = 'staff'
           AND (cursor_at IS NULL OR a.created_at < cursor_at
                OR (before_id IS NOT NULL AND a.created_at = cursor_at AND a.id < before_id))
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT least(greatest(coalesce(max, 50), 1), 100);
    END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_staff_require_caller(), app_staff_workspace_rows(uuid[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_staff_workspace_search(text, integer), app_staff_workspace_metadata(uuid), app_staff_audit_events(timestamptz, uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_staff_workspace_search(text, integer), app_staff_workspace_metadata(uuid), app_staff_audit_events(timestamptz, uuid, integer) TO causedeck_app, causedeck_clerk;
