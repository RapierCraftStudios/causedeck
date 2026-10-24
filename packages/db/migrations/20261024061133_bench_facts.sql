-- Migration 20261024061133_bench_facts: generated shape (one table, one index, one FK, one check), grants, owner read policies and functions hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #521)
-- Internal bench facts (#521, D-050). bench_sitting_fact is global and staff-only: neutral counts and
-- pace per source, hall and sitting date, for data building and quality. There is no worker or
-- internal database role (the worker and the web both connect as causedeck_app), so the app and
-- clerk roles get no table grant at all and reach the table only through the owner-defined
-- app_bench_* functions below: a writer, an internal pace read, a neutral bench-card read and an
-- ids-only hall-to-bench lookup over active rosters (owner_definer_read policies let only the owner
-- role see the roster tables, as app_board_poll_targets does in 0076). No function returns a person's name,
-- a rate or a score. Expand only.
CREATE TABLE "bench_sitting_fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bench_id" uuid,
	"source_id" text NOT NULL,
	"hall_no" text NOT NULL,
	"sitting_date" date NOT NULL,
	"items_listed" integer NOT NULL,
	"items_heard" integer NOT NULL,
	"items_disposed" integer NOT NULL,
	"minutes_per_item" numeric(8, 2),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bench_sitting_fact_hall_day_uq" UNIQUE("source_id","hall_no","sitting_date"),
	CONSTRAINT "bench_sitting_fact_counts_chk" CHECK (items_listed >= 0 and items_heard >= 0 and items_disposed >= 0 and items_heard <= items_listed and items_disposed <= items_heard)
);
--> statement-breakpoint
CREATE INDEX "bench_sitting_fact_bench_idx" ON "bench_sitting_fact" USING btree ("bench_id","sitting_date");--> statement-breakpoint
REVOKE ALL ON "bench_sitting_fact" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "bench_roster" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "bench_roster_entry" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_bench_fact_record(
  p_source_id text, p_hall_no text, p_sitting_date date, p_bench_id uuid,
  p_items_listed integer, p_items_heard integer, p_items_disposed integer, p_minutes_per_item numeric
) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    INSERT INTO bench_sitting_fact
      (bench_id, source_id, hall_no, sitting_date, items_listed, items_heard, items_disposed, minutes_per_item)
    VALUES
      (p_bench_id, p_source_id, p_hall_no, p_sitting_date, p_items_listed, p_items_heard, p_items_disposed, p_minutes_per_item)
    ON CONFLICT (source_id, hall_no, sitting_date) DO UPDATE SET
      bench_id = excluded.bench_id,
      items_listed = excluded.items_listed,
      items_heard = excluded.items_heard,
      items_disposed = excluded.items_disposed,
      minutes_per_item = excluded.minutes_per_item,
      computed_at = now()
  $$;--> statement-breakpoint
CREATE FUNCTION app_bench_pace(p_source_id text, p_hall_no text, p_since date)
  RETURNS TABLE (sitting_date date, minutes_per_item numeric)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT f.sitting_date, f.minutes_per_item
    FROM bench_sitting_fact f
    WHERE f.source_id = p_source_id AND f.hall_no = p_hall_no AND f.sitting_date >= p_since
      AND f.minutes_per_item IS NOT NULL
    ORDER BY f.sitting_date
  $$;--> statement-breakpoint
CREATE FUNCTION app_bench_card(p_bench_id uuid, p_since date)
  RETURNS TABLE (sitting_date date, hall_no text, items_listed integer, items_heard integer, items_disposed integer, minutes_per_item numeric)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT f.sitting_date, f.hall_no, f.items_listed, f.items_heard, f.items_disposed, f.minutes_per_item
    FROM bench_sitting_fact f
    WHERE f.bench_id = p_bench_id AND f.sitting_date >= p_since
    ORDER BY f.sitting_date DESC, f.hall_no
  $$;--> statement-breakpoint
CREATE FUNCTION app_bench_for_halls(p_date date)
  RETURNS TABLE (forum_code text, hall_no text, bench_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT f.code, e.hall_no, (array_agg(DISTINCT e.bench_id))[1]
    FROM bench_roster r
    JOIN bench_roster_entry e ON e.workspace_id = r.workspace_id AND e.roster_id = r.id
    JOIN forum f ON f.id = r.forum_id
    WHERE r.status = 'active' AND r.confirmation_state <> 'proposed'
      AND r.effective_from <= p_date AND (r.effective_to IS NULL OR r.effective_to > p_date)
      AND e.bench_id IS NOT NULL
    GROUP BY f.code, e.hall_no
    HAVING count(DISTINCT e.bench_id) = 1
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_bench_fact_record(text, text, date, uuid, integer, integer, integer, numeric) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_bench_pace(text, text, date) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_bench_card(uuid, date) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_bench_for_halls(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_bench_fact_record(text, text, date, uuid, integer, integer, integer, numeric) TO causedeck_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_bench_pace(text, text, date) TO causedeck_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_bench_card(uuid, date) TO causedeck_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_bench_for_halls(date) TO causedeck_app;
