-- Migration 0068_judgment_corpus: table, columns and indexes follow the drizzle schema (hand-assembled: drizzle-kit is not installed on the build host), grants hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #484)
-- The raw judgments and orders corpus (#484, D-048, D-004): `judgment` is global (GLOBAL_TABLES, no
-- RLS) and holds public judgments as published (text layer per page, sha256, provenance), with no
-- editorial columns. The app role may SELECT and INSERT, never UPDATE or DELETE; the clerk role has
-- no privileges. `embedding` is null until an ADR picks the embedding model.
CREATE TABLE "judgment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"court" text NOT NULL,
	"neutral_citation" text,
	"case_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"bench" text[] DEFAULT '{}'::text[] NOT NULL,
	"judgment_date" date,
	"blob_key" text,
	"sha256" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"page_text" jsonb NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "judgment_sha256_uq" ON "judgment" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "judgment_neutral_citation_idx" ON "judgment" USING btree ("neutral_citation");--> statement-breakpoint
CREATE INDEX "judgment_embedding_hnsw_idx" ON "judgment" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
REVOKE ALL ON "judgment" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT ON "judgment" TO causedeck_app;
