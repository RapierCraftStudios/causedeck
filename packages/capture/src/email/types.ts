// Email intake types (#54 part 1, #528). Everything here is plain data: a parsed message, what a
// parser returns, and the context the caller supplies. No database, no HTTP, no mail transport.
import type { ProposalDraft } from '@causedeck/validators';

export interface EmailAddress {
  name: string;
  /** Lower-case address, or '' when the header had none. */
  address: string;
}

export interface EmailAttachment {
  fileName: string;
  /** Lower-case media type as declared by the sender. */
  contentType: string;
  content: Uint8Array;
}

export type AuthVerdict = 'pass' | 'fail' | 'none';

/** SPF, DKIM and DMARC results read from `Authentication-Results` / `Received-SPF`. */
export interface EmailAuth {
  spf: AuthVerdict;
  dkim: AuthVerdict;
  dmarc: AuthVerdict;
}

/** A message as `email/mime.ts` reads it. Forwarded `message/rfc822` parts are parsed recursively. */
export interface ParsedEmail {
  messageId: string | null;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  /** ISO timestamp from the `Date` header, or null. */
  date: string | null;
  /** Header names lower-case; the first occurrence wins. */
  headers: Readonly<Record<string, string>>;
  /** The plain-text body; the sanitised HTML text when there is no plain part. */
  text: string;
  attachments: EmailAttachment[];
  /** `message/rfc822` attachments, parsed. */
  forwarded: ParsedEmail[];
  auth: EmailAuth;
  /** The message bytes, for parsers that delegate to byte-level readers. */
  raw: Uint8Array;
}

export const SENDER_KINDS = ['court', 'efiling', 'self', 'briefing_counsel'] as const;
export type SenderKind = (typeof SENDER_KINDS)[number];

/** The message a parser matches on: the original, with any forwarding wrapper removed. */
export interface IntakeEmail {
  email: ParsedEmail;
  /** The original sender; the forwarding user's own address when the mail is not a forward. */
  sender: EmailAddress;
  /** The original date (ISO), falling back to the outer message's. */
  date: string | null;
  subject: string;
  body: string;
  /** The forwarding user: who sent the message to the intake address. */
  submitter: EmailAddress;
  forwarded: boolean;
  /** What the allow-list matched the sender as; null when none was evaluated. */
  senderKind: SenderKind | null;
  /** The attachments of the message and of every forwarded message inside it. */
  attachments: EmailAttachment[];
}

export interface KnownMatter {
  matterId: string;
  proceedingId?: string | undefined;
  /** The adapter's normalised case key (`ParsedListRow.matchKey`). */
  matchKey?: string | null | undefined;
  cnr?: string | null | undefined;
  /** ISO list date on which the matter is expected to be listed. */
  expectedOn?: string | null | undefined;
}

export interface IntakeContext {
  /** ISO timestamp the message arrived. */
  receivedAt: string;
  forumCode?: string | undefined;
  /** The lawyer's bar enrolment numbers and name aliases (upper or lower case). */
  enrolmentNumbers: readonly string[];
  aliases: readonly string[];
  matters: readonly KnownMatter[];
  /** Per allow-list entry size caps overriding the capture defaults. */
  sizeCapOverrides?: Readonly<Record<string, number>> | undefined;
}

export type DiagnosticSeverity = 'info' | 'warn' | 'needs_you';

export interface IntakeDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
}

/** Raw material for the capture pipeline: the body as text, or an allowed attachment. */
export interface IntakeCapture {
  source: 'body' | 'attachment';
  fileName: string;
  mime: string;
  content: Uint8Array;
}

export interface IntakeResult {
  captures: IntakeCapture[];
  drafts: ProposalDraft[];
  diagnostics: IntakeDiagnostic[];
}

export interface IntakeParser {
  id: string;
  /** 0..1: how sure the parser is that the message is its kind. */
  match: (email: IntakeEmail) => number;
  parse: (email: IntakeEmail, ctx: IntakeContext) => Promise<IntakeResult> | IntakeResult;
}
