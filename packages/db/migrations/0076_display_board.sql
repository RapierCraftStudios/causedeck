-- Migration 0076_display_board: generated shape (one table, one index, one check), grants, owner read policies, function and source seed hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #493)
-- Court-day display boards (#493, D-048). board_observation is global and content-free (hall, item now
-- being heard, state, items passed over; never a party, case or advocate): one row each time a hall's
-- board changes, shared by every workspace, and the pace history for the call-time estimate. The
-- board poll reads today's listings across workspaces only through app_board_poll_targets
-- (owner-defined, ids and keys only; owner_definer_read policies let only the owner role see the
-- tables, as app_cause_list_watch_targets does in 0068). The two board sources are seeded uncleared
-- (counsel clearance, #118): policyFor refuses them, so nothing is fetched. Expand only.
CREATE TABLE "board_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"hall_no" text NOT NULL,
	"item_no" text,
	"status" text NOT NULL,
	"passed_over" text[] DEFAULT '{}'::text[] NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_observation_status_chk" CHECK (status in ('sitting', 'risen', 'passed_over', 'lunch'))
);
--> statement-breakpoint
CREATE INDEX "board_observation_hall_idx" ON "board_observation" USING btree ("source_id","hall_no","observed_at");--> statement-breakpoint
REVOKE ALL ON "board_observation" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT ON "board_observation" TO causedeck_app;--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "listing" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "proceeding" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "matter" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_board_poll_targets(p_date date)
  RETURNS TABLE (workspace_id uuid, listing_id uuid, proceeding_id uuid, owner_user_id uuid, slug text, forum_code text, hall_no text, item_no text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT l.workspace_id, l.id, l.proceeding_id, m.user_id, o.slug, f.code, h.hall_no, l.item_no
    FROM listing l
    JOIN court_hall h ON h.id = l.hall_id
    JOIN forum f ON f.id = h.forum_id
    JOIN proceeding p ON p.workspace_id = l.workspace_id AND p.id = l.proceeding_id
    JOIN matter mt ON mt.workspace_id = p.workspace_id AND mt.id = p.matter_id
    JOIN member m ON m.workspace_id = mt.workspace_id AND m.id = mt.owner_member_id AND m.status = 'active'
    JOIN organization o ON o.id = l.workspace_id AND o.deleted_at IS NULL
    WHERE l.list_date = p_date AND l.item_no IS NOT NULL AND p.state <> 'disposed' AND NOT mt.sensitive
    ORDER BY l.workspace_id, l.id
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_board_poll_targets(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_board_poll_targets(date) TO causedeck_app;--> statement-breakpoint
INSERT INTO "source" ("id", "kind", "base_url", "owner", "access_mode", "max_tier", "rate_limit_per_minute", "notes")
VALUES (
  'in.tn.madras-hc.chennai:display_board',
  'court',
  'https://www.mhc.tn.gov.in/',
  'Madras High Court',
  'A2',
  'http',
  30,
  'Madras HC hall display board (item now being heard). Polled every few minutes in court hours only. Uncleared until counsel (#118) clears terms; staff confirm the base URL and whether a captcha applies (delegated lookups only) before clearing.'
), (
  'in.ka.karnataka-hc.bengaluru:display_board',
  'court',
  'https://karnatakajudiciary.kar.nic.in/',
  'Karnataka High Court',
  'A2',
  'http',
  30,
  'Karnataka HC hall display board (item now being heard). Polled every few minutes in court hours only. Uncleared until counsel (#118) clears terms; staff confirm the base URL and whether a captcha applies (delegated lookups only) before clearing.'
)
ON CONFLICT ("id") DO NOTHING;
