import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectDateOrder } from '../date-order.ts';
import { detectAttachment, mediaKindFromName } from '../media-names.ts';
import { parseWhatsAppExport } from '../parser.ts';

const fixture = (name: string): string =>
  readFileSync(path.resolve(import.meta.dirname, '../../../fixtures/whatsapp', name), 'utf8');

// [line, expected `at`, sender, text]
const LINES: [string, string | null, string | null, string][] = [
  ['12/10/2026, 10:01 - Asha: hi', '2026-10-12T10:01:00', 'Asha', 'hi'],
  ['12/10/26, 10:01 - Asha: hi', '2026-10-12T10:01:00', 'Asha', 'hi'],
  ['12/10/2026, 22:05 - Asha: late', '2026-10-12T22:05:00', 'Asha', 'late'],
  ['12/10/2026, 10:01 pm - Asha: hi', '2026-10-12T22:01:00', 'Asha', 'hi'],
  ['12/10/2026, 10:01 am - Asha: hi', '2026-10-12T10:01:00', 'Asha', 'hi'],
  ['12/10/2026, 12:05 am - Asha: midnight', '2026-10-12T00:05:00', 'Asha', 'midnight'],
  ['12/10/2026, 12:05 pm - Asha: noon', '2026-10-12T12:05:00', 'Asha', 'noon'],
  ['12/10/2026, 1:05 p.m. - Asha: dotted', '2026-10-12T13:05:00', 'Asha', 'dotted'],
  ['12/10/2026, 10:01 PM - Asha: narrow nbsp', '2026-10-12T22:01:00', 'Asha', 'narrow nbsp'],
  ['12/10/2026, 10:01 pm - Asha: nbsp', '2026-10-12T22:01:00', 'Asha', 'nbsp'],
  ['[12/10/26, 10:01:05 AM] Asha: ios', '2026-10-12T10:01:05', 'Asha', 'ios'],
  ['[12/10/2026, 22:01:05] Asha: ios 24h', '2026-10-12T22:01:05', 'Asha', 'ios 24h'],
  ['[12/10/26, 10:01:05 PM] Asha: ios narrow', '2026-10-12T22:01:05', 'Asha', 'ios narrow'],
  ['‎[12/10/26, 10:01:05 AM] Asha: lrm prefix', '2026-10-12T10:01:05', 'Asha', 'lrm prefix'],
  ['﻿12/10/2026, 10:01 - Asha: bom', '2026-10-12T10:01:00', 'Asha', 'bom'],
  ['12.10.2026, 10:01 - Asha: dots', '2026-10-12T10:01:00', 'Asha', 'dots'],
  ['12-10-2026, 10:01 - Asha: dashes', '2026-10-12T10:01:00', 'Asha', 'dashes'],
  ['12/10/2026 10:01 - Asha: no comma', '2026-10-12T10:01:00', 'Asha', 'no comma'],
  ['2/1/2026, 9:05 - Asha: single digits', '2026-01-02T09:05:00', 'Asha', 'single digits'],
  ['31/12/2026, 23:59 - Asha: year end', '2026-12-31T23:59:00', 'Asha', 'year end'],
  ['29/02/2028, 10:00 - Asha: leap day', '2028-02-29T10:00:00', 'Asha', 'leap day'],
  ['30/02/2026, 10:00 - Asha: no such day', null, 'Asha', 'no such day'],
  ['12/10/2026, 25:00 - Asha: bad hour', null, 'Asha', 'bad hour'],
  ['12/10/2026, 10:01 - Asha Rao: two words', '2026-10-12T10:01:00', 'Asha Rao', 'two words'],
  [
    '12/10/2026, 10:01 - +91 98765 43210: number sender',
    '2026-10-12T10:01:00',
    '+91 98765 43210',
    'number sender',
  ],
  ['12/10/2026, 10:01 - ~ Ravi: tilde sender', '2026-10-12T10:01:00', '~ Ravi', 'tilde sender'],
  ['12/10/2026, 10:01 - Asha: a: b: c', '2026-10-12T10:01:00', 'Asha', 'a: b: c'],
  ['12/10/2026, 10:01 - Asha: 🙏 emoji', '2026-10-12T10:01:00', 'Asha', '🙏 emoji'],
  ['12/10/2026, 10:01 - Meena: நாளை விசாரணை', '2026-10-12T10:01:00', 'Meena', 'நாளை விசாரணை'],
  ['12/10/2026, 10:01 - Kiran: ನಾಳೆ ವಿಚಾರಣೆ', '2026-10-12T10:01:00', 'Kiran', 'ನಾಳೆ ವಿಚಾರಣೆ'],
  [
    '12/10/2026, 10:01 - Asha: http://x.test/a:b',
    '2026-10-12T10:01:00',
    'Asha',
    'http://x.test/a:b',
  ],
  ['12/10/2026, 10:01 - Asha: time 10:30 - ok', '2026-10-12T10:01:00', 'Asha', 'time 10:30 - ok'],
];

