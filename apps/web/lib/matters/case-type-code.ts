// The case-type match key for the proceeding form's combobox (#392). It mirrors core
// `normaliseCaseType` (core/matter-graph/duplicates.ts: upper-case, no dots, whitespace, hyphens or
// underscores, so `W.P.`, `wp` and `W P` all read `WP`) without importing core, so the client
// bundle stays small; a blank input is `''` rather than an error. The server still stores what
// core normalises.
export function compactCaseTypeCode(raw: string): string {
  return raw.toUpperCase().replace(/[.\s\-_]/g, '');
}
