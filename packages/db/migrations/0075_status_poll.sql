-- Migration 0074_status_poll: no table change (hand-assembled, function only). `app_case_watch_due`
-- Reviewed-by: Claude (agent, #592)
-- lets the system `status.poll` job list the watches that are due across workspaces: case_watch is a
-- tenant table under FORCE RLS and the job has no workspace, so, like `app_judgment_alert_targets`,
-- the owner-defined function returns only the ids the job needs to run each lookup in its own scope.
CREATE FUNCTION app_case_watch_due(p_limit integer)
  RETURNS TABLE (watch_id uuid, workspace_id uuid, advocate_user_id uuid, source_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT w.id, w.workspace_id, w.advocate_user_id, w.source_id FROM case_watch w
    JOIN organization o ON o.id = w.workspace_id
    WHERE w.enabled AND o.deleted_at IS NULL
      AND (w.last_polled_at IS NULL OR w.last_polled_at + w.cadence_minutes * interval '1 minute' <= now())
    ORDER BY w.last_polled_at NULLS FIRST, w.id
    LIMIT greatest(p_limit, 0)
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_case_watch_due(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_case_watch_due(integer) TO causedeck_app;
