-- Migration 20261031181221_scr_citation_backfill: custom SQL prepared by drizzle-kit (generate --custom), hand-written and reviewed before commit.
-- Reviewed-by: Claude (agent, #1189)
-- SCR citations and the Supreme Court code for rows already imported from the AWS Supreme Court dataset (#1189). Data only, no schema change, idempotent. (1) A judgment whose provenance URL ends in an English member `YYYY_V_P1_P2_EN.pdf` (after the `#`, any directory prefix) gets `[YYYY] V SCR P1` appended to case_numbers unless it is already there: the same rule as parseScrCitation (year 1950 or later, volume and first page at least 1, last page not before the first; regional-language members get none). neutral_citation is never touched. (2) court becomes INSC on every judgment of source aws-open-data-sc and on its segments (court is denormalised there).
WITH scr AS (
	SELECT j.id, regexp_match(substring(j.provenance->>'url' FROM position('#' IN j.provenance->>'url') + 1), '(?:^|[/\\])([0-9]{4})_([0-9]{1,3})_([0-9]{1,5})_([0-9]{1,5})_en\.pdf$', 'i') AS m
	FROM "judgment" j
	WHERE j.source_id = 'aws-open-data-sc' AND position('#' IN coalesce(j.provenance->>'url', '')) > 0
), cited AS (
	SELECT id, format('[%s] %s SCR %s', m[1]::int, m[2]::int, m[3]::int) AS citation
	FROM scr
	WHERE m IS NOT NULL AND m[1]::int >= 1950 AND m[2]::int >= 1 AND m[3]::int >= 1 AND m[4]::int >= m[3]::int
)
UPDATE "judgment" j SET "case_numbers" = array_append(j.case_numbers, cited.citation)
FROM cited
WHERE j.id = cited.id AND NOT (cited.citation = ANY (j.case_numbers));--> statement-breakpoint
UPDATE "judgment" SET "court" = 'INSC' WHERE "source_id" = 'aws-open-data-sc' AND "court" <> 'INSC';--> statement-breakpoint
UPDATE "judgment_segment" s SET "court" = 'INSC' FROM "judgment" j
WHERE s.judgment_id = j.id AND j.source_id = 'aws-open-data-sc' AND s.court <> 'INSC';
