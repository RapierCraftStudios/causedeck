-- Migration 0077_notice_match_targets: hand-written (one policy, one function), no table changes; reviewed before commit.
-- Reviewed-by: Claude (agent, #586)
-- Notice matching (#586, D-048). The notices poll has no workspace, so it finds the workspaces and
-- matters that use a forum only through app_notice_match_targets (owner-defined; ids and the forum
-- code only), as app_cause_list_watch_targets does (0068). owner_definer_read on proceeding backs it:
-- the owner role can read proceedings only through definer functions. Only catalogue (global)
-- forums match; a workspace's own forum never matches a notice. Expand only.
CREATE POLICY "owner_definer_read" ON "proceeding" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_notice_match_targets(p_forum_codes text[])
  RETURNS TABLE (workspace_id uuid, matter_id uuid, forum_id uuid, forum_code text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT p.workspace_id, p.matter_id, f.id, f.code FROM proceeding p
    JOIN forum f ON f.id = p.forum_id AND f.workspace_id IS NULL
    JOIN organization o ON o.id = p.workspace_id
    WHERE f.code = ANY (p_forum_codes) AND o.deleted_at IS NULL
    ORDER BY p.workspace_id, p.matter_id, f.code
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_notice_match_targets(text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_notice_match_targets(text[]) TO causedeck_app;
