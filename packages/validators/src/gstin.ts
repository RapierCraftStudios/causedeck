// The GSTIN format (#28, #200, #297). A leaf with no imports: `@causedeck/db` builds the
// `subscription_gstin_chk` constraint from it and `@causedeck/billing/gstin` re-exports it next to
// the check-digit validation.

/** The format, as a regex source string shared with the `subscription_gstin_chk` constraint. */
export const GSTIN_PATTERN_SOURCE = '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
