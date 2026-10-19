-- Migration 0007_billing_reconcile: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #206)
-- Cross-tenant listing for the daily `system.billing.reconcile` job (#28 part 7). The job has no
-- workspace, and `subscription` is under FORCE row-level security (0006_rls_baseline), so it lists
-- its targets through an owner-defined SECURITY DEFINER function, the same pattern as
-- app_purge_job_effects:
--   * owner_definer_read lets the owner (and so only definer functions) SELECT subscription.
--   * app_billing_reconcile_targets() returns ids only: the workspace and subscription id of every
--     current (not cancelled/expired) subscription that reached the provider. The job then reads
--     each row inside withWorkspace, under ws_isolation.
--   * Additive only; the previous release never calls the function.
CREATE POLICY "owner_definer_read" ON "subscription" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_billing_reconcile_targets()
  RETURNS TABLE (workspace_id uuid, subscription_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.workspace_id, s.id FROM subscription s
    WHERE s.provider_subscription_id IS NOT NULL AND s.status NOT IN ('cancelled', 'expired')
    ORDER BY s.workspace_id, s.id
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_billing_reconcile_targets() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_billing_reconcile_targets() TO causedeck_app;
