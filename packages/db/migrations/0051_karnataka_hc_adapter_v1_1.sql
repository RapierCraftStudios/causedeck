-- Migration 0050_karnataka_hc_adapter_v1_1: custom (drizzle-kit generate --custom), hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #405)
-- Activates the Karnataka HC adapter `in.ka.karnataka-hc.bengaluru` 1.1.0 and retires 1.0.0
-- (#405, part 2 of #37; ADR 0015, ADR 0019). Data only: no schema change.
--   * 1.1.0 seeds the stage headings practitioners use (Preliminary Hearing (B Group), Hearing on IA,
--     For Being Spoken To, For Hearing / Final Hearing, Orders); only `stageMap` differs from 1.0.0.
--   * `config` is the canonical JSON of KARNATAKA_HC_CONFIG (packages/adapters/src/karnataka-hc)
--     and `checksum` its configChecksum; a test in packages/adapters keeps both equal to the code.
--   * The active row is retired first (one active version per adapter); 1.1.0 itself is never
--     retired, so re-running leaves it active. ON CONFLICT DO NOTHING keeps an existing 1.1.0 row.
--   * `fixtures_digest` stays null: no committed KHC golden fixtures yet (#408).
UPDATE "adapter_version"
SET "status" = 'retired'
WHERE "adapter_id" = 'in.ka.karnataka-hc.bengaluru'
  AND "status" = 'active'
  AND "version" <> '1.1.0';
--> statement-breakpoint
INSERT INTO "adapter_version" ("adapter_id", "version", "config", "status", "checksum", "activated_at")
VALUES (
  'in.ka.karnataka-hc.bengaluru',
  '1.1.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/in.ka.karnataka-hc.bengaluru/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["en"],"scripts":["Latn"]},"links":{"cause_list":"cause_list","orders":"orders","status":"case_status"},"listing":{"hallHeading":"^COURT\\s+(?:HALL\\s+)?NO\\.?\\s*([0-9]+[A-Z]?)\\b","rowPattern":"^(\\d{1,4}[A-Z]?)(?:\\.|\\))?\\s+(.+)$"},"nomenclature":{"caseTypes":{"AC":["Arbitration Case"],"CCC":["Civil Contempt Case"],"COMMAP":["Commercial Appeal"],"COMMOS":[],"CP":["Company Petition"],"CRLA":["Criminal Appeal"],"CRLCCC":[],"CRLP":["Criminal Petition"],"CRLRP":["Criminal Revision Petition"],"CRP":["Civil Revision Petition"],"IA":["Interlocutory Application"],"ITA":["Income Tax Appeal"],"MFA":["Miscellaneous First Appeal"],"MSA":["Miscellaneous Second Appeal"],"RFA":["Regular First Appeal"],"RP":["Review Petition"],"RSA":["Regular Second Appeal"],"STRP":["Sales Tax Revision Petition"],"WA":["Writ Appeal"],"WP":["Writ Petition"],"WPCR":["Writ Petition (Criminal)"],"WPHC":["Habeas Corpus Petition"]},"seatSuffixes":[]},"orderParser":{"directionPhrases":["list on","post on","call on","list after","list the matter after","post after","adjourned to","within","issue notice","rule","orders reserved"]},"stageCodeLegend":{},"stageMap":[{"flags":"i","key":"preliminary_hearing_b_group","pattern":"^(?:FOR\\s+)?PRELIMINARY\\s+HEARING\\s*\\(\\s*B[\\s-]*GROUP\\s*\\)"},{"flags":"i","key":"preliminary_hearing","pattern":"^(?:FOR\\s+)?PRELIMINARY\\s+HEARING\\b"},{"flags":"i","key":"hearing_on_ia","pattern":"^(?:FOR\\s+)?HEARING\\s+ON\\s+I\\.?\\s?A\\b"},{"flags":"i","key":"admission","pattern":"^(?:FOR\\s+)?ADMISSION\\b"},{"flags":"i","key":"being_spoken_to","pattern":"^(?:FOR\\s+)?BEING\\s+SPOKEN\\s+TO\\b"},{"flags":"i","key":"orders","pattern":"^(?:FOR\\s+)?ORDERS\\b"},{"flags":"i","key":"final_hearing","pattern":"^(?:FOR\\s+)?(?:FINAL\\s+)?HEARING\\b"},{"flags":"i","key":"fresh","pattern":"^FRESH\\b"},{"flags":"i","key":"judgment","pattern":"^(?:FOR\\s+)?(?:JUDGMENT|PRONOUNCEMENT)\\b"},{"flags":"i","key":"objections","pattern":"^(?:FOR\\s+)?(?:OFFICE\\s+)?OBJECTIONS?\\b"},{"flags":"i","key":"dictation","pattern":"^(?:FOR\\s+)?DICTATION\\b"}],"twoDigitYearPivot":50}',
  'active',
  '85c299bcefc98f85c246c3a1714148020fa3fa97caded57245f4557a6ff0db8f',
  now()
)
ON CONFLICT ("adapter_id", "version") DO NOTHING;
