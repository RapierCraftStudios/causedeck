// The email layout reader (#396): folded headers, RFC 2047 subjects, multipart/alternative,
// quoted-printable and base64 bodies, iso-8859-1 text, an attached message/rfc822 read as its own
// page, attachment references, and total behaviour on malformed input.
import { describe, expect, it } from 'vitest';

import {
  emailAttachments,
  emailBodyText,
  LayoutDocumentSchema,
  layoutFromEmail,
  readEmail,
} from '../index.ts';

const MULTIPART = [
  'From: AIMS Registry <aims-registry@example.test>',
  'Subject: =?utf-8?B?Q2F1c2UgTGlzdA==?= for',
  ' 23.10.2026',
  'Date: Thu, 22 Oct 2026 18:05:00 +0530',
  'Content-Type: multipart/mixed; boundary="mix"',
  '',
  'preamble is ignored',
  '--mix',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=iso-8859-1',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Caf=E9 Fictional =',
  'Mills vs State',
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>HTML twin</p>',
  '--alt--',
  '--mix',
  'Content-Type: application/pdf; name="list.pdf"',
  'Content-Disposition: attachment; filename="list.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--mix',
  'Content-Type: message/rfc822',
  '',
  'Subject: Inner',
  'Content-Type: text/plain',
  'Content-Transfer-Encoding: base64',
  '',
  'SW5uZXIgYm9keQ==',
  '--mix--',
  '',
].join('\r\n');

describe('readEmail', () => {
  it('unfolds and decodes headers and walks the part tree', () => {
    const message = readEmail(MULTIPART);
    expect(message.subject).toBe('Cause List for 23.10.2026');
    expect(message.date).toBe('Thu, 22 Oct 2026 18:05:00 +0530');
    expect(message.body.contentType).toBe('multipart/mixed');
    expect(message.body.parts?.map((part) => [part.ref, part.contentType])).toEqual([
      ['1', 'multipart/alternative'],
      ['2', 'application/pdf'],
      ['3', 'message/rfc822'],
    ]);
    expect(message.body.parts?.[0]?.parts?.map((part) => part.ref)).toEqual(['1.1', '1.2']);
  });

  it('decodes quoted-printable iso-8859-1 and base64 bodies', () => {
    const message = readEmail(MULTIPART);
    expect(emailBodyText(message)).toBe('Café Fictional Mills vs State');
    const inner = message.body.parts?.[2]?.message;
    expect(inner?.subject).toBe('Inner');
    expect(inner === undefined ? '' : emailBodyText(inner)).toBe('Inner body');
  });

  it('lists attachments with their part references, never reading them as text', () => {
    const attachments = emailAttachments(readEmail(MULTIPART));
    expect(attachments.map((part) => [part.ref, part.fileName, part.contentType])).toEqual([
      ['2', 'list.pdf', 'application/pdf'],
    ]);
    expect(new TextDecoder().decode(attachments[0]?.content)).toBe('%PDF-1.4\n');
  });

  it('reads the HTML part when there is no plain text', () => {
    const message = readEmail(
      'Subject: x\nContent-Type: text/html\n\n<table><tr><td>1.</td><td>W.P.No.1 of 2026</td></tr></table>',
    );
    expect(emailBodyText(message)).toBe('1.\tW.P.No.1 of 2026');
  });

  it('accepts bytes and never throws on malformed input', () => {
    expect(readEmail(new TextEncoder().encode('Subject: Bytes\n\nbody')).subject).toBe('Bytes');
    for (const raw of ['', ':\n\n', 'Content-Type: multipart/mixed\n\n--', 'Subject: =?x?Q?=?=']) {
      expect(() => layoutFromEmail(raw)).not.toThrow();
    }
  });
});

describe('layoutFromEmail', () => {
  it('gives one page per message, subject and date first', () => {
    const layout = layoutFromEmail(MULTIPART);
    expect(LayoutDocumentSchema.parse(layout)).toEqual(layout);
    expect(layout.pages.map((page) => page.text)).toEqual([
      'Subject: Cause List for 23.10.2026\nDate: Thu, 22 Oct 2026 18:05:00 +0530\n\nCafé Fictional Mills vs State',
      'Subject: Inner\nDate: \n\nInner body',
    ]);
  });
});
