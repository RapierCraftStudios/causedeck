// Forwarded-wrapper unwrapping (#528): Gmail (`---------- Forwarded message ---------`), Apple Mail
// (`Begin forwarded message:`), Outlook (`From:/Sent:/To:/Subject:` block) and an attached
// `message/rfc822`. Matching uses the original sender, date, subject and body; the user who
// forwarded the message is kept as `submitter`. Nested forwards unwrap to the innermost message.
import type {
  EmailAddress,
  EmailAttachment,
  IntakeEmail,
  ParsedEmail,
  SenderKind,
} from './types.ts';

const MAX_DEPTH = 4;
const MARKER =
  /^(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:?|-{2,}\s*Original Message\s*-{2,}|_{8,})$/i;
const HEADER = /^(From|Sent|Date|To|Cc|Subject):\s*(.*)$/i;

/** `Name <addr@host>`, `"Name" <addr>` or a bare address. */
export function parseAddress(value: string): EmailAddress {
  const bracket = /^\s*"?([^"<]*?)"?\s*<\s*([^<>\s]+)\s*>/.exec(value);
  if (bracket !== null)
    return { name: (bracket[1] ?? '').trim(), address: (bracket[2] ?? '').toLowerCase() };
  const bare = /[^\s<>,;]+@[^\s<>,;]+/.exec(value);
  return { name: '', address: (bare?.[0] ?? '').toLowerCase() };
}

function isoDate(value: string): string | null {
  const time = Date.parse(value.replace(/\s+at\s+/i, ' '));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

interface Inner {
  sender: EmailAddress;
  date: string | null;
  subject: string;
  body: string;
}

/** The first forwarded block in `lines`: its headers and the body after them, or null. */
function textForward(text: string, fallback: Inner): Inner | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    const marker = MARKER.test(line);
    const outlook =
      /^From:/i.test(line) && lines.slice(i + 1, i + 5).some((next) => /^Sent:/i.test(next.trim()));
    if (!marker && !outlook) continue;
    let j = marker ? i + 1 : i;
    while (j < lines.length && (lines[j] ?? '').trim() === '') j += 1;
    const found: Record<string, string> = {};
    for (; j < lines.length; j += 1) {
      const header = HEADER.exec((lines[j] ?? '').trim());
      if (header === null) break;
      found[(header[1] ?? '').toLowerCase()] ??= header[2] ?? '';
    }
    if (found.from === undefined && found.subject === undefined) continue;
    const date = found.date ?? found.sent;
    return {
      sender: found.from === undefined ? fallback.sender : parseAddress(found.from),
      date: date === undefined ? fallback.date : isoDate(date),
      subject: found.subject ?? fallback.subject,
      body: lines.slice(j).join('\n').trim(),
    };
  }
  return null;
}

function collectAttachments(email: ParsedEmail, depth = 0): EmailAttachment[] {
  const nested =
    depth < MAX_DEPTH ? email.forwarded.flatMap((f) => collectAttachments(f, depth + 1)) : [];
  return [...email.attachments, ...nested];
}

/** The original message inside any forwarding wrappers. `senderKind` is the allow-list's. */
export function unwrapForward(
  email: ParsedEmail,
  senderKind: SenderKind | null = null,
): IntakeEmail {
  let inner: Inner = {
    sender: email.from,
    date: email.date,
    subject: email.subject,
    body: email.text,
  };
  let forwarded = false;
  let current = email;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const attached = current.forwarded[0];
    if (attached !== undefined) {
      inner = {
        sender: attached.from,
        date: attached.date,
        subject: attached.subject,
        body: attached.text,
      };
      current = attached;
      forwarded = true;
      continue;
    }
    const next = textForward(inner.body, inner);
    if (next === null) break;
    inner = next;
    forwarded = true;
  }
  return {
    email,
    sender: inner.sender,
    date: inner.date,
    subject: inner.subject,
    body: inner.body,
    submitter: email.from,
    forwarded,
    senderKind,
    attachments: collectAttachments(email),
  };
}
