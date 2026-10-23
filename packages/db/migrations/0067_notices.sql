-- Migration 0067_notices: table, enum, keys, indexes and checks follow the drizzle-kit shape of src/schema/notices.ts; grants, RLS, the scope guard and the seed rows hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #584)
-- The official notices feed (#584, part 1 of #480, D-048):
--   * notice: global table (GLOBAL_TABLES, no workspace, no RLS) of court, bar and Gazette notices read
--     from a cleared source. The app role may SELECT, INSERT and UPDATE it, never DELETE; the clerk
--     role has no privileges. One row per (source_id, url); the document is a storage key, sha256 and
--     media type (all set or all null), not a blob foreign key (blob is a tenant table).
--   * notice_match: tenant table under FORCE RLS with ws_isolation. matter_id is a composite
--     (workspace_id, matter_id) FK; forum_id is a single-column FK into the global-or-workspace forum
--     table guarded by app_reference_scope_guard in mode same_or_global. A match names a matter or a
--     forum, and is unique per workspace, notice and matter (or forum).
--   * Seed: one source row per notice page (kind 'notice'), fail closed (terms and counsel pending,
--     cleared_at null, http tier, zero cost cap). Staff confirm each base URL and read its terms before
--     clearing it. Additive only.
CREATE TYPE "public"."notice_kind" AS ENUM('circular', 'practice_direction', 'roster', 'holiday', 'registry', 'bar_council', 'gazette', 'other');--> statement-breakpoint
CREATE TABLE "notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"forum_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" "notice_kind" NOT NULL,
	"title" text NOT NULL,
	"issued_on" date NOT NULL,
	"effective_on" date,
	"url" text NOT NULL,
	"document_key" text,
	"document_sha256" text,
	"document_mime" text,
	"source_type" "source_type" NOT NULL,
	"source_ref" text,
	"anchor_id" uuid,
	"confidence" numeric(4, 3),
	"confirmation_state" "confirmation_state" DEFAULT 'proposed' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_source_url_uq" UNIQUE("source_id","url"),
	CONSTRAINT "notice_provenance_chk" CHECK ((source_type = 'manual' or anchor_id is not null or source_ref is not null) and (confidence is null or (confidence >= 0 and confidence <= 1))),
	CONSTRAINT "notice_title_chk" CHECK (btrim(title) <> ''),
	CONSTRAINT "notice_document_chk" CHECK ((document_key is null and document_sha256 is null and document_mime is null) or (document_key is not null and document_sha256 ~ '^[0-9a-f]{64}$' and document_mime is not null))
);
--> statement-breakpoint
CREATE TABLE "notice_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid NOT NULL,
	"matter_id" uuid,
	"forum_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "notice_match_target_chk" CHECK (matter_id is not null or forum_id is not null),
	CONSTRAINT "notice_match_reason_chk" CHECK (reason in ('forum', 'matter_forum'))
);
--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_match" ADD CONSTRAINT "notice_match_notice_id_notice_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_match" ADD CONSTRAINT "notice_match_forum_id_forum_id_fk" FOREIGN KEY ("forum_id") REFERENCES "public"."forum"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_match" ADD CONSTRAINT "notice_match_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_match" ADD CONSTRAINT "notice_match_matter_fk" FOREIGN KEY ("workspace_id","matter_id") REFERENCES "public"."matter"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notice_issued_on_idx" ON "notice" USING btree ("issued_on");--> statement-breakpoint
CREATE INDEX "notice_forum_codes_idx" ON "notice" USING gin ("forum_codes");--> statement-breakpoint
CREATE INDEX "notice_match_workspace_id_idx" ON "notice_match" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notice_match_matter_uq" ON "notice_match" USING btree ("workspace_id","notice_id","matter_id") WHERE matter_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notice_match_forum_uq" ON "notice_match" USING btree ("workspace_id","notice_id","forum_id") WHERE matter_id is null;--> statement-breakpoint
CREATE INDEX "notice_match_workspace_matter_idx" ON "notice_match" USING btree ("workspace_id","matter_id");--> statement-breakpoint
REVOKE ALL ON "notice" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notice" TO causedeck_app;--> statement-breakpoint
ALTER TABLE "notice_match" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notice_match" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "notice_match" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE TRIGGER "notice_match_forum_id_scope_guard" BEFORE INSERT OR UPDATE OF workspace_id, "forum_id" ON "notice_match" FOR EACH ROW EXECUTE FUNCTION app_reference_scope_guard('forum', 'forum_id', 'same_or_global');--> statement-breakpoint
INSERT INTO "source" ("id", "kind", "base_url", "owner", "access_mode", "rate_limit_per_minute", "notes") VALUES
  ('in.sc.notices', 'notice', 'https://www.sci.gov.in/', 'Supreme Court of India', 'A0', 1, 'Supreme Court notices and circulars. Terms: https://www.sci.gov.in/terms-conditions/. Uncleared: confirm the notice page URL and read the terms before clearing.'),
  ('in.tn.madras-hc.notices', 'notice', 'https://www.mhc.tn.gov.in/', 'High Court of Madras', 'A0', 1, 'Madras High Court notices, circulars and holiday lists. Terms: https://www.mhc.tn.gov.in/judis/. Uncleared: confirm the notice page URL and read the terms before clearing.'),
  ('in.ka.karnataka-hc.notices', 'notice', 'https://karnatakajudiciary.kar.nic.in/', 'High Court of Karnataka', 'A0', 1, 'Karnataka High Court notices and circulars. Terms: https://karnatakajudiciary.kar.nic.in/. Uncleared: confirm the notice page URL and read the terms before clearing.'),
  ('in.tn.chennai-district.notices', 'notice', 'https://districts.ecourts.gov.in/chennai', 'Chennai district courts (eCourts)', 'A0', 1, 'Chennai district court notices for the forum catalogue (chennai-district). Terms: https://districts.ecourts.gov.in/. Uncleared: confirm the notice page URL and read the terms before clearing.'),
  ('in.ka.bengaluru-district.notices', 'notice', 'https://districts.ecourts.gov.in/bangalore', 'Bengaluru Urban district courts (eCourts)', 'A0', 1, 'Bengaluru Urban district court notices for the forum catalogue (bengaluru-district). Terms: https://districts.ecourts.gov.in/. Uncleared: confirm the notice page URL and read the terms before clearing.'),
  ('in.tn.bctnp.notices', 'notice', 'https://www.barcounciltnpy.org/', 'Bar Council of Tamil Nadu and Puducherry', 'A0', 1, 'BCTNP notices to advocates. Terms: https://www.barcounciltnpy.org/. Uncleared: the base URL is unverified; confirm it and read the terms before clearing.'),
  ('in.ka.ksbc.notices', 'notice', 'https://www.karnatakabarcouncil.org/', 'Karnataka State Bar Council', 'A0', 1, 'KSBC notices to advocates. Terms: https://www.karnatakabarcouncil.org/. Uncleared: the base URL is unverified; confirm it and read the terms before clearing.'),
  ('in.gov.egazette.notices', 'notice', 'https://egazette.gov.in/', 'Department of Publication, Government of India', 'A0', 1, 'eGazette notifications. Terms: https://egazette.gov.in/. Uncleared: confirm the listing URL and read the terms before clearing.')
ON CONFLICT ("id") DO NOTHING;
