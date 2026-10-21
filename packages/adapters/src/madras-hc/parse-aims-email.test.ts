// AIMS cause-list email parser (#396): plain and HTML bodies, Gmail, Outlook and Apple Mail
// forwards, an attached message/rfc822, table and line layouts, a PDF-only email, `listDate` from
// the subject or the body anchored on its phrase, a new template added as config only, and
// malformed input that never throws.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { layoutFromEmail } from '../layout/email.ts';
import { FIXTURES_ROOT } from '../testing/golden.ts';
import { ParsedCauseListSchema, type ParsedCauseList } from '../types.ts';

import { AIMS_EMAIL_PROFILES, type AimsEmailProfile } from './config/email-profiles.ts';
import { createMadrasHcAdapter } from './index.ts';
import { parseAimsEmail } from './parse-aims-email.ts';

const DIR = path.join(FIXTURES_ROOT, 'in.tn.madras-hc.principal');
const raw = (name: string) => readFileSync(path.join(DIR, name), 'utf8');
const parse = (email: string, profiles?: readonly AimsEmailProfile[]): ParsedCauseList =>
  ParsedCauseListSchema.parse(parseAimsEmail(email, profiles === undefined ? {} : { profiles }));

/** Every anchor quotes the decoded page it names. */
function expectAnchored(email: string, list: ParsedCauseList): void {
  const pages = layoutFromEmail(email).pages.map((page) => page.text);
  for (const anchor of [
    ...list.rows.map((row) => row.anchor),
    ...(list.unparsedRows ?? []).map((row) => row.anchor),
    ...(list.listDateAnchor === null || list.listDateAnchor === undefined
      ? []
      : [list.listDateAnchor]),
  ]) {
    expect(pages[anchor.page - 1], anchor.quote).toContain(anchor.quote);
  }
}

const LIST_BODY = [
  'COURT No. 12',
  'THE HONOURABLE MR. JUSTICE A. FICTIONAL',
  'FOR ADMISSION',
  '5. W.P.No.12345 of 2026',
  '   Fictional Mills Ltd. vs The Secretary',
  '   Mr. R. Fictional (MS/123/1990)',
].join('\n');

const message = (headers: string, body: string) =>
  `From: AIMS Registry <aims-registry@example.test>\n${headers}\nMIME-Version: 1.0\n\n${body}\n`;

describe('parseAimsEmail: bodies and layouts', () => {
  it('reads a plain-text email in the list grammar, with listDate from the subject', () => {
    const email = raw('email-01-plain.input.eml');
    const list = parse(email);
    expect(list).toMatchObject({
      source: 'email',
      status: 'ok',
      listDate: '2026-10-23',
      listDateAnchor: { page: 1, quote: 'for 23.10.2026', rowIndex: 0 },
    });
    expect(list.rows.map((row) => [row.hallNo, row.itemNo, row.matchKey, row.stageNorm])).toEqual([
      ['12', '5', 'WP/12345/2026', 'admission'],
      ['12', '17', 'WP/9876/2025', 'orders'],
      ['9', '3', 'CRLOP/4570/2026', 'fresh'],
    ]);
    expect(list.rows[0]?.advocates?.[0]?.enrolmentNo).toBe('MS/123/1990');
    // The greeting and the system footer are not rows or headings.
    expect(list.diagnostics.unmappedHeadings).toEqual([]);
    expectAnchored(email, list);
  });

  it('reads an HTML table email (quoted-printable, encoded-word subject) by its profile', () => {
    const email = raw('email-02-html.input.eml');
    const list = parse(email);
    expect(list.listDate).toBe('2026-10-23');
    expect(list.rows.map((row) => [row.hallNo, row.itemNo, row.matchKey])).toEqual([
      ['12', '5', 'WP/12345/2026'],
      ['4', '2', 'CS/10/2026'],
      ['21', '4', 'CRPNPD/44/2026'],
    ]);
    expect(list.rows[1]?.children?.[0]?.matchKey).toBe('APPL/33/2026');
    expect(list.rows[1]?.advocates?.map((a) => a.raw)).toEqual([
      'Mr. R. Fictional (MS/123/1990)',
      'Ms. A. Example',
    ]);
    expect(list.diagnostics.hallsSeen).toEqual(['12', '4', '21']);
    expectAnchored(email, list);
  });

  it('reads pipe-separated table rows in a plain-text body', () => {
    const email = message(
      'Subject: Tagged cases listed on 24.10.2026',
      [
        'Hall | Item | Case | Parties | Advocates',
        'Court No. 7 | 3. | W.A.No.12 of 2026 | Fictional Mills Ltd. vs Made-up Traders | Ms. A. Example',
      ].join('\n'),
    );
    const list = parse(email);
    expect(list.listDate).toBe('2026-10-24');
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ hallNo: '7', itemNo: '3', matchKey: 'WA/12/2026' });
    expectAnchored(email, list);
  });
});

