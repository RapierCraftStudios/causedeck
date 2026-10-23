-- Migration 0072_staff_parse_yield: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #514)
-- The staff Data Ops console's parse yield (#514, D-049). adapter_parse_run is a tenant table under
-- FORCE RLS with owner_definer_read (0044), so, as with the 0033 staff reads, staff reach it only
-- through a SECURITY DEFINER function that first refuses (42501) anyone but an enabled staff_user.
-- It returns counts per adapter only (adapter id, runs, rows parsed, rows anchored): no workspace,
-- document, party or row content. Additive only; the previous release never calls it.
CREATE FUNCTION app_staff_parse_yield(since timestamptz)
  RETURNS TABLE (adapter_id text, runs bigint, rows_parsed bigint, rows_anchored bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    #variable_conflict use_column
    BEGIN
      PERFORM app_staff_require_caller();
      RETURN QUERY
        SELECT r.adapter_id, count(*)::bigint, coalesce(sum(r.rows_parsed), 0)::bigint,
               coalesce(sum(r.rows_anchored), 0)::bigint
          FROM adapter_parse_run r
         WHERE r.created_at >= since
         GROUP BY r.adapter_id;
    END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_staff_parse_yield(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_staff_parse_yield(timestamptz) TO causedeck_app, causedeck_clerk;
