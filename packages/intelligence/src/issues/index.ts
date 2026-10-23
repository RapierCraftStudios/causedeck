// Matter issue tags (#497, D-048): the statutes and sections a matter turns on. `extractIssueTags`
// asks the gateway task `extract_issue_tags` for proposals from a matter's pleadings and orders,
// validates the output and returns every tag with status `proposed`; nothing is used for alerts
// until the lawyer confirms it. The gateway refuses a sensitive matter (`SensitiveMatterBlockedError`
// propagates), so no text of one reaches a model. The normalisers give a statute and a section one
// canonical spelling, which the corpus matcher and the unique key of `matter_issue_tag` rely on.
import type { AiGateway, RunContext } from '@causedeck/ai';
import { z } from 'zod';

/** Characters of text sent to the model. */
export const ISSUE_TEXT_CHARS = 12000;

/** Tags below this confidence are not proposed. */
export const ISSUE_MIN_CONFIDENCE = 0.5;

/** Tags proposed per call. */
export const ISSUE_MAX_TAGS = 20;

/** Short forms lawyers write for a statute, mapped to its normalised name. */
const STATUTE_ALIASES: Readonly<Record<string, string>> = {
  cpc: 'code of civil procedure',
  crpc: 'code of criminal procedure',
  ipc: 'indian penal code',
  bns: 'bharatiya nyaya sanhita',
  bnss: 'bharatiya nagarik suraksha sanhita',
  'ni act': 'negotiable instruments act',
  nia: 'negotiable instruments act',
  'a&c act': 'arbitration and conciliation act',
  'a and c act': 'arbitration and conciliation act',
  'arbitration act': 'arbitration and conciliation act',
};

function words(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A statute as one lower-case key: punctuation, a leading "the" and a trailing year are dropped
 * ("The Arbitration & Conciliation Act, 1996" -> `arbitration and conciliation act`) and common
 * short forms are expanded (`CPC` -> `code of civil procedure`). Empty when nothing is left.
 */
export function normaliseStatute(raw: string): string {
  let key = words(raw)
    .replace(/^the /, '')
    .replace(/\s(?:19|20)\d{2}$/, '')
    .trim();
  key = STATUTE_ALIASES[key] ?? key;
  return key;
}

/** The spellings a normalised statute can appear as in a judgment: itself and its short forms. */
export function statuteSpellings(statute: string): string[] {
  const spellings = [statute];
  for (const [alias, full] of Object.entries(STATUTE_ALIASES)) {
    if (full === statute && alias !== statute) spellings.push(alias);
  }
  return spellings;
}

/**
 * A section as one key: the "section", "sec." and "s." prefixes and all spaces are dropped and
 * letters are lower-case, so `Section 11 (6)` and `s.11(6)` are both `11(6)`.
 */
export function normaliseSection(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\s*(?:sections?|secs?\.?|ss?\.)\s*/, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9a-z()]/g, '');
}

const TagSchema = z.object({
  statute: z.string().min(1),
  section: z.string().nullable(),
  issue: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const OutputSchema = z.object({ tags: z.array(TagSchema) });

/** A tag the lawyer has not yet confirmed. */
export interface ProposedIssueTag {
  statute: string;
  /** Empty when the tag names a statute only. */
  section: string;
  issue: string | null;
  confidence: number;
  status: 'proposed';
  source: 'ai';
}

export type IssueScope = Pick<RunContext, 'workspaceId' | 'matterId' | 'userId' | 'captureId'>;

/**
 * Proposed issue tags for `text` of the matter in `scope`. `scope.matterId` is required: the
 * gateway uses it to refuse a sensitive matter. Output that fails the schema is rejected by the
 * gateway; here statutes are normalised, low-confidence tags dropped and duplicates (same statute
 * and section) merged keeping the most confident.
 */
export async function extractIssueTags(
  gateway: AiGateway,
  scope: IssueScope,
  text: string,
): Promise<ProposedIssueTag[]> {
  if (scope.matterId === undefined || scope.matterId === '') {
    throw new Error('extractIssueTags needs a matterId in scope');
  }
  const result = await gateway.run(
    'extract_issue_tags',
    { text: text.slice(0, ISSUE_TEXT_CHARS) },
    {
      ...scope,
      purpose: 'research.issue_tags',
      idempotencyKey: `issue-tags:${scope.matterId}:${String(text.length)}`,
    },
  );
  const parsed = OutputSchema.parse(result.output);
  const byKey = new Map<string, ProposedIssueTag>();
  for (const tag of parsed.tags) {
    const statute = normaliseStatute(tag.statute);
    if (statute === '' || tag.confidence < ISSUE_MIN_CONFIDENCE) continue;
    const section = tag.section === null ? '' : normaliseSection(tag.section);
    const key = `${statute}|${section}`;
    const issue = tag.issue?.trim() ?? '';
    const existing = byKey.get(key);
    if (existing !== undefined && existing.confidence >= tag.confidence) continue;
    byKey.set(key, {
      statute,
      section,
      issue: issue === '' ? null : issue.slice(0, 500),
      confidence: tag.confidence,
      status: 'proposed',
      source: 'ai',
    });
  }
  return [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence || a.statute.localeCompare(b.statute))
    .slice(0, ISSUE_MAX_TAGS);
}
