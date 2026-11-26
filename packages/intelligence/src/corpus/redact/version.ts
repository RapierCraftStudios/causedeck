/**
 * The redaction ruleset version (#892, D-053). Bump it whenever a rule changes what is redacted:
 * the `system.corpus.redact` job then re-redacts every judgment recorded at an older version from
 * the stored raw text, without re-fetching.
 *
 * 2 (#1188): matrimonial is detected from the title and the head of the first page only, not from a
 * mention anywhere in the body.
 */
export const REDACTION_VERSION = 2;
