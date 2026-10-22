// The parser registry (#528): the winner is the highest score >= 0.6, ties go to registry order,
// `generic` is the 0.1 fallback, and a new parser is one file plus one registry line.
import { describe, expect, it } from 'vitest';

import { genericParser } from '../parsers/generic.ts';
import { INTAKE_PARSERS, MATCH_THRESHOLD, processIntake, selectParser } from '../registry.ts';
import type { IntakeEmail, IntakeParser } from '../types.ts';
import { parseEmail } from '../mime.ts';
import { unwrapForward } from '../unwrap.ts';

import { ALLOW_LIST, CONTEXT, fixture } from './helpers.ts';

const make = (id: string, score: number): IntakeParser => ({
  id,
  match: () => score,
  parse: () => ({ captures: [], drafts: [], diagnostics: [] }),
});

async function email(): Promise<IntakeEmail> {
  return unwrapForward(await parseEmail(fixture('injection')));
}

describe('selectParser', () => {
  it('keeps generic at 0.1 and last in the registry', () => {
    expect(INTAKE_PARSERS.at(-1)).toBe(genericParser);
    expect(INTAKE_PARSERS.map((p) => p.id)).toEqual([
      'aims-cause-list',
      'registry-memo',
      'efiling-ack',
      'briefing-counsel',
      'generic',
    ]);
  });

  it('picks the highest score, breaking ties by registry order', async () => {
    const e = await email();
    expect(selectParser(e, [make('a', 0.7), make('b', 0.9), make('c', 0.9), genericParser]).parser.id).toBe('b');
  });

  it('ignores scores under the threshold and falls back to generic', async () => {
    const e = await email();
    const choice = selectParser(e, [make('weak', MATCH_THRESHOLD - 0.01), genericParser]);
    expect(choice.parser.id).toBe('generic');
  });

  it('a dummy parser is one file plus one registry line', async () => {
    const dummy: IntakeParser = {
      id: 'dummy',
      match: (e) => (e.subject.includes('hearing') ? 0.8 : 0),
      parse: () => ({
        captures: [],
        drafts: [],
        diagnostics: [{ code: 'dummy', severity: 'info', message: 'ran' }],
      }),
    };
    const outcome = await processIntake(fixture('injection'), {
      allowList: ALLOW_LIST,
      context: CONTEXT,
      parsers: [dummy, ...INTAKE_PARSERS],
    });
    expect(outcome).toMatchObject({ status: 'parsed', parserId: 'dummy', score: 0.8 });
  });
});
