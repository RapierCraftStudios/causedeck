import { describe, expect, it } from 'vitest';

import { chatItemsToDrafts, isClientInstruction } from '../to-proposals.ts';
import {
  buildStructureInput,
  ClientChatNotStructurableError,
  dateAppearsInText,
  verifyChatItems,
  type ChatMessage,
  type RawChatItem,
  type VerifiedChatItem,
} from '../structure.ts';

const messages: ChatMessage[] = [
  {
    id: 'm1',
    ts: '2026-10-12T10:01:00',
    sender: 'Asha',
    text: 'Please file the reply by 15/10/2026',
  },
  {
    id: 'm2',
    ts: '2026-10-12T10:02:00',
    sender: 'Ravi',
    text: 'Call the registry about the order',
  },
  { id: 'm3', ts: '2026-10-12T10:03:00', sender: null, text: 'Messages are end-to-end encrypted' },
];

const item = (over: Partial<RawChatItem> = {}): RawChatItem => ({
  title: 'File the reply',
  dueDate: '2026-10-15',
  ref: 'm1',
  quote: 'file the reply',
  clientInstruction: false,
  confidence: 0.9,
  ...over,
});

describe('buildStructureInput', () => {
  it('never lets a client chat through', () => {
    expect(() => buildStructureInput('client', messages)).toThrow(ClientChatNotStructurableError);
  });

  it('sends internal messages only, without system lines', () => {
    const input = buildStructureInput('internal', messages);
    expect(input.messages.map((m) => m.ref)).toEqual(['m1', 'm2']);
  });
});

describe('dateAppearsInText', () => {
  it.each([
    ['2026-10-15', 'by 15/10/2026', 'dmy', true],
    ['2026-10-15', 'by 15.10.26', 'dmy', true],
    ['2026-10-15', 'by 10/15/2026', 'mdy', true],
    ['2026-10-15', 'by 15th October 2026', 'dmy', true],
    ['2026-10-15', 'on Oct 15, 2026', 'dmy', true],
    ['2026-10-15', 'by 16/10/2026', 'dmy', false],
    ['2026-10-15', 'by Friday', 'dmy', false],
    ['2026-10-15', 'by 15/10', 'dmy', false],
  ] as const)('%s in "%s" (%s) -> %s', (iso, text, order, expected) => {
    expect(dateAppearsInText(iso, text, order)).toBe(expected);
  });
});

describe('verifyChatItems', () => {
  it('anchors an item to the cited message and takes ts and sender from it', () => {
    const [kept] = verifyChatItems([item()], messages);
    expect(kept).toMatchObject({ ref: 'm1', ts: '2026-10-12T10:01:00', sender: 'Asha' });
  });

  it('drops items citing an unknown message, a system line or a quote not in the text', () => {
    expect(
      verifyChatItems(
        [item({ ref: 'zz' }), item({ ref: 'm3' }), item({ quote: 'something else' })],
        messages,
      ),
    ).toEqual([]);
  });

  it('drops an item whose date is not literally in the message', () => {
    expect(verifyChatItems([item({ dueDate: '2026-11-01' })], messages)).toEqual([]);
  });

  it('keeps an undated item', () => {
    expect(
      verifyChatItems([item({ ref: 'm2', quote: 'Call the registry', dueDate: null })], messages),
    ).toHaveLength(1);
  });
});

describe('chatItemsToDrafts', () => {
  const verified = verifyChatItems([item()], messages);
  const first = (): VerifiedChatItem => {
    const [one] = verified;
    if (one === undefined) throw new Error('no verified item');
    return one;
  };

  it('makes an anchored task draft with the message as its source ref', () => {
    const [draft] = chatItemsToDrafts(verified, {
      captureId: 'c1',
      aiCallId: null,
      anchorIds: new Map([['m1', 'a1']]),
    });
    expect(draft).toMatchObject({
      kind: 'task',
      source: { type: 'ai', input: 'whatsapp', ref: 'm1' },
      payload: { title: 'File the reply', dueDate: '2026-10-15' },
      anchors: ['a1'],
    });
    expect(draft?.ambiguous).toBeUndefined();
  });

  it('marks a client instruction ambiguous so it is never auto-actioned', () => {
    expect(isClientInstruction({ clientInstruction: true, quote: 'x' })).toBe(true);
    expect(
      isClientInstruction({ clientInstruction: false, quote: 'the client wants it filed' }),
    ).toBe(true);
    const [draft] = chatItemsToDrafts([{ ...first(), clientInstruction: true }], {
      captureId: 'c1',
      aiCallId: null,
    });
    expect(draft?.ambiguous).toBe(true);
  });

  it('omits dueDate for an undated item', () => {
    const [draft] = chatItemsToDrafts([{ ...first(), dueDate: null }], {
      captureId: 'c1',
      aiCallId: null,
    });
    expect(draft?.payload).not.toHaveProperty('dueDate');
  });
});
