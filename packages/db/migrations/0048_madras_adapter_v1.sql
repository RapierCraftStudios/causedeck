-- Migration 0047_madras_adapter_v1: data only (drizzle-kit --custom), hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #401)
-- The Madras HC adapter's first version, in.tn.madras-hc.principal 1.0.0 (#401, part 4 of #36;
-- ADR 0018). No schema change:
--   * Registers adapter_version 1.0.0 as the active config. config is the canonical JSON of
--     MADRAS_HC_CONFIG (packages/adapters/src/madras-hc/config/adapter-config.ts) and checksum its
--     sha256 (configChecksum); packages/adapters/src/madras-hc/adapter-version.test.ts pins both,
--     so the loader never refuses the row. fixtures_digest and last_verified_at stay NULL:
--     activateAdapterVersion records them when it activates a later, golden-gated version.
--   * Skipped when the adapter already has an active version (adapter_version_one_active_uq) or
--     a 1.0.0 row, so the statement is idempotent.
--   * The Principal Seat forums are already A1 in the forum catalogue seed (madras-hc.ts).
INSERT INTO "adapter_version" ("adapter_id", "version", "config", "status", "checksum", "activated_at")
SELECT
  'in.tn.madras-hc.principal',
  '1.0.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/in.tn.madras-hc.principal/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["en"],"scripts":["Latn"]},"links":{"aims":"aims","cause_list":"cause_list","e_copy":"e_copy","orders":"orders","status":"case_status"},"listing":{"hallHeading":"^COURT\\s+(?:HALL\\s+)?NO\\.?\\s*([0-9]+[A-Z]?)\\b","rowPattern":"^(\\d{1,4}[A-Z]?|\\d{1,4}\\([a-z]\\))(?:\\.|(?<=\\)))\\s*(.+)$"},"nomenclature":{"caseTypes":{"A":["Application"],"APPEALCAD":[],"APPL":[],"ARBAPPEAL":[],"ARBAPPLN":["Arb. Application"],"ARBEP":[],"ARBOP":["Arbitration Original Petition"],"ARBOPCOMDIV":["Arb. O.P. (COMM DIV)"],"AS":["Appeal Suit"],"CMA":["Civil Miscellaneous Appeal"],"CMANPD":[],"CMAPD":[],"CMP":["Civil Miscellaneous Petition"],"CMSA":[],"COMAPEL":[],"COMPA":[],"CONTA":["Contempt Appeal"],"CONTP":["Contempt Petition"],"CP":["Company Petition"],"CRLA":["Criminal Appeal"],"CRLMP":["Criminal Miscellaneous Petition"],"CRLOP":["Criminal Original Petition"],"CRLRC":["Criminal Revision Case"],"CRLREF":[],"CROSOBJ":["Cross Objection"],"CRP":["Civil Revision Petition"],"CRPNPD":[],"CRPPD":[],"CS":["Civil Suit"],"CSCOMMDIV":["C.S. (COM.DIV.)"],"ELP":["Election Petition"],"EP":["Execution Petition"],"HCMP":[],"HCP":["Habeas Corpus Petition"],"IA":[],"IC":[],"IN":[],"IP":[],"LTS":[],"OA":["Original Application"],"OMS":[],"OP":["Original Petition"],"OPCOMMDIV":["O.P. (COM.DIV.)"],"OSA":["Original Side Appeal"],"OSACAD":[],"RCMP":[],"REVAPLC":[],"REVAPLO":[],"REVAPLW":[],"REVPET":[],"RT":["Referred Trial"],"SA":["Second Appeal"],"SCMP":[],"SCP":[],"SUBA":[],"SUBAPPL":[],"TC":["Tax Case"],"TCA":[],"TCMATM":[],"TCMP":[],"TCP":[],"TCR":[],"TMA":[],"TMSA":[],"TOPCR":[],"TOPGI":[],"TOPPT":[],"TOPTM":[],"TOS":[],"TRAS":[],"TRCMA":[],"TRCMP":[],"TRCS":[],"VCMP":[],"WA":["Writ Appeal"],"WAMP":[],"WMP":["Writ Miscellaneous Petition"],"WP":["Writ Petition"],"WPCRL":["Crl. W.P."],"WPMP":[],"WVMP":[]},"seatSuffixes":["MD"]},"orderParser":{"directionPhrases":["post on","call on","list on","list after","post the matter after","post after","within","issue notice","notice returnable","orders reserved","reserved for orders","judgment reserved","dispensed"]},"stageMap":[{"flags":"i","key":"admission","pattern":"^(?:FOR\\s+)?ADMISSION\\b"},{"flags":"i","key":"orders","pattern":"^(?:FOR\\s+)?ORDERS\\b"},{"flags":"i","key":"hearing","pattern":"^(?:FOR\\s+)?(?:FINAL\\s+)?HEARING\\b"},{"flags":"i","key":"fresh","pattern":"^FRESH\\b|^NEW\\s+(?:CASES|ADMISSION)\\b"},{"flags":"i","key":"after_notice","pattern":"^AFTER\\s+NOTICE\\b"},{"flags":"i","key":"part_heard","pattern":"^PART[\\s-]*HEARD\\b"},{"flags":"i","key":"mentioning","pattern":"^(?:FOR\\s+)?MENTION(?:ING)?\\b"},{"flags":"i","key":"supplementary","pattern":"^SUPPLEMENTARY\\b"},{"flags":"i","key":"advance","pattern":"^ADVANCE\\b"}],"twoDigitYearPivot":50}'::jsonb,
  'active',
  '0e60b166bbffff29ea78e395d9649535332b19a3d3da8b8cac6693e87abde055',
  statement_timestamp()
WHERE NOT EXISTS (
  SELECT 1 FROM "adapter_version"
   WHERE "adapter_id" = 'in.tn.madras-hc.principal' AND "status" = 'active'
)
ON CONFLICT ("adapter_id", "version") DO NOTHING;
