-- Migration 20261024200000_advocate_search_sources: data only, hand-written, no schema change.
-- Reviewed-by: Claude (agent, #501)
-- Advocate-search sources for zero-entry onboarding (#501, D-048): the delegated advocate searches that discover an advocate's cases from a name or enrolment number. Seeded uncleared (cleared_at null), so the fetch layer refuses them until counsel clears the portal terms; staff confirm the base URL and search path before clearing.
INSERT INTO "source" ("id", "kind", "base_url", "owner", "access_mode", "max_tier", "rate_limit_per_minute", "notes")
VALUES
  ('in.tn.madras-hc.chennai:advocate_search', 'court', 'https://www.mhc.tn.gov.in/', 'Madras High Court', 'A0', 'http', 5, 'Madras HC advocate or enrolment search for onboarding discovery (delegated lookups only). Uncleared until counsel clears the portal terms.'),
  ('in.ka.karnataka-hc.bengaluru:advocate_search', 'court', 'https://karnatakajudiciary.kar.nic.in/', 'Karnataka High Court', 'A0', 'http', 5, 'Karnataka HC cause list by advocate name or BRN for onboarding discovery (delegated lookups only). Uncleared until counsel clears the portal terms.'),
  ('in.tn.district:advocate_search', 'court', 'https://services.ecourts.gov.in/', 'Tamil Nadu district courts (eCourts)', 'A0', 'http', 5, 'eCourts advocate search for onboarding discovery (delegated lookups only, captcha applies). Uncleared until counsel clears the portal terms.')
ON CONFLICT ("id") DO NOTHING;
