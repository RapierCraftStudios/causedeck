-- Migration 0067_cause_list_watch: generated shape (two tables, keys, indexes), RLS, grants, function and source seed hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #482)
-- Karnataka HC cause-list watch (#482, D-048 tier 2, D-028 A2). cause_list_watch is a tenant table
-- under FORCE RLS (the advocate name or BRN a member watches). cause_list_publication is global and
-- content-free (URL, fetch time, sha256, row count; never the list body): one row per fetched
-- publication, shared by every workspace so one fetch serves everyone. The poll job reads watches
-- across workspaces only through app_cause_list_watch_targets (owner-defined, ids and keys only), as
-- app_notification_digest_targets does (0013). The source row is seeded uncleared (terms and counsel
-- pending until #118): policyFor refuses it, so nothing is fetched. Expand only.
CREATE TABLE "cause_list_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"list_key" text NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "cause_list_publication_sha_uq" UNIQUE("source_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "cause_list_watch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "cause_list_watch_uq" UNIQUE("workspace_id","user_id","source_id","kind","value"),
	CONSTRAINT "cause_list_watch_kind_chk" CHECK (kind in ('name', 'brn')),
	CONSTRAINT "cause_list_watch_value_chk" CHECK (char_length(value) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "cause_list_watch" ADD CONSTRAINT "cause_list_watch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cause_list_watch" ADD CONSTRAINT "cause_list_watch_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cause_list_publication_list_idx" ON "cause_list_publication" USING btree ("source_id","list_key","fetched_at");--> statement-breakpoint
CREATE INDEX "cause_list_watch_workspace_id_idx" ON "cause_list_watch" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "cause_list_watch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cause_list_watch" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "cause_list_watch" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "cause_list_watch" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
REVOKE ALL ON "cause_list_publication" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cause_list_publication" TO causedeck_app;--> statement-breakpoint
CREATE FUNCTION app_cause_list_watch_targets(p_source_id text)
  RETURNS TABLE (workspace_id uuid, user_id uuid, kind text, value text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT w.workspace_id, w.user_id, w.kind, w.value FROM cause_list_watch w
    JOIN organization o ON o.id = w.workspace_id
    WHERE w.source_id = p_source_id AND o.deleted_at IS NULL
    ORDER BY w.workspace_id, w.user_id, w.kind, w.value
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_cause_list_watch_targets(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_cause_list_watch_targets(text) TO causedeck_app;--> statement-breakpoint
INSERT INTO "source" ("id", "kind", "base_url", "owner", "access_mode", "max_tier", "rate_limit_per_minute", "notes")
VALUES (
  'in.ka.karnataka-hc.bengaluru:cause_list',
  'court',
  'https://karnatakajudiciary.kar.nic.in/',
  'Karnataka High Court',
  'A2',
  'http',
  1,
  'KHC public daily and advance cause list (HTML, no captcha). Uncleared until counsel (#118) clears terms; staff confirm the base URL before clearing.'
)
ON CONFLICT ("id") DO NOTHING;
