// Shared personal-data patterns (#516, #892): used by the workbench leak detector and the corpus
// redaction pipeline. Regexes are global; callers use `matchAll` or `replace`, which reset `lastIndex`.

export const EMAIL_PLACEHOLDER = 'redacted@example.invalid';
export const PHONE_PLACEHOLDER = '9000000000';
export const AADHAAR_PLACEHOLDER = '0000 0000 0000';
export const PAN_PLACEHOLDER = 'AAAAA0000A';

export const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
export const PHONE_RE = /(?<!\d)(?:\+91[\s-]?|0)?[6-9]\d{9}(?!\d)/g;
// Real Aadhaar numbers never start with 0 or 1, which keeps the placeholder out of the match.
export const AADHAAR_RE = /(?<!\d)[2-9]\d{3}\s?\d{4}\s?\d{4}(?!\d)/g;
export const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

// Corpus cues (#892). A bank account is 9-18 digits only when a cue word precedes it, so case
// numbers and amounts are not taken for accounts.
export const BANK_ACCOUNT_RE =
  /\b(?:a\/c|acct?\.?|account)(?:\s+(?:no|number|num)\.?)?\s*[:#-]?\s*(?<![\d])(\d{9,18})(?!\d)/gi;
// State code, two digits, one to three letters, four digits: `KA 05 MN 1234`, `MH12AB1234`.
export const VEHICLE_NUMBER_RE = /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/g;
// An address cue: "resident of / residing at / r/o / R/o" followed by the address up to the sentence end.
export const ADDRESS_CUE_RE =
  /\b(?:resident\s+of|residing\s+at|r\/o|permanent\s+address|address\s*:)\s*[^.;\n]{3,120}/gi;
