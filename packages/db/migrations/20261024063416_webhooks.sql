-- Migration 20261024063416_webhooks: generated shape (tables, keys, indexes), RLS and function hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #626)
-- Change webhooks (#626, #487 part 3): webhook_endpoint and webhook_delivery are tenant tables under FORCE RLS; the sweep lists due deliveries across workspaces only through app_webhook_delivery_due (owner-defined). Expand only.
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "webhook_delivery_endpoint_event_uq" UNIQUE("workspace_id","endpoint_id","event_key"),
	CONSTRAINT "webhook_delivery_type_chk" CHECK (event_type in ('status.changed', 'order.added', 'causelist.matched')),
	CONSTRAINT "webhook_delivery_status_chk" CHECK (status in ('pending', 'delivered', 'failed')),
	CONSTRAINT "webhook_delivery_attempts_chk" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "webhook_endpoint_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "webhook_endpoint_url_chk" CHECK (url ~ '^https://' and length(url) <= 2048),
	CONSTRAINT "webhook_endpoint_events_chk" CHECK (cardinality(events) > 0),
	CONSTRAINT "webhook_endpoint_failures_chk" CHECK (consecutive_failures >= 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_fk" FOREIGN KEY ("workspace_id","endpoint_id") REFERENCES "public"."webhook_endpoint"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_delivery_workspace_id_idx" ON "webhook_delivery" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_workspace_id_idx" ON "webhook_endpoint" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "webhook_endpoint" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "webhook_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_delivery" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "webhook_delivery" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "webhook_delivery" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE POLICY "owner_definer_read" ON "webhook_endpoint" AS PERMISSIVE FOR SELECT TO causedeck_owner
  USING (true);--> statement-breakpoint
CREATE FUNCTION app_webhook_delivery_due(p_limit integer)
  RETURNS TABLE (id uuid, workspace_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.id, d.workspace_id
    FROM webhook_delivery d
    JOIN webhook_endpoint e ON e.workspace_id = d.workspace_id AND e.id = d.endpoint_id
    JOIN organization o ON o.id = d.workspace_id
    WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND e.active AND o.deleted_at IS NULL
    ORDER BY d.next_attempt_at
    LIMIT p_limit
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_webhook_delivery_due(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_webhook_delivery_due(integer) TO causedeck_app;
