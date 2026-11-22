import { describe, expect, it } from 'vitest';

import { draftNarrative, NarrativeOutputError, type NarrativePort } from '../index';
import type { NarrativeBlock } from '../blocks';

const block: NarrativeBlock = { type: 'narrative', id: 'n1', prompt: 'Summarise', maxChars: 300 };
const portOf = (output: unknown): NarrativePort => ({ run: () => Promise.resolve({ output }) });
const draft = (output: unknown) =>
  draftNarrative(
    portOf(output),
    block,
    { today: '2025-01-01' },
    { workspaceId: 'w', purpose: 'drafting.narrative' },
  );

const CITATIONS = [
  '2024:KHC:5678',
  '2023 INSC 123',
  '(2020) 3 SCC 45',
  'AIR 1990 SC 12',
  'W.P. No. 1234 of 2024',
  's. 106 BNS',
  'Ramesh v. State of Karnataka',
];

describe('draftNarrative citation guard', () => {
  it.each(CITATIONS)('rejects output containing %s without echoing it', async (citation) => {
    const text = `The client was served on the stated date, see ${citation} for the rule.`;
    const err = await draft({ text }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NarrativeOutputError);
    expect((err as Error).message).not.toContain(citation);
    expect((err as Error).message).not.toContain(text);
  });

  it('passes plain fact prose', async () => {
    const text = 'On 12 March 2024 Asha Vellore paid Rs 45,000 to the Department of Roads.';
    await expect(draft({ text })).resolves.toEqual({ text, modelDrafted: true, rewritten: false });
  });

  it('keeps the schema, empty and maxChars rejections', async () => {
    await expect(draft({ nope: 1 })).rejects.toBeInstanceOf(NarrativeOutputError);
    await expect(draft({ text: '   ' })).rejects.toBeInstanceOf(NarrativeOutputError);
    await expect(draft({ text: 'x'.repeat(301) })).rejects.toBeInstanceOf(NarrativeOutputError);
  });
});
