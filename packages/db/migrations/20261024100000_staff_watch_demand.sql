-- Migration 20261024100000_staff_watch_demand: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #517)
-- Watch demand per source for the staff coverage tracker (#517, D-049). case_watch and
-- cause_list_watch are tenant tables under FORCE RLS, so, as with app_staff_conflict_rate (0082),
-- staff reach them only through a SECURITY DEFINER function that first refuses (42501) anyone but
-- an enabled staff_user. The result is counts per source id only: no workspace, proceeding, party
-- or user id. Additive only.
CREATE FUNCTION app_staff_watch_demand()
  RETURNS TABLE (source_id text, watches bigint, users bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    #variable_conflict use_column
    BEGIN
      PERFORM app_staff_require_caller();
      RETURN QUERY
        SELECT w.source_id, count(*)::bigint, count(DISTINCT w.who)::bigint
          FROM (
            SELECT c.source_id, c.advocate_user_id AS who FROM case_watch c WHERE c.enabled
            UNION ALL
            SELECT l.source_id, l.user_id AS who FROM cause_list_watch l
          ) w
         GROUP BY w.source_id;
    END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_staff_watch_demand() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_staff_watch_demand() TO causedeck_app, causedeck_clerk;
