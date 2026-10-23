import { parseWhatsAppExport } from '@causedeck/capture';
import { describe, expect, it } from 'vitest';

import { rebuildExportText, safeMediaName, WhatsAppImportInput } from '../payload.ts';

const messages = [
  { ts: '2026-10-12T10:01:00', sender: 'Asha Rao', text: 'File the reply by 15/10/2026' },
  { ts: '2026-10-12T10:05:00', sender: 'Ravi: K', text: 'Done\nwill call the registry' },
  { ts: '2026-10-13T09:00:00', sender: 'Asha Rao', text: '', mediaRef: 'IMG-20261013-WA0001.jpg' },
];

describe('rebuildExportText', () => {
  it.each(['dmy', 'mdy'] as const)('re-parses to the same messages (%s)', (order) => {
    const parsed = parseWhatsAppExport(rebuildExportText(messages, order), { dateOrder: order });
    expect(parsed.messages).toHaveLength(messages.length);
    expect(parsed.messages.map((m) => m.at)).toEqual([
      '2026-10-12T10:01:00',
      '2026-10-12T10:05:00',
      '2026-10-13T09:00:00',
    ]);
    expect(parsed.messages[1]?.text).toBe('Done\nwill call the registry');
    expect(parsed.messages[2]?.attachment?.name).toBe('IMG-20261013-WA0001.jpg');
  });
});

describe('safeMediaName', () => {
  it('keeps plain allow-listed names and drops paths and unknown types', () => {
    expect(safeMediaName('IMG-20261013-WA0001.jpg')).toBe('IMG-20261013-WA0001.jpg');
    expect(safeMediaName('../etc/passwd.pdf')).toBeNull();
    expect(safeMediaName('run.exe')).toBeNull();
    expect(safeMediaName('noextension')).toBeNull();
  });
});

describe('WhatsAppImportInput', () => {
  const valid = {
    chatTitleHash: 'a'.repeat(64),
    chatType: 'internal',
    dateOrder: 'dmy',
    messages: [{ id: 'm1', ts: '2026-10-12T10:01:00', sender: 'Asha', text: 'hi' }],
  };

  it('defaults openedFor to internal', () => {
    expect(WhatsAppImportInput.parse(valid).openedFor).toBe('internal');
  });

  it('rejects unknown fields, a bad hash and an empty selection', () => {
    expect(WhatsAppImportInput.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(WhatsAppImportInput.safeParse({ ...valid, chatTitleHash: 'x' }).success).toBe(false);
    expect(WhatsAppImportInput.safeParse({ ...valid, messages: [] }).success).toBe(false);
  });
});
