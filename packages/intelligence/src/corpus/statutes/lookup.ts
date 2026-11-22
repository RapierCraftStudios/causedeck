// Statute counterparts (#1116, ADR 0051): the IPC/BNS, CrPC/BNSS and IEA/BSA counterpart of a section,
// read from `CODE_MAP` only. A section the map does not carry has no counterpart recorded; nothing
// here guesses one.
import { normaliseSection } from '../../issues/index.ts';
import { codeInForce, equivalents, type Equivalent } from '../enrich/code-map.ts';
import { canonicalStatute } from '../enrich/statutes.ts';

/** What a lookup for a section the map does not carry says. */
export const NO_COUNTERPART_RECORDED = 'no counterpart recorded';

/**
 * A statute key that compares equal to `judgment_statute_ref.statute` and matter issue tags: the
 * corpus's canonical name, falling back to `normaliseStatute` (so `IEA` and `BSA` resolve too).
 */
export function statuteKey(raw: string): string {
  return canonicalStatute(raw);
}

/** A section key as `normaliseSection` writes it (`Section 304 A` -> `304a`). */
export function sectionKey(raw: string): string {
  return normaliseSection(raw);
}

export type CounterpartResult =
  | {
      kind: 'recorded';
      statute: string;
      section: string;
      /** The counterparts in the other code, with whether each governs an offence on the date. */
      counterparts: Equivalent[];
      /** The code an offence on the given date falls under; null when no date was given. */
      codeInForce: 'old' | 'new' | null;
    }
  | {
      kind: 'none';
      statute: string;
      section: string;
      reason: typeof NO_COUNTERPART_RECORDED;
    };

/** The counterpart of `statute` `section` in the other code, from `CODE_MAP` alone. */
export function counterpart(
  statute: string,
  section: string,
  offenceDate?: string | null,
): CounterpartResult {
  const ref = { statute: statuteKey(statute), section: sectionKey(section) };
  const counterparts = equivalents(ref, offenceDate);
  if (counterparts.length === 0) return { kind: 'none', ...ref, reason: NO_COUNTERPART_RECORDED };
  return {
    kind: 'recorded',
    ...ref,
    counterparts,
    codeInForce: offenceDate == null ? null : codeInForce(offenceDate),
  };
}
