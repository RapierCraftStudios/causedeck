-- Migration 0082_staff_conflict_rate: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #499)
-- The conflict rate per source that feeds adapter health (#499, D-026). listing is a tenant table
-- under FORCE RLS, so, as with app_staff_parse_yield (0072), staff reach it only through a SECURITY
-- DEFINER function that first refuses (42501) anyone but an enabled staff_user. A listing is one
-- source's reading of a proceeding's date; it counts as a conflict when it is not the canonical
-- date, a canonical date exists for the proceeding, the two differ and no person has rejected it
-- as an error (open `proposed`, or `corrected` by a person's choice). The source key is the host of
-- the listing's source reference (a fetched page) or, without one, its source type. The result is
-- counts per source key only: no workspace, proceeding, party or date. Additive only.
CREATE FUNCTION app_staff_conflict_rate(since timestamptz)
  RETURNS TABLE (source_key text, observations bigint, conflicts bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    #variable_conflict use_column
    BEGIN
      PERFORM app_staff_require_caller();
      RETURN QUERY
        SELECT coalesce(substring(l.source_ref from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)'), l.source_type::text),
               count(*)::bigint,
               (count(*) FILTER (
                  WHERE NOT l.canonical
                    AND l.confirmation_state IN ('proposed', 'corrected')
                    AND c.list_date IS NOT NULL
                    AND c.list_date <> l.list_date))::bigint
          FROM listing l
          LEFT JOIN listing c
            ON c.workspace_id = l.workspace_id AND c.proceeding_id = l.proceeding_id AND c.canonical
         WHERE l.captured_at >= since
         GROUP BY 1;
    END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_staff_conflict_rate(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_staff_conflict_rate(timestamptz) TO causedeck_app, causedeck_clerk;
