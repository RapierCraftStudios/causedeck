-- Migration 20261024110000_portfolio: generated shape (tables, keys, indexes, kind check), RLS hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #661)
-- Institution portfolios (#661, #498 part 1): portfolio, portfolio_case and portfolio_panel_advocate are tenant tables under FORCE RLS; organization.kind gains 'institution'. Expand only.
-- portfolio_case_proceeding_fk is ON DELETE SET NULL ("proceeding_id"): a bare SET NULL on the composite key would also null the NOT NULL workspace_id (Postgres 15+ column list).
CREATE TABLE "portfolio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "portfolio_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "portfolio_workspace_name_uq" UNIQUE("workspace_id","name"),
	CONSTRAINT "portfolio_name_chk" CHECK (char_length(name) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "portfolio_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"proceeding_id" uuid,
	"cnr" text,
	"case_number" text,
	"source_id" text,
	"status" text,
	"status_checked_at" timestamp with time zone,
	"next_date" date,
	"last_adverse_order_at" timestamp with time zone,
	"last_adverse_order_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "portfolio_case_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "portfolio_case_portfolio_cnr_uq" UNIQUE("workspace_id","portfolio_id","cnr"),
	CONSTRAINT "portfolio_case_cnr_chk" CHECK (cnr is null or cnr ~ '^[A-Z0-9]{16}$'),
	CONSTRAINT "portfolio_case_target_chk" CHECK (proceeding_id is not null or cnr is not null or case_number is not null)
);
--> statement-breakpoint
CREATE TABLE "portfolio_panel_advocate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"advocate_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "portfolio_panel_advocate_uq" UNIQUE("workspace_id","portfolio_id","advocate_user_id")
);
--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT "organization_kind_chk";--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_case" ADD CONSTRAINT "portfolio_case_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_case" ADD CONSTRAINT "portfolio_case_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_case" ADD CONSTRAINT "portfolio_case_portfolio_fk" FOREIGN KEY ("workspace_id","portfolio_id") REFERENCES "public"."portfolio"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_case" ADD CONSTRAINT "portfolio_case_proceeding_fk" FOREIGN KEY ("workspace_id","proceeding_id") REFERENCES "public"."proceeding"("workspace_id","id") ON DELETE SET NULL ("proceeding_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_panel_advocate" ADD CONSTRAINT "portfolio_panel_advocate_advocate_user_id_user_id_fk" FOREIGN KEY ("advocate_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_panel_advocate" ADD CONSTRAINT "portfolio_panel_advocate_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_panel_advocate" ADD CONSTRAINT "portfolio_panel_advocate_portfolio_fk" FOREIGN KEY ("workspace_id","portfolio_id") REFERENCES "public"."portfolio"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_workspace_id_idx" ON "portfolio" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "portfolio_case_workspace_id_idx" ON "portfolio_case" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "portfolio_panel_advocate_workspace_id_idx" ON "portfolio_panel_advocate" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_kind_chk" CHECK (kind in ('solo', 'chamber', 'institution'));--> statement-breakpoint
ALTER TABLE "portfolio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "portfolio" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "portfolio_case" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_case" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "portfolio_case" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "portfolio_panel_advocate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_panel_advocate" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ws_isolation" ON "portfolio_panel_advocate" AS PERMISSIVE FOR ALL TO PUBLIC USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
