// AIMS cause-list email parser (#396, part 2 of #36) for email intake (#54). The Registry's AIMS
// push (Notification 230/2026) reaches the product only as a message the lawyer forwarded, so the
// list may sit inside a forward: a Gmail `---------- Forwarded message ---------` block, an Outlook
// `From:/Sent:/To:/Subject:` block, an Apple Mail `Begin forwarded message:` block, or an attached
// `message/rfc822`. The innermost message is the court's; its subject picks the profile
// (`config/email-profiles.ts`), so a new template is config only. Bodies are read as list lines
// (`lines`) or table rows (`table`); a `pdf_only` email returns its PDF attachment reference for the
// caller's PDF path. `listDate` comes from the profile's date pattern in the subject, then the body,
// anchored on that phrase. Pure and total: a malformed message gives `status: failed`, never an
// exception.
import type { AdapterConfig } from '../config/schema.ts';
import {
  emailAttachments,
  emailMessages,
  layoutFromEmail,
  readEmail,
  type EmailPart,
} from '../layout/email.ts';
import { normaliseDate } from '../normalise/date.ts';
import type { Anchor, ListAttachment, ParsedCauseList } from '../types.ts';

import {
  MADRAS_HC_ADAPTER_ID,
  MADRAS_HC_CONFIG,
  MADRAS_HC_FORUM_CODES,
  MADRAS_HC_VERSION,
} from './config/adapter-config.ts';
import {
  AIMS_EMAIL_PROFILES,
  DEFAULT_EMAIL_DATE_PATTERN,
  type AimsEmailProfile,
} from './config/email-profiles.ts';
import { parseListLines, type ListPage } from './parse-cause-list.ts';

export interface ParseAimsEmailOptions {
  /** Defaults to the Principal Seat's original side. */
  forumCode?: string;
  version?: string;
  config?: AdapterConfig;
  /** Defaults to `AIMS_EMAIL_PROFILES`. */
  profiles?: readonly AimsEmailProfile[];
}

/** A forwarded-message marker line (Gmail, Apple Mail, Outlook's rule, `Original Message`). */
const FORWARD_MARKER =
  /^(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:?|-{2,}\s*Original Message\s*-{2,}|_{8,})$/i;
const HEADER_LINE = /^(From|Sent|Date|To|Cc|Subject):\s*(.*)$/i;
/** `Subject:` and `Date:` lines and a blank line precede the body on every email page. */
const BODY_FIRST_LINE = 3;

interface Body {
  from: number;
  subject: string;
}

/** Skips forwarded wrappers: the list starts after the last forwarded header block. */
function unwrapForwards(lines: readonly string[], subject: string): Body {
  let body: Body = { from: BODY_FIRST_LINE, subject };
  for (let i = BODY_FIRST_LINE; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    const marker = FORWARD_MARKER.test(line);
    const outlook =
      /^From:/i.test(line) && lines.slice(i + 1, i + 5).some((next) => /^Sent:/i.test(next.trim()));
    if (!marker && !outlook) continue;
    let j = marker ? i + 1 : i;
    while (j < lines.length && (lines[j] ?? '').trim() === '') j += 1;
    let inner = body.subject;
    let headers = 0;
    for (; j < lines.length; j += 1) {
      const header = HEADER_LINE.exec((lines[j] ?? '').trim());
      if (header === null) break;
      headers += 1;
      if (header[1]?.toLowerCase() === 'subject') inner = header[2] ?? '';
    }
    if (headers === 0) continue;
    body = { from: j, subject: inner };
    i = j - 1;
  }
  return body;
}

function lineIndex(lines: readonly string[], pattern: string | undefined, from: number): number {
  if (pattern === undefined) return -1;
  const regex = new RegExp(pattern, 'i');
  for (let i = from; i < lines.length; i += 1) if (regex.test((lines[i] ?? '').trim())) return i;
  return -1;
}

const isPdf = (part: EmailPart) =>
  part.contentType === 'application/pdf' || /\.pdf$/i.test(part.fileName ?? '');

function failed(forumCode: string, version: string): ParsedCauseList {
  return {
    adapterId: MADRAS_HC_ADAPTER_ID,
    adapterVersion: version,
    forumCode,
    listDate: null,
    listType: null,
    source: 'email',
    status: 'failed',
    halls: [],
    rows: [],
    unparsedRows: [],
    diagnostics: {
      unmappedHeadings: [],
      unknownCaseTypes: [],
      rowsSkippedNoAnchor: 0,
      hallsSeen: [],
      hallsUnreadable: [],
    },
  };
}

/** Parses a forwarded AIMS cause-list email (the raw RFC 5322 message). */
export function parseAimsEmail(
  email: string | Uint8Array,
  options: ParseAimsEmailOptions = {},
): ParsedCauseList {
  const forumCode = options.forumCode ?? MADRAS_HC_FORUM_CODES[0];
  const version = options.version ?? MADRAS_HC_VERSION;
  const config = options.config ?? MADRAS_HC_CONFIG;
  const profiles = options.profiles ?? AIMS_EMAIL_PROFILES;
  try {
    const message = readEmail(email);
    const messages = emailMessages(message);
    const layout = layoutFromEmail(email);
    // The court's message is the innermost one attached; a plain forward is one page.
    const index = messages.length - 1;
    const page = layout.pages[index];
    const listMessage = messages[index];
    if (page === undefined || listMessage === undefined) return failed(forumCode, version);
    const lines = page.text.split('\n');
    const body = unwrapForwards(lines, listMessage.subject);
    const profile =
      profiles.find((candidate) => new RegExp(candidate.subject, 'i').test(body.subject)) ??
      profiles.find((candidate) => candidate.layout !== 'pdf_only');

    let from = body.from;
    const start = lineIndex(lines, profile?.bodyStart, from);
    if (start >= 0) from = start + 1;
    const end = lineIndex(lines, profile?.bodyEnd, from);
    const to = end >= 0 ? end : lines.length;

    const pages: ListPage[] = layout.pages.map(({ page: pageNo, text }) => ({
      page: pageNo,
      text,
      items: [],
    }));
    const datePattern = new RegExp(profile?.datePattern ?? DEFAULT_EMAIL_DATE_PATTERN, 'i');
    let listDate: { date: string; anchor: Anchor } | null = null;
    for (const candidate of [body.subject, ...lines.slice(from, to)]) {
      const match = datePattern.exec(candidate);
      const date =
        match === null ? null : normaliseDate(match[1] ?? '', { pivot: config.twoDigitYearPivot });
      if (match === null || date === null) continue;
      const quote = match[0];
      const at = pages.find((candidatePage) => candidatePage.text.includes(quote));
      if (at === undefined) continue;
      listDate = { date, anchor: { page: at.page, quote, rowIndex: 0 } };
      break;
    }

    const attachments: ListAttachment[] = emailAttachments(message)
      .filter(isPdf)
      .map((part) => ({
        ref: part.ref,
        ...(part.fileName === undefined ? {} : { fileName: part.fileName }),
        contentType: part.contentType,
      }));
    const pdfOnly = profile?.layout === 'pdf_only';
    const listPages = pages.map((candidate) =>
      candidate.page === page.page
        ? { ...candidate, from: pdfOnly ? 0 : from, to: pdfOnly ? 0 : to }
        : { ...candidate, from: 0, to: 0 },
    );
    return parseListLines(listPages, {
      config,
      version,
      forumCode,
      source: 'email',
      ...(profile?.columns === undefined ? {} : { columns: profile.columns }),
      listDate,
      ...(attachments.length === 0 ? {} : { attachments }),
    });
  } catch {
    return failed(forumCode, version);
  }
}
