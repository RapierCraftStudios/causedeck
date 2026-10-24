-- Migration 0079_news: generated shape (tables, indexes, keys, check), grants, RLS and seed rows hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #481)
-- The legal news digest (#481, D-048).
--   * news_item is global (GLOBAL_TABLES, no workspace, no RLS): feed-provided headline, link, date,
--     capped excerpt, tags and provenance. There is no body column. The app role may SELECT, INSERT
--     and UPDATE (tags and excerpt refresh on a repeat poll), never DELETE; the clerk role has none.
--   * news_pref is a tenant table (tenantTable(): ENABLE + FORCE RLS and ws_isolation, as
--     tenantPolicy() emits): one row per member with followed practice areas, forums, digest time.
--   * Seed: two candidate news sources, uncleared (terms and counsel pending, cleared_at null), so
--     nothing is fetched until staff review the terms and clear them. The feed URL is the base_url.
CREATE TABLE "news_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"excerpt" text,
	"tags" jsonb DEFAULT '{"practiceAreas":[],"forums":[]}'::jsonb NOT NULL,
	"provenance_sha256" text NOT NULL,
	"provenance_fetched_at" timestamp with time zone NOT NULL,
	"provenance_source_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_item_excerpt_chk" CHECK ("news_item"."excerpt" is null or char_length("news_item"."excerpt") <= 500)
);
--> statement-breakpoint
CREATE TABLE "news_pref" (
	"user_id" uuid NOT NULL,
	"practice_areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"forums" text[] DEFAULT '{}'::text[] NOT NULL,
	"digest_time" text DEFAULT '07:30' NOT NULL,
	"last_digest_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "news_pref_pkey" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "news_pref" ADD CONSTRAINT "news_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_pref" ADD CONSTRAINT "news_pref_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_item_source_url_uq" ON "news_item" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "news_item_published_idx" ON "news_item" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "news_pref_workspace_id_idx" ON "news_pref" USING btree ("workspace_id");--> statement-breakpoint
REVOKE ALL ON "news_item" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "news_item" TO causedeck_app;--> statement-breakpoint
ALTER TABLE "news_pref" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "news_pref" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "news_pref" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
INSERT INTO "source" ("id", "kind", "base_url", "owner", "access_mode", "rate_limit_per_minute", "retention_days", "max_tier", "max_cost_dollars", "notes") VALUES
	('news.scconline.blog', 'news', 'https://www.scconline.com/blog/feed/', 'EBC Publishing (SCC Online)', 'A0', 1, 365, 'http', '0.01', 'Candidate. RSS feed of the SCC Online blog. Terms not reviewed: headline, link and the feed excerpt only, attribution required; no full text without a licence. Uncleared until terms and counsel are cleared.'),
	('news.lawtrend', 'news', 'https://lawtrend.in/feed/', 'LawTrend', 'A0', 1, 365, 'http', '0.01', 'Candidate. RSS feed of LawTrend. Terms not reviewed: headline, link and the feed excerpt only, attribution required; no full text without a licence. Uncleared until terms and counsel are cleared.')
ON CONFLICT ("id") DO NOTHING;
