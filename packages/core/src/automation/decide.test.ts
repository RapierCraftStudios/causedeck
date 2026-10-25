// `decideLevel` against the docs/product/09 §4.2 approval matrix (#47): a table of cases, then the
// invariants (it never raises a level, every kind has a rule, nothing leaves L1-L4).
import {
  PROPOSAL_KINDS,
  ProposalDraftSchema,
  type ProposalDraft,
  type ProposalKind,
} from '@causedeck/validators/proposal-draft';
import { describe, expect, it } from 'vitest';

import { decideLevel, thresholdKey } from './decide.ts';
import { isAutomationLevel, type AutomationLevel } from './levels.ts';
import { APPROVAL_MATRIX, type DecideContext } from './matrix.ts';

const ANCHOR = '00000000-0000-4000-8000-000000000001';
const PERSON = '00000000-0000-4000-8000-000000000002';
const DOC = '00000000-0000-4000-8000-000000000003';

function draft(kind: ProposalKind, overrides: Partial<ProposalDraft> = {}) {
  return ProposalDraftSchema.parse({
    kind,
    source: { type: 'deterministic', input: 'document' },
    payload: {},
    anchors: [ANCHOR],
    confidence: 0.95,
    ...overrides,
  });
}

const exact = (key: 'case_number' | 'cnr', score = 0.95) => ({ match: { score, exact: key } });
const ai = { source: { type: 'ai', input: 'document', aiCallId: null } } as const;

interface Case {
  name: string;
  draft: ReturnType<typeof draft>;
  ctx?: DecideContext;
  level: AutomationLevel;
  downgradedBy?: string | null;
}

