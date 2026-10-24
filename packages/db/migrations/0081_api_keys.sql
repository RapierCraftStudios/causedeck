-- Migration 0081_api_keys: generated shape (table, keys, indexes), RLS and function hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #624)
-- Public API keys (#624, #487 part 1). api_key is a tenant table under FORCE RLS: only the sha256 of
-- a token is stored. The API resolves a bearer token before it knows the workspace, so it reads a key
-- through app_api_key_by_hash (owner-defined, one row by unique hash; never lists keys). Expand only.
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"monthly_quota" integer,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "api_key_name_chk" CHECK (length(btrim(name)) between 1 and 100),
	CONSTRAINT "api_key_quota_chk" CHECK (monthly_quota is null or monthly_quota >= 0),
	CONSTRAINT "api_key_rate_chk" CHECK (rate_limit_per_minute between 1 and 10000),
	CONSTRAINT "api_key_scopes_chk" CHECK (cardinality(scopes) > 0)
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_workspace_id_idx" ON "api_key" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_token_hash_uq" ON "api_key" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_key_workspace_idx" ON "api_key" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_key" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "api_key" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "api_key" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_api_key_by_hash(p_token_hash text)
  RETURNS TABLE (id uuid, workspace_id uuid, created_by uuid, scopes text[], monthly_quota integer, rate_limit_per_minute integer, expires_at timestamp with time zone, revoked_at timestamp with time zone)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.id, k.workspace_id, k.created_by, k.scopes, k.monthly_quota, k.rate_limit_per_minute, k.expires_at, k.revoked_at
    FROM api_key k
    JOIN organization o ON o.id = k.workspace_id
    WHERE k.token_hash = p_token_hash AND o.deleted_at IS NULL
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_api_key_by_hash(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_api_key_by_hash(text) TO causedeck_app;
