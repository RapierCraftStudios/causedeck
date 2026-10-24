CREATE POLICY "owner_definer_read" ON "scim_token" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_scim_token_by_hash(p_token_hash text)
  RETURNS TABLE (id uuid, workspace_id uuid, expires_at timestamp with time zone, revoked_at timestamp with time zone)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.workspace_id, t.expires_at, t.revoked_at
    FROM scim_token t
    JOIN organization o ON o.id = t.workspace_id
    WHERE t.token_hash = p_token_hash AND o.deleted_at IS NULL
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_scim_token_by_hash(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_scim_token_by_hash(text) TO causedeck_app;
