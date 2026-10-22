// Shared setup for the email intake tests (#528): fixture reader, allow-list, context.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProposalDraftSchema } from '@causedeck/validators';

import type { SenderPattern } from '../allow-list.ts';
import { processIntake, type IntakeOutcome } from '../registry.ts';
import type { IntakeContext } from '../types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, '../../../fixtures/email');

export const fixture = (name: string): string => readFileSync(join(FIXTURES, `${name}.eml`), 'utf8');

export const MATTER_ID = '11111111-1111-4111-8111-111111111111';

export const ALLOW_LIST: readonly SenderPattern[] = [
  { pattern: 'aims-registry@example.test', kind: 'court' },
  { pattern: 'registry@example.test', kind: 'court' },
  { pattern: 'efiling@example.test', kind: 'efiling' },
  { pattern: '@chambers.example.test', kind: 'briefing_counsel' },
  ...[
    'r.fictional',
    'k.kalpitham',
    's.imaginary',
    'v.imaginary',
  ].map((user): SenderPattern => ({ pattern: `${user}@example.test`, kind: 'self' })),
];

export const CONTEXT: IntakeContext = {
  receivedAt: '2026-10-22T14:00:00.000Z',
  forumCode: 'in.tn.madras-hc.principal',
  enrolmentNumbers: ['MS/123/1990'],
  aliases: [],
  matters: [{ matterId: MATTER_ID, matchKey: 'WP/12345/2026' }],
};

export async function intake(
  name: string,
  context: Partial<IntakeContext> = {},
): Promise<IntakeOutcome> {
  return processIntake(fixture(name), { allowList: ALLOW_LIST, context: { ...CONTEXT, ...context } });
}

/** The parsed outcome, failing the test when the message was dropped or quarantined. */
export async function parsed(name: string, context: Partial<IntakeContext> = {}) {
  const outcome = await intake(name, context);
  if (outcome.status !== 'parsed') throw new Error(`${name}: ${outcome.status}`);
  for (const draft of outcome.result.drafts) ProposalDraftSchema.parse(draft);
  return outcome;
}
