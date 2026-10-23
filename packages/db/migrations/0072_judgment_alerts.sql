-- Migration 0071_judgment_alerts: tables, keys, checks and indexes follow the drizzle schema (hand-assembled: drizzle-kit is not installed on the build host), RLS and the targets function hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #497)
-- Judgment alerts (#497, D-048, D-004): matter_issue_tag (statutes and sections a matter turns on,
-- confirmed by the lawyer) and judgment_alert (a corpus judgment that cites a confirmed tag), tenant
-- tables under FORCE RLS with ws_isolation. `app_judgment_alert_targets` lets the system scan job list
-- the live workspaces that have a confirmed tag (ids only) without a workspace scope. Expand only.
CREATE TABLE "judgment_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"judgment_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "judgment_alert_matter_judgment_uq" UNIQUE("workspace_id","matter_id","judgment_id"),
	CONSTRAINT "judgment_alert_page_chk" CHECK (page_no >= 1)
);
--> statement-breakpoint
CREATE TABLE "matter_issue_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"statute" text NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"issue" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source" text NOT NULL,
	"confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "matter_issue_tag_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "matter_issue_tag_matter_statute_section_uq" UNIQUE("workspace_id","matter_id","statute","section"),
	CONSTRAINT "matter_issue_tag_status_chk" CHECK (status in ('proposed', 'confirmed', 'dismissed')),
	CONSTRAINT "matter_issue_tag_source_chk" CHECK (source in ('ai', 'manual')),
	CONSTRAINT "matter_issue_tag_statute_chk" CHECK (statute <> ''),
	CONSTRAINT "matter_issue_tag_confidence_chk" CHECK (confidence is null or (confidence >= 0 and confidence <= 1))
);
--> statement-breakpoint
ALTER TABLE "judgment_alert" ADD CONSTRAINT "judgment_alert_judgment_id_judgment_id_fk" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgment_alert" ADD CONSTRAINT "judgment_alert_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgment_alert" ADD CONSTRAINT "judgment_alert_matter_fk" FOREIGN KEY ("workspace_id","matter_id") REFERENCES "public"."matter"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgment_alert" ADD CONSTRAINT "judgment_alert_tag_fk" FOREIGN KEY ("workspace_id","tag_id") REFERENCES "public"."matter_issue_tag"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_issue_tag" ADD CONSTRAINT "matter_issue_tag_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_issue_tag" ADD CONSTRAINT "matter_issue_tag_matter_fk" FOREIGN KEY ("workspace_id","matter_id") REFERENCES "public"."matter"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judgment_alert_workspace_id_idx" ON "judgment_alert" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "matter_issue_tag_workspace_id_idx" ON "matter_issue_tag" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "matter_issue_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matter_issue_tag" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "matter_issue_tag" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "judgment_alert" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "judgment_alert" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "judgment_alert" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE FUNCTION app_judgment_alert_targets()
  RETURNS TABLE (workspace_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT t.workspace_id FROM matter_issue_tag t
    JOIN organization o ON o.id = t.workspace_id
    WHERE t.status = 'confirmed' AND o.deleted_at IS NULL
    ORDER BY t.workspace_id
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_judgment_alert_targets() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_judgment_alert_targets() TO causedeck_app;
