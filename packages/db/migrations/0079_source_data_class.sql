-- Migration 0079_source_data_class: generated shape (column, check), reviewed before commit.
-- Reviewed-by: Claude (agent, #486)
-- DPDP data class of a source's records (D-048, #486): personal, non-personal or mixed. Existing and
-- untagged sources are `personal`, the fail-closed value: they are never exposed through the API.
ALTER TABLE "source" ADD COLUMN "data_class" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_data_class_chk" CHECK ("source"."data_class" in ('personal', 'non-personal', 'mixed'));
