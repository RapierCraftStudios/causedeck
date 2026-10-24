-- Migration 20261024120000_portfolio_alert_targets: hand-written function, reviewed before commit.
-- Portfolio exception alerts (#665, #498 part 5): `app_portfolio_alert_targets` lets the system scan job list the live institution workspaces that have tracked cases (ids only) without a workspace scope. Expand only.
-- portfolio_case is under FORCE RLS, so the function owner needs a narrow read policy (as 0013 does for workspace_settings); only that role reads across workspaces and it never writes.
CREATE POLICY "owner_definer_read" ON "portfolio_case" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_portfolio_alert_targets()
  RETURNS TABLE (workspace_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT c.workspace_id FROM portfolio_case c
    JOIN organization o ON o.id = c.workspace_id
    WHERE o.kind = 'institution' AND o.deleted_at IS NULL
    ORDER BY c.workspace_id
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_portfolio_alert_targets() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_portfolio_alert_targets() TO causedeck_app;
