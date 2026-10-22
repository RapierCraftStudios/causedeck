-- Migration 0052_nclt_adapter_v1: data only (drizzle-kit --custom), hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #38)
-- The NCLT Bengaluru adapter, in.nclt.bengaluru (#38, ADR 0020). Dotted adapter ids are already
-- allowed by adapter_version_adapter_id_chk since 0045_adapter_id_dotted (#395), so this
-- migration changes no schema:
--   * Registers adapter_version in.nclt.bengaluru 1.0.0 as the active config. config is
--     packages/adapters/src/nclt-blr/config/adapter.config.json (canonical JSON) and checksum its
--     sha256; packages/adapters/src/nclt-blr/config.test.ts pins both to NCLT_CONFIG, so the loader
--     never refuses the row. A later version goes through activateAdapterVersion (golden-gated).
--   * access_mode_registry rows for the adapter: cause_list and orders user_supplied (enabled),
--     status and display_board none (disabled), each with the note that NCLT's terms of use are
--     unread and counsel review is pending (#118). Nothing is retrieved automatically.
--   * Raises the system forum in.nclt.bengaluru to adapter level A1. The catalogue seed (run after
--     the migrations) carries A1 too (packages/db/src/seed/forum-catalogue/tribunals.ts), so it
--     keeps the level; on a fresh database the row does not exist yet and the seed inserts it.
-- Every data statement is idempotent.
INSERT INTO "adapter_version" ("adapter_id", "version", "config", "status", "checksum", "activated_at", "last_verified_at")
VALUES (
  'in.nclt.bengaluru',
  '1.0.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/in.nclt.bengaluru/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["en"],"scripts":["Latn"]},"links":{"cause_list":"cause_list"},"listing":{},"nomenclature":{"caseTypes":{"CA":["CA"],"CACAA":["CA(CAA)"],"CP":["CP"],"CPCAA":["CP(CAA)"],"CPIB":["CP(IB)"],"IA":["IA"],"IAIB":["IA(IB)"],"IAPLAN":["IA(Plan)"],"MA":["MA"],"TCP":["TCP"]},"seatSuffixes":["BB"]},"orderParser":{"directionPhrases":[]},"stageMap":[{"flags":"i","key":"admission","pattern":"^admission"},{"flags":"i","key":"pronouncement","pattern":"^pronouncement"},{"flags":"i","key":"orders","pattern":"^(?:for\\s+)?orders?$"},{"flags":"i","key":"hearing","pattern":"^(?:final\\s+)?hearing$"},{"flags":"i","key":"compliance","pattern":"^compliance"},{"flags":"i","key":"pleadings","pattern":"^(?:reply|counter|rejoinder)"}],"table":{"columnTolerancePx":6,"columns":{"caIaNo":["CA/IA No.","IA/CA No.","CA No./IA No.","IA No.","CA No.","IA/CA/MA No."],"counselPetitioner":["Counsel for Petitioner/Applicant","Counsel for Petitioner","Counsel for Applicant","Counsel for the Petitioner/Applicant","Advocate for Petitioner"],"counselRespondent":["Counsel for Respondent","Counsel for the Respondent","Counsel for Respondents","Advocate for Respondent"],"cpNo":["CP No.","C.P. No.","Company Petition No.","Case No.","TCP/CP No."],"parties":["Name of Parties","Parties","Name of the Parties","Petitioner Vs Respondent"],"purpose":["Purpose","Stage","Purpose of Hearing"],"remarks":["Remarks","Remark"],"resolutionProfessional":["IRP/RP/Liquidator/MP","IRP/RP/Liquidator","IRP/RP","RP/Liquidator","Resolution Professional"],"section":["Section","Sec.","Section of Law"],"slNo":["Sl. No.","S. No.","Sr. No.","Serial No.","Item No."]},"minHeaderMatches":5},"twoDigitYearPivot":50}'::jsonb,
  'active',
  '7cc2ce84a3e9acae74e0514aa5ae372094f7f68f5b47505cfab810bc8a518ba6',
  statement_timestamp(),
  statement_timestamp()
)
ON CONFLICT ("adapter_id", "version") DO NOTHING;--> statement-breakpoint
INSERT INTO "access_mode_registry" ("adapter_id", "resource", "mode", "counsel_note", "enabled")
VALUES
  ('in.nclt.bengaluru', 'cause_list', 'user_supplied', 'NCLT T&C not yet read, counsel review pending (#118)', true),
  ('in.nclt.bengaluru', 'orders', 'user_supplied', 'NCLT T&C not yet read, counsel review pending (#118)', true),
  ('in.nclt.bengaluru', 'status', 'none', 'NCLT T&C not yet read, counsel review pending (#118)', false),
  ('in.nclt.bengaluru', 'display_board', 'none', 'NCLT T&C not yet read, counsel review pending (#118)', false)
ON CONFLICT ("adapter_id", "resource") DO NOTHING;--> statement-breakpoint
UPDATE "forum"
   SET "adapter_level" = 'A1', "updated_at" = statement_timestamp()
 WHERE "workspace_id" IS NULL
   AND "code" = 'in.nclt.bengaluru'
   AND "adapter_level" <> 'A1';