describe('parseWhatsAppExport line variants', () => {
  it.each(LINES)('%s', (line, at, sender, text) => {
    const { messages } = parseWhatsAppExport(line);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ at, sender, text, system: false });
  });
});

const SYSTEM: string[] = [
  '12/10/2026, 10:01 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
  '12/10/2026, 10:01 - Asha created group "Chambers"',
  '12/10/2026, 10:01 - Asha added Ravi',
  '12/10/2026, 10:01 - Ravi left',
  '12/10/2026, 10:01 - You changed the group description',
  "[12/10/26, 10:01:05 AM] Ravi joined using this group's invite link",
  '12/10/2026, 10:01 - Your security code with Ravi changed. Tap to learn more.',
];

describe('system lines', () => {
  it.each(SYSTEM)('%s', (line) => {
    const [m] = parseWhatsAppExport(line).messages;
    expect(m).toMatchObject({ system: true, sender: null });
  });
});

describe('markers', () => {
  const one = (body: string) =>
    parseWhatsAppExport(`12/10/2026, 10:01 - Asha: ${body}`).messages[0];

  it.each([
    ['This message was deleted'],
    ['You deleted this message'],
    ['You deleted this message.'],
    ['null'],
  ])('deleted: %s', (body) => {
    expect(one(body)).toMatchObject({ deleted: true, text: '' });
  });

  it('edited marker is stripped and flagged', () => {
    expect(one('fixed typo <This message was edited>')).toMatchObject({
      edited: true,
      text: 'fixed typo',
      deleted: false,
    });
  });

  it('a message merely containing "null" is not deleted', () => {
    expect(one('null and void')).toMatchObject({ deleted: false, text: 'null and void' });
  });

  it.each([
    ['IMG-20261013-WA0001.jpg (file attached)', 'IMG-20261013-WA0001.jpg', 'image'],
    [
      '<attached: 00000012-PHOTO-2026-10-13-11-30-00.jpg>',
      '00000012-PHOTO-2026-10-13-11-30-00.jpg',
      'image',
    ],
    [
      '<attached: 00000013-AUDIO-2026-10-13-11-30-00.opus>',
      '00000013-AUDIO-2026-10-13-11-30-00.opus',
      'audio',
    ],
    ['Order.pdf (file attached)', 'Order.pdf', 'document'],
    ['<Media omitted>', null, 'image'],
    ['video omitted', null, 'video'],
    ['sticker omitted', null, 'sticker'],
  ])('attachment: %s', (body, name, kind) => {
    expect(one(body)?.attachment).toEqual({ name, kind });
  });

  it('keeps multi-line messages together and trims trailing blank lines', () => {
    const { messages } = parseWhatsAppExport(
      '12/10/2026, 10:01 - Asha: line one\nline two\n\nline four\n12/10/2026, 10:02 - Ravi: next\n\n',
    );
    expect(messages.map((m) => m.text)).toEqual(['line one\nline two\n\nline four', 'next']);
    expect(messages.map((m) => m.index)).toEqual([0, 1]);
  });

  it('counts preamble lines that belong to no message', () => {
    const out = parseWhatsAppExport('junk\n\n12/10/2026, 10:01 - Asha: hi');
    expect(out.skippedLines).toBe(1);
    expect(out.messages).toHaveLength(1);
  });

  it('handles CRLF and an empty export', () => {
    expect(
      parseWhatsAppExport('12/10/2026, 10:01 - A: x\r\n12/10/2026, 10:02 - B: y').messages,
    ).toHaveLength(2);
    expect(parseWhatsAppExport('').messages).toEqual([]);
  });
});