describe('parseAimsEmail: forwarded wrappers', () => {
  it('unwraps a Gmail forward (multipart/alternative, quoted-printable)', () => {
    const email = raw('email-03-gmail-forward.input.eml');
    const list = parse(email);
    expect(list.listDate).toBe('2026-10-23');
    expect(list.rows.map((row) => row.matchKey)).toEqual(['CS/9/2026', 'ARBOP/12/2026']);
    // The forwarder's note and the forwarded header block are skipped.
    expect(list.diagnostics.unmappedHeadings).toEqual([]);
    expectAnchored(email, list);
  });

  it('unwraps an Outlook From:/Sent: block (base64 body)', () => {
    const email = raw('email-04-outlook-forward.input.eml');
    const list = parse(email);
    expect(list.rows.map((row) => [row.hallNo, row.matchKey, row.bench])).toEqual([
      ['9', 'CRLRC/88/2026', 'THE HONOURABLE MS. JUSTICE D. PRETEND'],
      [
        '2',
        'WA/77/2025',
        'THE HONOURABLE MRS. JUSTICE B. EXAMPLE AND THE HONOURABLE MS. JUSTICE D. PRETEND',
      ],
    ]);
    expectAnchored(email, list);
  });

  it('unwraps an Apple Mail forward and takes the date from the inner subject', () => {
    const email = message(
      'Subject: Fwd: Cause List\nDate: Thu, 22 Oct 2026 19:00:00 +0530',
      [
        'Sent from my iPhone',
        '',
        'Begin forwarded message:',
        '',
        'From: AIMS Registry <aims-registry@example.test>',
        'Subject: Cause List for 23.10.2026',
        'Date: 22 October 2026 at 6:05:00 PM IST',
        'To: advocate@example.test',
        '',
        LIST_BODY,
      ].join('\n'),
    );
    const list = parse(email);
    expect(list.listDate).toBe('2026-10-23');
    expect(list.rows.map((row) => row.matchKey)).toEqual(['WP/12345/2026']);
    expectAnchored(email, list);
  });

  it('reads the list from an attached message/rfc822', () => {
    const email = message(
      'Subject: FW: list\nContent-Type: multipart/mixed; boundary="outer"',
      [
        '--outer',
        'Content-Type: text/plain',
        '',
        'See the attached court email.',
        '--outer',
        'Content-Type: message/rfc822',
        'Content-Disposition: attachment; filename="cause-list.eml"',
        '',
        'From: AIMS Registry <aims-registry@example.test>',
        'Subject: Cause List for 25.10.2026',
        'Content-Type: text/plain; charset=utf-8',
        '',
        LIST_BODY,
        '--outer--',
      ].join('\n'),
    );
    const list = parse(email);
    expect(list.listDate).toBe('2026-10-25');
    expect(list.listDateAnchor?.page).toBe(2);
    expect(list.rows.map((row) => [row.matchKey, row.anchor.page])).toEqual([['WP/12345/2026', 2]]);
    expectAnchored(email, list);
  });
});

describe('parseAimsEmail: PDF-only, dates and profiles', () => {
  it('returns the PDF attachment reference for a PDF-only email', () => {
    const list = parse(raw('email-05-pdf-only.input.eml'));
    expect(list).toMatchObject({
      status: 'empty',
      rows: [],
      listDate: '2026-10-23',
      attachments: [
        { ref: '2', fileName: 'cause-list-23.10.2026.pdf', contentType: 'application/pdf' },
      ],
    });
  });

  it('takes listDate from the body when the subject has none', () => {
    const email = message(
      'Subject: Cause list',
      ['The cases below are listed on 26.10.2026.', '', LIST_BODY].join('\n'),
    );
    const list = parse(email);
    expect(list.listDate).toBe('2026-10-26');
    expect(list.listDateAnchor).toEqual({ page: 1, quote: 'on 26.10.2026', rowIndex: 0 });
  });

  it('reads a new template from a profile alone', () => {
    const email = message(
      'Subject: AIMS daily digest - hearing date 27-10-2026',
      ['Digest preface: item 1. is not a case', '=====', LIST_BODY].join('\n'),
    );
    const digest: AimsEmailProfile = {
      id: 'aims-digest-v2',
      subject: '\\bdaily\\s+digest\\b',
      layout: 'lines',
      datePattern: 'hearing\\s+date\\s+(\\S+)',
      bodyStart: '^=+$',
    };
    const without = parse(email);
    expect(without.listDate).toBeNull();
    const withProfile = parse(email, [digest, ...AIMS_EMAIL_PROFILES]);
    expect(withProfile.listDate).toBe('2026-10-27');
    expect(withProfile.listDateAnchor?.quote).toBe('hearing date 27-10-2026');
    expect(withProfile.rows.map((row) => row.matchKey)).toEqual(['WP/12345/2026']);
    expect(withProfile.unparsedRows).toEqual([]);
  });

  it('never throws on malformed input', () => {
    for (const email of [
      '',
      'no headers at all',
      'Content-Type: multipart/mixed; boundary="x"\n\n--x\nContent-Type: text/plain\n\nunterminated',
      'Subject: =?bogus?Q?=ZZ?=\nContent-Transfer-Encoding: base64\n\n!!!not base64!!!',
      new Uint8Array([0xff, 0xfe, 0x00, 0x41]),
    ]) {
      const list = parseAimsEmail(email);
      expect(() => ParsedCauseListSchema.parse(list)).not.toThrow();
    }
  });

  it('is what the adapter returns for an email input', async () => {
    const email = raw('email-01-plain.input.eml');
    const adapter = createMadrasHcAdapter();
    const viaAdapter = await adapter.parseCauseList({
      kind: 'email',
      text: email,
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: adapter.forumCodes[0] ?? '' },
    });
    expect(viaAdapter).toEqual(parseAimsEmail(email));
  });
});
