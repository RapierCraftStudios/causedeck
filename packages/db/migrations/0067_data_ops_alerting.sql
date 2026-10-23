-- Migration 0067_data_ops_alerting: generated shape (enums, tables, columns, checks, indexes), grants hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #515)
-- Data operations alerting (#515, D-049). Four global, content-free tables (GLOBAL_TABLES, no RLS):
-- source_health (degraded state, block backoff, quarantined parser version), source_parse_run (parse
-- yield and conflicts per run), data_ops_alert (the alert ledger, one open row per dedup key) and
-- data_ops_oncall (the rotation). source gains nullable SLO columns (null means no objective).
-- Additive only. The app role may SELECT and INSERT parse runs, SELECT, INSERT and UPDATE the other
-- three, and never DELETE; the clerk role has no privileges on any of them.
CREATE TYPE "public"."data_ops_alert_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."data_ops_alert_type" AS ENUM('freshness', 'error_rate', 'block_signature', 'parse_yield', 'cost_anomaly', 'conflict_rate');--> statement-breakpoint
CREATE TYPE "public"."source_health_state" AS ENUM('ok', 'degraded');--> statement-breakpoint
CREATE TABLE "data_ops_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "data_ops_alert_type" NOT NULL,
	"source_id" text NOT NULL,
	"dedup_key" text NOT NULL,
	"status" "data_ops_alert_status" DEFAULT 'open' NOT NULL,
	"detail" text NOT NULL,
	"runbook_url" text NOT NULL,
	"oncall_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolve_notified_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "data_ops_oncall" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "data_ops_oncall_window_chk" CHECK ("data_ops_oncall"."ends_at" > "data_ops_oncall"."starts_at")
);--> statement-breakpoint
CREATE TABLE "source_health" (
	"source_id" text PRIMARY KEY NOT NULL,
	"state" "source_health_state" DEFAULT 'ok' NOT NULL,
	"backoff_until" timestamp with time zone,
	"backoff_step" integer DEFAULT 0 NOT NULL,
	"quarantined_parser_version" text,
	"quarantined_at" timestamp with time zone,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_health_backoff_step_chk" CHECK ("source_health"."backoff_step" >= 0)
);--> statement-breakpoint
CREATE TABLE "source_parse_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"parser_version" text NOT NULL,
	"expected" integer NOT NULL,
	"parsed" integer NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_parse_run_counts_chk" CHECK ("source_parse_run"."expected" >= 0 and "source_parse_run"."parsed" >= 0 and "source_parse_run"."conflicts" >= 0)
);--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "slo_freshness_minutes" integer;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "slo_success_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "slo_parse_yield_floor" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "data_ops_alert" ADD CONSTRAINT "data_ops_alert_oncall_user_id_user_id_fk" FOREIGN KEY ("oncall_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_ops_oncall" ADD CONSTRAINT "data_ops_oncall_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_ops_alert_open_key_uq" ON "data_ops_alert" USING btree ("dedup_key") WHERE "data_ops_alert"."status" = 'open';--> statement-breakpoint
CREATE INDEX "data_ops_alert_source_opened_idx" ON "data_ops_alert" USING btree ("source_id","opened_at");--> statement-breakpoint
CREATE INDEX "data_ops_oncall_window_idx" ON "data_ops_oncall" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "source_parse_run_source_ran_idx" ON "source_parse_run" USING btree ("source_id","ran_at");--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_slo_chk" CHECK (("source"."slo_freshness_minutes" is null or "source"."slo_freshness_minutes" > 0) and ("source"."slo_success_rate" is null or "source"."slo_success_rate" between 0 and 1) and ("source"."slo_parse_yield_floor" is null or "source"."slo_parse_yield_floor" between 0 and 1));--> statement-breakpoint
REVOKE ALL ON "data_ops_alert", "data_ops_oncall", "source_health", "source_parse_run" FROM PUBLIC, causedeck_app, causedeck_clerk;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "data_ops_alert", "data_ops_oncall", "source_health" TO causedeck_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "source_parse_run" TO causedeck_app;
