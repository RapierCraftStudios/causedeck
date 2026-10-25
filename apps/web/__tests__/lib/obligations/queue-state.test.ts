import { describe, expect, it } from 'vitest';

import {
  filterQueue,
  groupItems,
  parseQueueParams,
  serialiseQueueParams,
  suggestNextStep,
  type QueueItem,
} from '../../../lib/obligations/queue-state.ts';

const ID = '00000000-0000-4000-8000-0000000000a1';
const item = (over: Partial<QueueItem>): QueueItem => ({
  id: 'o1',
  group: 'today',
  matterId: ID,
  matterTitle: 'Sharma v State',
  caseNumber: 'WP 1234/2026',
  description: 'File counter affidavit',
  dueDate: '2026-10-26',
  source: 'internal',
  sourceType: 'manual',
  status: 'open',
  ownerMemberId: null,
  ownerName: 'Asha',
  sourceQuote: null,
  basis: null,
  ...over,
});

describe('queue params (#68)', () => {
  it('round-trips the tab and filters and drops malformed values', () => {
    const parsed = parseQueueParams({
      tab: 'defects',
      kind: 'rule',
      matter: 'nope',
      group: 'x',
      q: ' hi ',
    });
    expect(parsed.tab).toBe('defects');
    expect(parsed.filters).toMatchObject({
      kind: 'rule',
      q: 'hi',
      matter: undefined,
      group: undefined,
    });
    expect(serialiseQueueParams(parsed).toString()).toBe('tab=defects&kind=rule&q=hi');
    expect(serialiseQueueParams(parseQueueParams({})).toString()).toBe('');
  });
});

describe('filterQueue and groupItems', () => {
  const rows = [
    item({ id: 'a' }),
    item({
      id: 'b',
      group: 'overdue',
      source: 'rule',
      description: 'Hearing prep',
      ownerName: null,
    }),
  ];
  it('narrows by filter and by search words', () => {
    expect(filterQueue(rows, { kind: 'rule' }).map((r) => r.id)).toEqual(['b']);
    expect(filterQueue(rows, { q: 'sharma affidavit' }).map((r) => r.id)).toEqual(['a']);
    expect(filterQueue(rows, { group: 'later' })).toEqual([]);
  });
  it('groups every row under its group', () => {
    expect(groupItems(rows).overdue.map((r) => r.id)).toEqual(['b']);
  });
});

describe('suggestNextStep', () => {
  it('drafts a letter for a client, a reminder for registry work, a task otherwise', () => {
    expect(suggestNextStep(item({ source: 'client' })).type).toBe('letter');
    expect(suggestNextStep(item({ source: 'registry_defect' })).type).toBe('reminder');
    expect(suggestNextStep(item({ source: 'order_direction' })).type).toBe('task');
  });
});
