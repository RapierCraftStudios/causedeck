-- Migration 0066_fetch_log: generated shape (table, column, index), grants hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #479)
-- The governed fetch layer (#479, D-048): fetch_log is a global, content-free log of external fetches
-- (source, URL hash, status, tier, cost, time). The app role may SELECT and INSERT, never UPDATE or
-- DELETE; the clerk role has no privileges. source.captcha_bulk_cleared records a counsel clearance
-- for bulk captcha solving; it defaults to false and the captcha tier is raised in code, never stored,
-- so source_no_captcha_chk is unchanged.
CREATE TABLE "fetch_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"url_hash" text NOT NULL,
	"status" integer NOT NULL,
	"tier" "source_max_tier",
	"cost_dollars" numeric(12, 6) DEFAULT '0' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delegated_advocate_id" text
);
--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "captcha_bulk_cleared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "fetch_log_source_fetched_idx" ON "fetch_log" USING btree ("source_id","fetched_at");--> statement-breakpoint
REVOKE ALL ON "fetch_log" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT ON "fetch_log" TO causedeck_app;