const CASES: Case[] = [
  // Next date: L2 always.
  {
    name: 'next date, manual',
    draft: draft('next_date', { source: { type: 'manual', input: 'form' } }),
    level: 'L2',
  },
  {
    name: 'next date, exact match and high confidence',
    draft: draft('next_date', exact('case_number', 0.99)),
    level: 'L2',
  },
  { name: 'next date, AI, anchored', draft: draft('next_date', ai), level: 'L2' },
  // Compliance and limitation: L2.
  { name: 'obligation from a direction', draft: draft('obligation_from_direction'), level: 'L2' },
  {
    name: 'limitation date, deterministic',
    draft: draft('obligation_from_direction', exact('cnr')),
    level: 'L2',
  },
  // New matter and proceeding: L2.
  {
    name: 'new matter, manual',
    draft: draft('new_matter', { source: { type: 'manual', input: 'form' } }),
    level: 'L2',
  },
  { name: 'new matter, AI', draft: draft('new_matter', ai), level: 'L2' },
  { name: 'new proceeding', draft: draft('new_proceeding', exact('cnr')), level: 'L2' },
  { name: 'order record', draft: draft('order_record'), level: 'L2' },
  // Matching an input to an existing matter / attaching a document.
  {
    name: 'attach, case number at 0.95',
    draft: draft('document_attach', exact('case_number')),
    level: 'L3',
  },
  {
    name: 'attach, CNR at exactly 0.9',
    draft: draft('document_attach', exact('cnr', 0.9)),
    level: 'L3',
  },
  {
    name: 'attach, exact match at 0.89',
    draft: draft('document_attach', exact('case_number', 0.89)),
    level: 'L2',
  },
  {
    name: 'attach, score 0.99 but no exact identifier',
    draft: draft('document_attach', { match: { score: 0.99 } }),
    level: 'L2',
  },
  { name: 'attach, no match', draft: draft('document_attach'), level: 'L2' },
  {
    name: 'attach, ambiguous',
    draft: draft('document_attach', { ...exact('case_number'), ambiguous: true }),
    level: 'L2',
    downgradedBy: 'needs_you',
  },
  {
    name: 'attach, confidence 0.3',
    draft: draft('document_attach', { ...exact('case_number'), confidence: 0.3 }),
    level: 'L2',
    downgradedBy: 'needs_you',
  },
  {
    name: 'attach, AI without an anchor',
    draft: draft('document_attach', { ...exact('case_number'), ...ai, anchors: [] }),
    level: 'L2',
    downgradedBy: 'needs_you',
  },
  {
    name: 'attach, AI with an anchor',
    draft: draft('document_attach', { ...exact('case_number'), ...ai }),
    level: 'L3',
  },
  {
    name: 'attach, user asks first',
    draft: draft('document_attach', exact('case_number')),
    ctx: { askFirst: new Set(['document_attach']) },
    level: 'L2',
    downgradedBy: 'ask_first',
  },
  {
    name: 'attach, user asks first about another kind',
    draft: draft('document_attach', exact('case_number')),
    ctx: { askFirst: new Set(['task']) },
    level: 'L3',
  },
  // Item number, courtroom, bench from a list.
  {
    name: 'list data, exact case number',
    draft: draft('listing_update', exact('case_number')),
    level: 'L3',
  },
  {
    name: 'list data, score low but exact case number',
    draft: draft('listing_update', exact('case_number', 0.5)),
    level: 'L3',
  },
  {
    name: 'list data, CNR is not a case number',
    draft: draft('listing_update', exact('cnr')),
    level: 'L2',
  },
  {
    name: 'list data, fuzzy match',
    draft: draft('listing_update', { match: { score: 0.97 } }),
    level: 'L2',
  },
  { name: 'list data, no match', draft: draft('listing_update'), level: 'L2' },
  // Tasks.
  {
    name: 'undated task at 0.85',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.85 }),
    level: 'L3',
  },
  {
    name: 'undated task at exactly 0.8',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.8 }),
    level: 'L3',
  },
  {
    name: 'undated task at 0.79',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.79 }),
    level: 'L2',
    downgradedBy: 'threshold',
  },
  {
    name: 'undated task without confidence',
    draft: draft('task', { payload: { title: 'Call' }, confidence: null }),
    level: 'L2',
    downgradedBy: 'threshold',
  },
  {
    name: 'dated task at 0.95',
    draft: draft('task', { payload: { title: 'File', dueDate: '2030-01-05' } }),
    level: 'L2',
    downgradedBy: null,
  },
  {
    name: 'task with a null due date at 0.9',
    draft: draft('task', { payload: { title: 'Call', dueDate: null }, confidence: 0.9 }),
    level: 'L3',
  },
  {
    name: 'task at 0.4 is a card',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.4 }),
    level: 'L2',
    downgradedBy: 'needs_you',
  },
  {
    name: 'task below a learned threshold',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.85 }),
    ctx: { thresholds: new Map([[thresholdKey('task', 'task'), 0.9]]) },
    level: 'L2',
    downgradedBy: 'threshold',
  },
  {
    name: 'task above a learned threshold',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.85 }),
    ctx: { thresholds: new Map([[thresholdKey('task', 'task'), 0.82]]) },
    level: 'L3',
  },
  {
    name: 'a learned threshold of another pattern does not apply',
    draft: draft('task', {
      payload: { title: 'Call' },
      confidence: 0.85,
      patternKey: 'task:email',
    }),
    ctx: { thresholds: new Map([[thresholdKey('task', 'task'), 0.99]]) },
    level: 'L3',
  },
  {
    name: 'the learned threshold of this pattern applies',
    draft: draft('task', {
      payload: { title: 'Call' },
      confidence: 0.85,
      patternKey: 'task:email',
    }),
    ctx: { thresholds: new Map([[thresholdKey('task', 'task:email'), 0.9]]) },
    level: 'L2',
    downgradedBy: 'threshold',
  },
  {
    name: 'task, user asks first',
    draft: draft('task', { payload: { title: 'Call' }, confidence: 0.9 }),
    ctx: { askFirst: new Set(['task']) },
    level: 'L2',
    downgradedBy: 'ask_first',
  },
  {
    name: 'AI task, anchored',
    draft: draft('task', { ...ai, payload: { title: 'Call' }, confidence: 0.9 }),
    level: 'L3',
  },
  {
    name: 'AI task, unanchored',
    draft: draft('task', { ...ai, anchors: [], payload: { title: 'Call' }, confidence: 0.9 }),
    level: 'L2',
    downgradedBy: 'needs_you',
  },
  // People.
  {
    name: 'phone on a known party',
    draft: draft('party_detail', {
      payload: { personId: PERSON, contact: { phone: '98400 00000' } },
    }),
    level: 'L3',
  },
  {
    name: 'email on a known party',
    draft: draft('party_detail', {
      payload: { personId: PERSON, contact: { email: 'a@example.test' } },
    }),
    level: 'L3',
  },
  {
    name: 'a new person',
    draft: draft('party_detail', { payload: { name: 'A. Kumar', kind: 'party' } }),
    level: 'L2',
  },
  {
    name: 'a known party without a contact detail',
    draft: draft('party_detail', { payload: { personId: PERSON, name: 'A. Kumar' } }),
    level: 'L2',
  },
  {
    name: 'a contact detail without a known party',
    draft: draft('party_detail', { payload: { contact: { phone: '1' } } }),
    level: 'L2',
  },
  {
    name: 'known party, user asks first',
    draft: draft('party_detail', { payload: { personId: PERSON, contact: { phone: '1' } } }),
    ctx: { askFirst: new Set(['party_detail']) },
    level: 'L2',
    downgradedBy: 'ask_first',
  },
  // Duplicates merge at L3 with undo.
  {
    name: 'sha256 duplicate',
    draft: draft('duplicate_merge', { duplicate: { kind: 'sha256', ofDocumentId: DOC } }),
    level: 'L3',
  },
  {
    name: 'near duplicate',
    draft: draft('duplicate_merge', { duplicate: { kind: 'near_duplicate', ofDocumentId: DOC } }),
    level: 'L3',
  },
  { name: 'a merge without a duplicate event', draft: draft('duplicate_merge'), level: 'L2' },
  {
    name: 'an ambiguous duplicate',
    draft: draft('duplicate_merge', {
      duplicate: { kind: 'near_duplicate', ofDocumentId: DOC },
      ambiguous: true,
    }),
    level: 'L2',
    downgradedBy: 'needs_you',
  },
  // Money, memory, messages.
  { name: 'fee entry', draft: draft('fee_entry'), level: 'L2' },
  { name: 'memory item', draft: draft('memory_item'), level: 'L2' },
  { name: 'case status change', draft: draft('case_status_change'), level: 'L2' },
  {
    name: 'a client, senior or third-party message is a draft (L4)',
    draft: draft('outward_draft'),
    level: 'L4',
  },
  {
    name: 'an unanchored AI message draft stays L4 and is flagged',
    draft: draft('outward_draft', { ...ai, anchors: [] }),
    level: 'L4',
  },
];

