-- Migration 0047_karnataka_hc_adapter_v1: custom (drizzle-kit generate --custom), hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #404)
-- Registers the Karnataka HC adapter `in.ka.karnataka-hc.bengaluru` 1.0.0 as the active
-- `adapter_version` (#404, part 1 of #37; ADR 0015, ADR 0018). Data only: no schema change.
--   * `config` is the canonical JSON of KARNATAKA_HC_CONFIG (packages/adapters/src/karnataka-hc)
--     and `checksum` its configChecksum; a test in packages/adapters keeps both equal to the code.
--   * `fixtures_digest` stays null: no committed KHC golden fixtures yet (#408). A later version
--     goes through activateAdapterVersion and its golden gate.
--   * ON CONFLICT DO NOTHING: re-running leaves an existing row untouched.
INSERT INTO "adapter_version" ("adapter_id", "version", "config", "status", "checksum", "activated_at")
VALUES (
  'in.ka.karnataka-hc.bengaluru',
  '1.0.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/in.ka.karnataka-hc.bengaluru/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["en"],"scripts":["Latn"]},"links":{"cause_list":"cause_list","orders":"orders","status":"case_status"},"listing":{"hallHeading":"^COURT\\s+(?:HALL\\s+)?NO\\.?\\s*([0-9]+[A-Z]?)\\b","rowPattern":"^(\\d{1,4}[A-Z]?)(?:\\.|\\))?\\s+(.+)$"},"nomenclature":{"caseTypes":{"AC":["Arbitration Case"],"CCC":["Civil Contempt Case"],"COMMAP":["Commercial Appeal"],"COMMOS":[],"CP":["Company Petition"],"CRLA":["Criminal Appeal"],"CRLCCC":[],"CRLP":["Criminal Petition"],"CRLRP":["Criminal Revision Petition"],"CRP":["Civil Revision Petition"],"IA":["Interlocutory Application"],"ITA":["Income Tax Appeal"],"MFA":["Miscellaneous First Appeal"],"MSA":["Miscellaneous Second Appeal"],"RFA":["Regular First Appeal"],"RP":["Review Petition"],"RSA":["Regular Second Appeal"],"STRP":["Sales Tax Revision Petition"],"WA":["Writ Appeal"],"WP":["Writ Petition"],"WPCR":["Writ Petition (Criminal)"],"WPHC":["Habeas Corpus Petition"]},"seatSuffixes":[]},"orderParser":{"directionPhrases":["list on","post on","call on","list after","list the matter after","post after","adjourned to","within","issue notice","rule","orders reserved"]},"stageCodeLegend":{},"stageMap":[{"flags":"i","key":"admission","pattern":"^(?:FOR\\s+)?ADMISSION\\b"},{"flags":"i","key":"preliminary_hearing","pattern":"^(?:FOR\\s+)?PRELIMINARY\\s+HEARING\\b"},{"flags":"i","key":"orders","pattern":"^(?:FOR\\s+)?ORDERS\\b"},{"flags":"i","key":"final_hearing","pattern":"^(?:FOR\\s+)?FINAL\\s+HEARING\\b"},{"flags":"i","key":"hearing","pattern":"^(?:FOR\\s+)?HEARING\\b"},{"flags":"i","key":"fresh","pattern":"^FRESH\\b"},{"flags":"i","key":"judgment","pattern":"^(?:FOR\\s+)?(?:JUDGMENT|PRONOUNCEMENT)\\b"},{"flags":"i","key":"objections","pattern":"^(?:FOR\\s+)?(?:OFFICE\\s+)?OBJECTIONS?\\b"},{"flags":"i","key":"dictation","pattern":"^(?:FOR\\s+)?DICTATION\\b"}],"twoDigitYearPivot":50}'::jsonb,
  'active',
  'c2baf20723c0eb27eadc780881f7826ec705316974a820aae0a2d7227e86e084',
  now()
)
ON CONFLICT ("adapter_id", "version") DO NOTHING;
