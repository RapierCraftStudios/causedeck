// Verdicts for claims against plain matter facts and the #77 citation resolver. A verdict only says
// whether the record agrees with what the draft states: it never judges a merit and never proposes
// an authority or a replacement. Apart from the resolver it is given, this is pure.
import { checkCitations } from '../citations/check';
import type { ExtractedCitation } from '../citations/extract';
import type { CitationResolver } from '../citations/resolvers/types';
import { canonicalCaseType } from '../consistency/match-case-numbers';
import { namesMatch } from '../consistency/match-names';

import { caseValue } from './extract';
import type { Claim, ClaimVerdict, FactStatus, MatterFacts, SourceAnchor } from './types';

export interface VerifyOptions {
  /** Needed for citation claims; without it they are `unverified-citation`. */
  resolver?: CitationResolver;
  workspaceId?: string;
  /** Name of the draft, used to anchor verdicts the record is silent on. */
  draftDocument?: string;
}

interface Candidate {
  value: string;
  anchor: SourceAnchor;
}
interface Judgement {
  status: Extract<FactStatus, 'match' | 'mismatch' | 'unsupported' | 'ambiguous'>;
  anchor?: SourceAnchor;
}

const stripZeros = (s: string): string => s.replace(/^0+(?=\d)/, '');

/** One comparable candidate disagreeing is a mismatch; several disagreeing leaves it ambiguous. */
function judge(value: string, candidates: readonly Candidate[]): Judgement {
  const first = candidates[0];
  if (first === undefined) return { status: 'unsupported' };
  const same = candidates.find((c) => c.value === value);
  if (same !== undefined) return { status: 'match', anchor: same.anchor };
  const distinct = new Set(candidates.map((c) => c.value));
  return { status: distinct.size === 1 ? 'mismatch' : 'ambiguous', anchor: first.anchor };
}

function judgeParty(claim: Claim, facts: MatterFacts): Judgement {
  const named = facts.parties.filter((p) => namesMatch(claim.value, p.name));
  const first = named[0];
  if (first === undefined) return { status: 'unsupported' };
  if (claim.role == null) {
    const roles = new Set(named.map((p) => p.role));
    return roles.size > 1
      ? { status: 'ambiguous', anchor: first.anchor }
      : { status: 'match', anchor: first.anchor };
  }
  const right = named.find((p) => p.role === claim.role);
  if (right !== undefined) return { status: 'match', anchor: right.anchor };
  return { status: 'mismatch', anchor: first.anchor };
}

function judgeCase(claim: Claim, facts: MatterFacts): Judgement {
  const [type = ''] = claim.value.split('/');
  const base = type.replace('(MD)', '');
  const candidates = facts.proceedings
    .filter((p) => (canonicalCaseType(p.caseType) ?? p.caseType.toUpperCase()) === base)
    .map((p) => ({
      value: caseValue(p.caseType, p.number, p.year),
      anchor: p.anchor,
      bench: /\(\s*MD\s*\)/i.test(p.caseType),
    }));
  if (candidates.length === 0) return { status: 'unsupported' };
  const [, n = '', y = ''] = claim.value.split('/');
  // A stored type without the bench tag still carries the number; `(MD)` series are told apart.
  const claimMd = type.endsWith('(MD)');
  const comparable = candidates.map((c) => {
    const [, cn = '', cy = ''] = c.value.split('/');
    return { ...c, key: `${String(claimMd === c.bench)}:${stripZeros(cn)}/${cy}` };
  });
  return judge(
    `true:${stripZeros(n)}/${y}`,
    comparable.map((c) => ({ value: c.key, anchor: c.anchor })),
  );
}

function judgeRule(claim: Claim, facts: MatterFacts): Judgement {
  switch (claim.kind) {
    case 'party_role':
      return judgeParty(claim, facts);
    case 'case_number':
      return judgeCase(claim, facts);
    case 'date': {
      const ctx = claim.context ?? null;
      const dates = facts.dates.map((d) => ({ value: d.iso, anchor: d.anchor, ctx: d.context }));
      const same = dates.find((d) => d.value === claim.value && (ctx === null || d.ctx === ctx));
      if (same !== undefined) return { status: 'match', anchor: same.anchor };
      // A date with no "order dated"/"listed on" lead cannot be called wrong, only unsupported.
      if (ctx === null) return { status: 'unsupported' };
      return judge(
        claim.value,
        dates.filter((d) => d.ctx === ctx),
      );
    }
    case 'amount': {
      const hit = facts.amounts.find((a) => String(Math.round(a.rupees * 100)) === claim.value);
      return hit === undefined
        ? { status: 'unsupported' }
        : { status: 'match', anchor: hit.anchor };
    }
    case 'cnr':
      return judge(
        claim.value,
        facts.cnrs.map((c) => ({ value: c.cnr.replace(/-/g, '').toUpperCase(), anchor: c.anchor })),
      );
    case 'court_ref':
      return judge(
        claim.value,
        facts.courtRefs
          .filter((r) => r.ref === claim.ref)
          .map((r) => ({ value: String(Number(r.value)), anchor: r.anchor })),
      );
    case 'citation':
      return { status: 'unsupported' };
  }
}

/** The draft's own words, used where the record says nothing to anchor on. */
const draftAnchor = (claim: Claim, document: string): SourceAnchor => ({
  document,
  page: null,
  quote: claim.raw,
});

export async function verify(
  claims: readonly Claim[],
  facts: MatterFacts,
  options: VerifyOptions = {},
): Promise<ClaimVerdict[]> {
  const document = options.draftDocument ?? 'draft';
  const citations = claims.filter((c) => c.kind === 'citation');
  const resolved = new Map<string, ClaimVerdict>();
  const { resolver } = options;
  if (citations.length > 0 && resolver !== undefined) {
    const extracted: ExtractedCitation[] = citations.map((c) => ({
      id: c.id,
      blockId: c.blockKey,
      span: [c.start, c.end],
      raw: c.raw,
      normalized: c.value,
      kind: c.citation?.kind ?? 'neutral',
      ...(c.citation?.titleHint === undefined ? {} : { titleHint: c.citation.titleHint }),
    }));
    const checked = await checkCitations(extracted, {
      resolver,
      workspaceId: options.workspaceId ?? 'workspace',
    });
    for (const [i, c] of checked.entries()) {
      const claim = citations[i];
      if (claim === undefined) continue;
      const v = c.verdict;
      resolved.set(
        claim.id,
        v.status === 'verified' && v.sourceUrl !== undefined
          ? {
              claim,
              status: 'match',
              citationStatus: v.status,
              anchor: { document: v.sourceUrl, page: null, quote: claim.raw },
            }
          : {
              claim,
              status: 'unverified-citation',
              citationStatus: v.status,
              ...(v.reason === undefined ? {} : { reason: v.reason }),
              anchor: draftAnchor(claim, document),
            },
      );
    }
  }
  return claims.map((claim) => {
    if (claim.kind === 'citation') {
      return (
        resolved.get(claim.id) ?? {
          claim,
          status: 'unverified-citation' as const,
          anchor: draftAnchor(claim, document),
        }
      );
    }
    const j = judgeRule(claim, facts);
    return { claim, status: j.status, anchor: j.anchor ?? draftAnchor(claim, document) };
  });
}