describe('decideLevel: the 09 §4.2 approval matrix', () => {
  it('has at least 40 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)('$name', ({ draft: d, ctx, level, downgradedBy }) => {
    const decision = decideLevel(d, ctx);
    expect(decision.level).toBe(level);
    if (downgradedBy !== undefined) expect(decision.downgradedBy).toBe(downgradedBy);
  });

  it('flags an unanchored AI draft as a card, with a reason', () => {
    const decision = decideLevel(draft('task', { ...ai, anchors: [], payload: { title: 'x' } }));
    expect(decision.needsYou).toMatch(/unanchored/);
  });

  it('has a rule for every kind, and only L2 or L4 defaults', () => {
    for (const kind of PROPOSAL_KINDS) {
      const rule = APPROVAL_MATRIX[kind];
      expect(['L2', 'L4'], kind).toContain(rule.defaultLevel);
      expect(rule.reason.length, kind).toBeGreaterThan(10);
    }
    expect(Object.keys(APPROVAL_MATRIX).sort()).toEqual([...PROPOSAL_KINDS].sort());
  });

  it('keeps next_date, compliance, identity, money and memory out of L3 whatever the draft says', () => {
    const always: ProposalKind[] = [
      'next_date',
      'obligation_from_direction',
      'hearing_outcome',
      'new_matter',
      'new_proceeding',
      'order_record',
      'fee_entry',
      'memory_item',
      'case_status_change',
    ];
    for (const kind of always) {
      const d = draft(kind, {
        ...exact('case_number', 1),
        confidence: 1,
        duplicate: { kind: 'sha256', ofDocumentId: DOC },
      });
      expect(decideLevel(d).level, kind).not.toBe('L3');
    }
  });

  it('never returns a level outside L1-L4', () => {
    for (const { draft: d, ctx } of CASES) {
      expect(isAutomationLevel(decideLevel(d, ctx).level)).toBe(true);
    }
  });
});
