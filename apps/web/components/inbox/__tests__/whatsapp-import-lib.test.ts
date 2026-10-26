// The WhatsApp import's browser logic (#527): the export is read from a zip or a bare text file,
// held-back messages never reach the upload payload, and a client conversation is caught. Pure
// functions only (the Web Worker and the list are covered by the e2e spec). Synthetic fixtures.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { chatWarning, clientParticipants } from '../../../lib/inbox/whatsapp-import/heuristics.ts';
import {
  ParseChatError,
  extractChatText,
  parseChat,
  titleFromFileName,
} from '../../../lib/inbox/whatsapp-import/parse-chat.ts';
import { MAX_IMPORT_MESSAGES, buildPayload } from '../../../lib/inbox/whatsapp-import/payload.ts';
import {
  clearShown,
  confirmHeld,
  excludeHeld,
  initialSelection,
  selectShown,
  toggle,
} from '../../../lib/inbox/whatsapp-import/selection.ts';
import type { ImportRow } from '../../../lib/inbox/whatsapp-import/types.ts';
import {
  WHATSAPP_CAPTURE_PATH,
  uploadWhatsAppImport,
} from '../../../lib/inbox/whatsapp-import/upload.ts';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../../packages/capture/fixtures/whatsapp/${name}`, import.meta.url),
    ),
  );
const WORKSPACE = '00000000-0000-4000-8000-000000000001';

async function piiChat() {
  return parseChat(new Uint8Array(fixture('pii.txt')), 'WhatsApp Chat with Chambers.txt');
}

describe('reading the export', () => {
  it('reads the chat text from a zip, ignoring media and macOS metadata', () => {
    const zip = zipSync({
      '__MACOSX/_chat.txt': strToU8('junk'),
      'IMG-20261013-WA0001.jpg': new Uint8Array([1, 2, 3]),
      '_chat.txt': new Uint8Array(fixture('android.txt')),
    });
    expect(extractChatText(zip)).toContain('Good morning, hearing moved to Monday');
  });

  it('rejects a zip with no chat text and a broken zip', () => {
    const empty = zipSync({ 'a.jpg': new Uint8Array([1]) });
    expect(() => extractChatText(empty)).toThrow(ParseChatError);
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);
    expect(() => extractChatText(broken)).toThrowError(/not_zip/);
  });

  it('takes the chat title from the file name and hashes it', async () => {
    expect(titleFromFileName('WhatsApp Chat with Chambers.zip')).toBe('Chambers');
    const chat = await parseChat(
      new Uint8Array(fixture('android.txt')),
      'WhatsApp Chat with Chambers.zip',
    );
    expect(chat.title).toBe('Chambers');
    expect(chat.titleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(chat.senders).toEqual(['Asha', 'Ravi']);
  });

  it('drops system, deleted and empty lines and names attachments', async () => {
    const chat = await parseChat(new Uint8Array(fixture('android.txt')), 'chat.txt');
    expect(chat.rows.some((r) => r.text.includes('end-to-end encrypted'))).toBe(false);
    expect(chat.rows.find((r) => r.mediaRef !== undefined)?.mediaRef).toBe(
      'IMG-20261013-WA0001.jpg',
    );
    expect(chat.rows.every((r) => /^\d{4}-\d{2}-\d{2}T/.test(r.ts))).toBe(true);
  });

  it('flags messages the exclusion rules hold back', async () => {
    const chat = await piiChat();
    const rules = Object.fromEntries(chat.rows.map((r) => [r.text.slice(0, 12), r.rules]));
    expect(rules['Client Aadha']).toContain('aadhaar');
    expect(rules['OTP is 48291']).toContain('credential_phrase');
    expect(rules['Lunch at 1?']).toEqual([]);
  });
});

describe('selection', () => {
  it('starts with everything that is not held back', async () => {
    const chat = await piiChat();
    const selected = initialSelection(chat.rows);
    for (const row of chat.rows) expect(selected.has(row.id)).toBe(row.rules.length === 0);
  });

  it('confirms a releasable message but never an Aadhaar or credential one', async () => {
    const { rows } = await piiChat();
    const pan = rows.find((r) => r.rules.includes('pan')) as ImportRow;
    const aadhaar = rows.find((r) => r.rules.includes('aadhaar')) as ImportRow;
    let state = { selected: initialSelection(rows), confirmed: new Set<string>() };
    state = confirmHeld(state.selected, state.confirmed, pan);
    expect(state.selected.has(pan.id)).toBe(true);
    expect(state.confirmed.has(pan.id)).toBe(true);
    state = confirmHeld(state.selected, state.confirmed, aadhaar);
    expect(state.selected.has(aadhaar.id)).toBe(false);
    expect(toggle(state.selected, state.confirmed, aadhaar).has(aadhaar.id)).toBe(false);
    state = excludeHeld(state.selected, rows);
    expect(state.confirmed.size).toBe(0);
    expect(state.selected.has(pan.id)).toBe(false);
  });

  it('selects and clears the shown messages, up to the limit', async () => {
    const { rows } = await piiChat();
    const none = clearShown(initialSelection(rows), rows);
    expect(none.size).toBe(0);
    expect(selectShown(none, new Set(), rows).size).toBe(
      rows.filter((r) => r.rules.length === 0).length,
    );
    const many: ImportRow[] = Array.from({ length: MAX_IMPORT_MESSAGES + 10 }, (_, i) => ({
      id: String(i),
      ts: '2026-10-16T09:00:00',
      sender: 'Asha',
      text: `m${String(i)}`,
      rules: [],
    }));
    expect(initialSelection(many).size).toBe(MAX_IMPORT_MESSAGES);
  });
});

describe('the upload payload', () => {
  it('has exactly the shape the server accepts and carries the selected messages only', async () => {
    const chat = await piiChat();
    const kept = chat.rows.filter((r) => r.rules.length === 0);
    const payload = buildPayload(WORKSPACE, chat, initialSelection(chat.rows), new Set());
    expect(Object.keys(payload).sort()).toEqual(
      ['chatTitleHash', 'chatType', 'dateOrder', 'messages', 'openedFor', 'workspaceId'].sort(),
    );
    expect(payload).toMatchObject({
      chatType: 'internal',
      openedFor: 'internal',
      workspaceId: WORKSPACE,
    });
    expect(payload.chatTitleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.messages.map((m) => m.id)).toEqual(kept.map((r) => r.id));
    for (const message of payload.messages) {
      expect(Object.keys(message).sort()).toEqual(['id', 'sender', 'text', 'ts']);
      expect(message.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/);
    }
    const body = JSON.stringify(payload);
    expect(body).not.toContain('2345 6789 0123');
    expect(body).not.toContain('482913');
    expect(body).not.toContain('Chambers');
  });

  it('sends a confirmed message with its id in confirmedIds, and never a locked one', async () => {
    const chat = await piiChat();
    const pan = chat.rows.find((r) => r.rules.includes('pan')) as ImportRow;
    const aadhaar = chat.rows.find((r) => r.rules.includes('aadhaar')) as ImportRow;
    const selected = new Set([...initialSelection(chat.rows), pan.id, aadhaar.id]);
    const payload = buildPayload(WORKSPACE, chat, selected, new Set([pan.id, aadhaar.id]));
    expect(payload.confirmedIds).toEqual([pan.id]);
    expect(payload.messages.some((m) => m.id === aadhaar.id)).toBe(false);
  });

  it('posts JSON to the capture route and words each failure', async () => {
    const chat = await piiChat();
    const payload = buildPayload(WORKSPACE, chat, initialSelection(chat.rows), new Set());
    const post = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    expect(await uploadWhatsAppImport(payload, post as unknown as typeof fetch)).toEqual({
      ok: true,
    });
    const [path, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(WHATSAPP_CAPTURE_PATH);
    expect(JSON.parse(init.body as string)).toEqual(payload);
    const status = (code: number) =>
      uploadWhatsAppImport(payload, () => Promise.resolve(new Response('{}', { status: code })));
    expect(await status(404)).toEqual({ ok: false, error: 'not_found' });
    expect(await status(413)).toEqual({ ok: false, error: 'too_large' });
    expect(await status(500)).toEqual({ ok: false, error: 'failed' });
    const down = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await uploadWhatsAppImport(payload, down)).toEqual({ ok: false, error: 'failed' });
  });
});

describe('client conversation heuristics', () => {
  it('catches client participants by honorific, label or phone number', () => {
    expect(clientParticipants(['Advocate Rao', 'Mr Sharma'])).toEqual(['Mr Sharma']);
    expect(clientParticipants(['Asha', 'Client Meera', '+91 98765 43210'])).toEqual([
      'Client Meera',
      '+91 98765 43210',
    ]);
    expect(clientParticipants(['Asha', 'Ravi'])).toEqual([]);
  });

  it('asks about a two-person chat the member is not in, and lets their own chats pass', () => {
    expect(chatWarning(['Mr Sharma', 'Advocate Rao'], 'Asha Rao')).toMatchObject({
      kind: 'client_participants',
    });
    expect(chatWarning(['Ravi', 'Meena'], 'Asha Rao')).toEqual({ kind: 'two_person_non_member' });
    expect(chatWarning(['Asha', 'Ravi'], 'Asha Rao')).toBeNull();
    expect(chatWarning(['Asha', 'Ravi', 'Meena'], 'Kiran')).toBeNull();
  });

  it('flags the synthetic client chat fixture', async () => {
    const chat = await parseChat(new Uint8Array(fixture('client-chat.txt')), 'client.txt');
    expect(chatWarning(chat.senders, 'Advocate Rao')?.kind).toBe('client_participants');
  });
});
