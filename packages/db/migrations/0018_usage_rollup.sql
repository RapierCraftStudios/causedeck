-- Migration 0018_usage_rollup: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #222)
-- The workspace-less `system.usage.rollup` job (#222, #30 part 5) copies usage_counter into
-- usage_period_summary, closes finished IST months and prunes summaries older than 13 months.
-- usage_counter and usage_period_summary are under FORCE row-level security, so, as with
-- app_billing_reconcile_targets (0007) and app_purge_job_effects (0006):
--   * owner_definer_read on usage_counter and usage_period_summary, and owner_definer_purge on
--     usage_period_summary, let only the owner (and so only definer functions) list or delete rows.
--   * app_usage_rollup_targets(since) returns ids only: the workspaces with a counter in a period
--     starting at or after `since`. The job then writes each workspace inside withWorkspace.
--   * app_purge_usage_period_summaries(cutoff) deletes summaries of periods starting before cutoff.
--   * usage_period_summary_immutable: a closed summary (closed_at set) never changes, and only the
--     owner (the purge function and the organization ON DELETE cascade) may delete it.
-- Additive only; the previous release never calls the functions.
CREATE POLICY "owner_definer_read" ON "usage_counter" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "usage_period_summary" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_purge" ON "usage_period_summary" AS PERMISSIVE FOR DELETE TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_usage_rollup_targets(since timestamptz)
  RETURNS TABLE (workspace_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT c.workspace_id FROM usage_counter c
    WHERE c.period_start >= since
    ORDER BY c.workspace_id
  $$;--> statement-breakpoint
CREATE FUNCTION app_purge_usage_period_summaries(cutoff timestamptz) RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH gone AS (DELETE FROM usage_period_summary s WHERE s.period_start < cutoff RETURNING 1)
    SELECT count(*) FROM gone
  $$;--> statement-breakpoint
CREATE FUNCTION app_usage_period_summary_immutable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
    BEGIN
      IF OLD.closed_at IS NOT NULL THEN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION '% for % is closed and cannot change', TG_TABLE_NAME, OLD.period_start
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF current_user <> (SELECT c.relowner::regrole::text FROM pg_class c WHERE c.oid = TG_RELID) THEN
          RAISE EXCEPTION '% for % is closed: only retention may delete it', TG_TABLE_NAME, OLD.period_start
            USING ERRCODE = 'insufficient_privilege';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END
  $$;--> statement-breakpoint
CREATE TRIGGER "usage_period_summary_immutable" BEFORE UPDATE OR DELETE ON "usage_period_summary"
  FOR EACH ROW EXECUTE FUNCTION app_usage_period_summary_immutable();--> statement-breakpoint
REVOKE ALL ON FUNCTION app_usage_rollup_targets(timestamptz), app_purge_usage_period_summaries(timestamptz),
  app_usage_period_summary_immutable() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_usage_rollup_targets(timestamptz), app_purge_usage_period_summaries(timestamptz),
  app_usage_period_summary_immutable() TO causedeck_app;
