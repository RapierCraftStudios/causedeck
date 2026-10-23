// The advocate's own identifiers (#57, #548): Bar enrolment numbers / BRNs and name aliases,
// normalised the way the court adapters print them, so a list row can be matched by exact equality.
// Pure: where the profile stores them is a later part (#551/#552); callers pass what they hold.
import {
  advocateAliases,
  extractBarRegistrationNo,
  extractEnrolmentNo,
  karnatakaAdvocateAliases,
  type Advocate,
} from '@causedeck/adapters';

export interface AdvocateIdentifiers {
  /** Upper-case enrolment numbers / BRNs, sorted and unique. */
  enrolmentNumbers: string[];
  /** Upper-case, title-stripped name spellings, sorted and unique. */
  aliases: string[];
}

export interface AdvocateIdentifierInput {
  enrolmentNumbers?: readonly string[] | undefined;
  aliases?: readonly string[] | undefined;
}

/** The enrolment number or BRN in `text`, else its compact upper-case form; null when empty. */
function enrolmentKey(text: string): string | null {
  const found = extractEnrolmentNo(text) ?? extractBarRegistrationNo(text);
  if (found !== null) return found;
  const compact = text.trim().toUpperCase().replace(/\s+/g, '');
  return compact === '' ? null : compact;
}

/** Name spellings of `raw` under both courts' title lists. */
function nameKeys(raw: string): string[] {
  return [...advocateAliases(raw), ...karnatakaAdvocateAliases(raw)];
}

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

export function getAdvocateIdentifiers(input: AdvocateIdentifierInput): AdvocateIdentifiers {
  const enrolmentNumbers = (input.enrolmentNumbers ?? []).flatMap((value) => {
    const key = enrolmentKey(value);
    return key === null ? [] : [key];
  });
  const aliases = (input.aliases ?? []).flatMap(nameKeys);
  return { enrolmentNumbers: sortedUnique(enrolmentNumbers), aliases: sortedUnique(aliases) };
}

export function hasIdentifiers(identifiers: AdvocateIdentifiers): boolean {
  return identifiers.enrolmentNumbers.length > 0 || identifiers.aliases.length > 0;
}

/**
 * A predicate that is true when an advocate carries one of the identifiers: exact enrolment
 * number or exact alias equality, never a substring.
 */
export function createAdvocateMatcher(identifiers: AdvocateIdentifiers): (a: Advocate) => boolean {
  const enrolments = new Set(identifiers.enrolmentNumbers);
  const aliases = new Set(identifiers.aliases);
  return (advocate) => {
    for (const value of [advocate.enrolmentNo, advocate.raw]) {
      if (value === undefined) continue;
      const key = extractEnrolmentNo(value) ?? extractBarRegistrationNo(value);
      if (key !== null && enrolments.has(key)) return true;
    }
    const names = [
      ...advocate.aliases.map((alias) => alias.trim().toUpperCase()),
      ...nameKeys(advocate.raw),
    ];
    return names.some((name) => aliases.has(name));
  };
}
