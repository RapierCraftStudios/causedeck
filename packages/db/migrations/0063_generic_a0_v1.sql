-- Migration 0061_generic_a0_v1: data only (drizzle-kit --custom), hand-written, reviewed before commit.
-- Reviewed-by: Claude (agent, #56)
-- The A0 generic adapters (#56, ADR 0029): generic.a0 (catch-all), in.ka.bengaluru-urban.district and
-- in.tn.chennai.district. Dotted adapter ids are already allowed by adapter_version_adapter_id_chk
-- (0045_adapter_id_dotted), so this migration changes no schema:
--   * Registers adapter_version 1.0.0 for each id as the active config. config is
--     packages/adapters/src/generic-a0/config/<id>.config.json (canonical JSON) and checksum its
--     sha256; packages/adapters/src/generic-a0/config.test.ts pins both to the bundled configs, so
--     the loader never refuses the rows. A later version goes through activateAdapterVersion.
--   * access_mode_registry rows for each id: cause_list and orders user_supplied (enabled), status
--     and display_board none (disabled). A0 reads only what the lawyer shares; district cause-list
--     pages are never accessed.
--   * The district forums already sit at adapter level A0 in the catalogue seed
--     (packages/db/src/seed/forum-catalogue/{bengaluru,chennai}-district.ts) and stay there, so no
--     forum row is touched.
-- Every data statement is idempotent.
INSERT INTO "adapter_version" ("adapter_id", "version", "config", "status", "checksum", "activated_at", "last_verified_at")
VALUES
(
  'generic.a0',
  '1.0.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/generic.a0/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["en"],"scripts":["Latn"]},"links":{},"listing":{},"nomenclature":{"caseTypes":{"CC":["C.C.","CC"],"CCCA":["CCCA"],"COMAA":["Com.A.A.","Com. A.A."],"COMAP":["Com.A.P.","Com. A.P."],"COMEX":["Com.Ex.","Com. Ex."],"COMFDP":["Com.FDP","Com. FDP"],"COMMISC":["Com.Misc.","Com. Misc."],"COMOS":["Com.O.S.","Com. O.S."],"CRLA":["Crl.A.","Crl.A"],"CRLMISC":["Crl.Misc.","Crl. Misc.","Crl.M.P."],"EXP":["Ex.P.","E.P.","EP"],"FDP":["F.D.P.","FDP"],"MC":["M.C.","MC"],"MVC":["M.V.C.","MVC"],"OS":["O.S.","OS"],"SC":["S.C.","SC"]},"seatSuffixes":[]},"orderParser":{"directionPhrases":[]},"stageMap":[{"flags":"i","key":"appearance","pattern":"^(?:for\\s+)?(?:appearance|filing|steps)"},{"flags":"i","key":"pleadings","pattern":"^(?:for\\s+)?(?:written\\s+statement|counter|reply)"},{"flags":"i","key":"issues","pattern":"^(?:for\\s+)?(?:issues|framing\\s+of\\s+issues)"},{"flags":"i","key":"evidence","pattern":"^(?:for\\s+)?evidence"},{"flags":"i","key":"arguments","pattern":"^(?:for\\s+)?(?:arguments|final\\s+hearing)"},{"flags":"i","key":"orders","pattern":"^(?:for\\s+)?(?:orders?|judg(?:e)?ment)"},{"flags":"i","key":"hearing","pattern":"^(?:for\\s+)?(?:admission|hearing)"},{"key":"orders","pattern":"^ஆணை"},{"key":"evidence","pattern":"^சாட்சிய"},{"key":"arguments","pattern":"^வாத"},{"key":"orders","pattern":"^ಆದೇಶ"},{"key":"evidence","pattern":"^ಸಾಕ್ಷ್ಯ"},{"key":"arguments","pattern":"^ವಾದ"}],"twoDigitYearPivot":50}'::jsonb,
  'active',
  '8e489e93ffa97dd897d41b64d8de638d5ea20baa9cf728ac7a2f034fd5021de4',
  statement_timestamp(),
  statement_timestamp()
),
(
  'in.ka.bengaluru-urban.district',
  '1.0.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/in.ka.bengaluru-urban.district/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["en","kn"],"scripts":["Latn","Knda"]},"links":{},"listing":{},"nomenclature":{"caseTypes":{"CC":["C.C.","CC"],"CCCA":["CCCA"],"COMAA":["Com.A.A.","Com. A.A."],"COMAP":["Com.A.P.","Com. A.P."],"COMEX":["Com.Ex.","Com. Ex."],"COMFDP":["Com.FDP","Com. FDP"],"COMMISC":["Com.Misc.","Com. Misc."],"COMOS":["Com.O.S.","Com. O.S."],"CRLA":["Crl.A.","Crl.A"],"CRLMISC":["Crl.Misc.","Crl. Misc.","Crl.M.P."],"EXP":["Ex.P.","E.P.","EP"],"FDP":["F.D.P.","FDP"],"MC":["M.C.","MC"],"MVC":["M.V.C.","MVC"],"OS":["O.S.","OS"],"SC":["S.C.","SC"]},"seatSuffixes":[]},"orderParser":{"directionPhrases":[]},"stageMap":[{"flags":"i","key":"appearance","pattern":"^(?:for\\s+)?(?:appearance|filing|steps)"},{"flags":"i","key":"pleadings","pattern":"^(?:for\\s+)?(?:written\\s+statement|counter|reply)"},{"flags":"i","key":"issues","pattern":"^(?:for\\s+)?(?:issues|framing\\s+of\\s+issues)"},{"flags":"i","key":"evidence","pattern":"^(?:for\\s+)?evidence"},{"flags":"i","key":"arguments","pattern":"^(?:for\\s+)?(?:arguments|final\\s+hearing)"},{"flags":"i","key":"orders","pattern":"^(?:for\\s+)?(?:orders?|judg(?:e)?ment)"},{"flags":"i","key":"hearing","pattern":"^(?:for\\s+)?(?:admission|hearing)"},{"key":"orders","pattern":"^ஆணை"},{"key":"evidence","pattern":"^சாட்சிய"},{"key":"arguments","pattern":"^வாத"},{"key":"orders","pattern":"^ಆದೇಶ"},{"key":"evidence","pattern":"^ಸಾಕ್ಷ್ಯ"},{"key":"arguments","pattern":"^ವಾದ"}],"twoDigitYearPivot":50}'::jsonb,
  'active',
  '23fbbda21bbd5039c309442f0c4774c635c6d3b5633a31e1c5560a262bfe0fa9',
  statement_timestamp(),
  statement_timestamp()
),
(
  'in.tn.chennai.district',
  '1.0.0',
  '{"calendar":{"dateOrder":"dmy","timeZone":"Asia/Kolkata"},"fixtures":{"fictional":true,"manifest":"fixtures/in.tn.chennai.district/manifest.json"},"health":{"maxUnmappedHeadings":3,"minAnchoredRatio":0.9},"languageProfile":{"languages":["ta","en"],"scripts":["Taml","Latn"]},"links":{},"listing":{},"nomenclature":{"caseTypes":{"CC":["C.C.","CC"],"CCCA":["CCCA"],"COMAA":["Com.A.A.","Com. A.A."],"COMAP":["Com.A.P.","Com. A.P."],"COMEX":["Com.Ex.","Com. Ex."],"COMFDP":["Com.FDP","Com. FDP"],"COMMISC":["Com.Misc.","Com. Misc."],"COMOS":["Com.O.S.","Com. O.S."],"CRLA":["Crl.A.","Crl.A"],"CRLMISC":["Crl.Misc.","Crl. Misc.","Crl.M.P."],"EXP":["Ex.P.","E.P.","EP"],"FDP":["F.D.P.","FDP"],"MC":["M.C.","MC"],"MVC":["M.V.C.","MVC"],"OS":["O.S.","OS"],"SC":["S.C.","SC"]},"seatSuffixes":[]},"orderParser":{"directionPhrases":[]},"stageMap":[{"flags":"i","key":"appearance","pattern":"^(?:for\\s+)?(?:appearance|filing|steps)"},{"flags":"i","key":"pleadings","pattern":"^(?:for\\s+)?(?:written\\s+statement|counter|reply)"},{"flags":"i","key":"issues","pattern":"^(?:for\\s+)?(?:issues|framing\\s+of\\s+issues)"},{"flags":"i","key":"evidence","pattern":"^(?:for\\s+)?evidence"},{"flags":"i","key":"arguments","pattern":"^(?:for\\s+)?(?:arguments|final\\s+hearing)"},{"flags":"i","key":"orders","pattern":"^(?:for\\s+)?(?:orders?|judg(?:e)?ment)"},{"flags":"i","key":"hearing","pattern":"^(?:for\\s+)?(?:admission|hearing)"},{"key":"orders","pattern":"^ஆணை"},{"key":"evidence","pattern":"^சாட்சிய"},{"key":"arguments","pattern":"^வாத"},{"key":"orders","pattern":"^ಆದೇಶ"},{"key":"evidence","pattern":"^ಸಾಕ್ಷ್ಯ"},{"key":"arguments","pattern":"^ವಾದ"}],"twoDigitYearPivot":50}'::jsonb,
  'active',
  '8519309d038ff19e446d4be427121149de43393956ac420a6f681ad4bdc8fbea',
  statement_timestamp(),
  statement_timestamp()
)
ON CONFLICT ("adapter_id", "version") DO NOTHING;--> statement-breakpoint
INSERT INTO "access_mode_registry" ("adapter_id", "resource", "mode", "counsel_note", "enabled")
VALUES
  ('generic.a0', 'cause_list', 'user_supplied', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', true),
  ('generic.a0', 'orders', 'user_supplied', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', true),
  ('generic.a0', 'status', 'none', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', false),
  ('generic.a0', 'display_board', 'none', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', false),
  ('in.ka.bengaluru-urban.district', 'cause_list', 'user_supplied', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', true),
  ('in.ka.bengaluru-urban.district', 'orders', 'user_supplied', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', true),
  ('in.ka.bengaluru-urban.district', 'status', 'none', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', false),
  ('in.ka.bengaluru-urban.district', 'display_board', 'none', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', false),
  ('in.tn.chennai.district', 'cause_list', 'user_supplied', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', true),
  ('in.tn.chennai.district', 'orders', 'user_supplied', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', true),
  ('in.tn.chennai.district', 'status', 'none', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', false),
  ('in.tn.chennai.district', 'display_board', 'none', 'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed', false)
ON CONFLICT ("adapter_id", "resource") DO NOTHING;