describe('date order', () => {
  it('defaults to dd/mm and reports ambiguity', () => {
    const out = parseWhatsAppExport('03/04/2026, 10:01 - Asha: hi');
    expect(out).toMatchObject({ dateOrder: 'dmy', dateOrderAmbiguous: true });
    expect(out.messages[0]?.at).toBe('2026-04-03T10:01:00');
  });

  it('flips on request', () => {
    const out = parseWhatsAppExport('03/04/2026, 10:01 - Asha: hi', { dateOrder: 'mdy' });
    expect(out).toMatchObject({ dateOrder: 'mdy', dateOrderAmbiguous: false });
    expect(out.messages[0]?.at).toBe('2026-03-04T10:01:00');
  });

  it('detects mm/dd from a second field above 12', () => {
    const out = parseWhatsAppExport('10/13/2026, 10:01 - A: x\n03/04/2026, 10:02 - B: y');
    expect(out.dateOrder).toBe('mdy');
    expect(out.messages.map((m) => m.at)).toEqual(['2026-10-13T10:01:00', '2026-03-04T10:02:00']);
  });

  it('detectDateOrder: dmy proof, mdy proof, conflict, empty', () => {
    expect(detectDateOrder([[25, 1]])).toEqual({ order: 'dmy', ambiguous: false });
    expect(detectDateOrder([[1, 25]])).toEqual({ order: 'mdy', ambiguous: false });
    expect(
      detectDateOrder([
        [25, 1],
        [1, 25],
      ]),
    ).toEqual({ order: 'dmy', ambiguous: true });
    expect(detectDateOrder([])).toEqual({ order: 'dmy', ambiguous: true });
    expect(detectDateOrder([], 'mdy').order).toBe('mdy');
  });
});

describe('media names', () => {
  it.each([
    ['IMG-20261013-WA0001.jpg', 'image'],
    ['VID-20261013-WA0002.mp4', 'video'],
    ['PTT-20261013-WA0003.opus', 'audio'],
    ['STK-20261013-WA0004.webp', 'sticker'],
    ['DOC-20261013-WA0005.pdf', 'document'],
    ['00000012-PHOTO-2026-10-13-11-30-00.jpg', 'image'],
    ['00000012-VIDEO-2026-10-13-11-30-00.mp4', 'video'],
    ['00000012-STICKER-2026-10-13-11-30-00.webp', 'sticker'],
    ['WhatsApp Audio 2026-10-13 at 10.01.opus', 'audio'],
    ['scan.PNG', 'image'],
    ['notes.docx', 'document'],
    ['contact.vcf', 'contact'],
    ['mystery.bin', 'other'],
  ])('%s is %s', (name, kind) => {
    expect(mediaKindFromName(name)).toBe(kind);
  });

  it('plain text is not an attachment', () => {
    expect(detectAttachment('see the file attached')).toBeNull();
  });
});

describe('synthetic fixtures', () => {
  it('android', () => {
    const out = parseWhatsAppExport(fixture('android.txt'));
    expect(out.dateOrder).toBe('dmy');
    expect(out.messages.map((m) => m.system)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(out.messages[2]?.text).toBe(
      'Good morning, hearing moved to Monday\nPlease bring the file',
    );
    expect(out.messages[3]?.attachment?.kind).toBe('image');
    expect(out.messages[4]).toMatchObject({ edited: true, text: 'Order uploaded' });
    expect(out.messages[5]?.deleted).toBe(true);
    expect(out.messages[6]?.deleted).toBe(true);
    expect(out.messages[7]?.attachment).toEqual({ name: null, kind: 'image' });
  });

  it('ios with narrow no-break spaces and direction marks', () => {
    const out = parseWhatsAppExport(fixture('ios.txt'));
    expect(out.messages.map((m) => m.at)).toEqual([
      '2026-10-12T10:01:05',
      '2026-10-12T22:02:11',
      '2026-10-13T11:30:00',
      '2026-10-13T11:31:00',
    ]);
    expect(out.messages[1]?.text).toBe('Filing done\nsecond line');
    expect(out.messages[2]?.attachment?.name).toBe('00000012-PHOTO-2026-10-13-11-30-00.jpg');
    expect(out.messages[3]?.deleted).toBe(true);
  });

  it('client chat and Tamil/Kannada/emoji', () => {
    expect(parseWhatsAppExport(fixture('client-chat.txt')).messages).toHaveLength(3);
    const out = parseWhatsAppExport(fixture('indic-emoji.txt'));
    expect(out.messages[0]?.text).toContain('விசாரணை');
    expect(out.messages[1]?.text).toContain('ವಿಚಾರಣೆ');
    expect(out.messages[2]?.text).toBe('✅ Done 😀');
  });
});
