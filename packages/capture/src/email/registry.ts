// The intake parser registry and pipeline (#528). A message is read, dropped if it is a bounce or an
// auto-reply, checked against the sender allow-list (a failure quarantines it with no parsing and no
// AI), unwrapped from any forward, screened for instruction-like text, then handed to the parser
// with the highest score (>= 0.6; ties go to registry order; `generic` always scores 0.1 and is the
// fallback). Email text is data: it is never executed or followed. A new parser is one file under
// `parsers/` plus one line in `INTAKE_PARSERS`.
import { evaluateSender, type SenderPattern, type SenderVerdict } from './allow-list.ts';
import { parseEmail } from './mime.ts';
import { aimsCauseListParser } from './parsers/aims-cause-list.ts';
import { briefingCounselParser } from './parsers/briefing-counsel.ts';
import { efilingAckParser } from './parsers/efiling-ack.ts';
import { genericParser } from './parsers/generic.ts';
import { registryMemoParser } from './parsers/registry-memo.ts';
import type {
  IntakeContext,
  IntakeDiagnostic,
  IntakeEmail,
  IntakeParser,
  IntakeResult,
  ParsedEmail,
} from './types.ts';
import { unwrapForward } from './unwrap.ts';

/** A parser must score at least this to be chosen over `generic`. */
export const MATCH_THRESHOLD = 0.6;

/** Registry order breaks score ties; `generic` is last and is the fallback. */
export const INTAKE_PARSERS: readonly IntakeParser[] = [
  aimsCauseListParser,
  registryMemoParser,
  efilingAckParser,
  briefingCounselParser,
  genericParser,
];

export interface ParserChoice {
  parser: IntakeParser;
  score: number;
}

export function selectParser(
  email: IntakeEmail,
  parsers: readonly IntakeParser[] = INTAKE_PARSERS,
): ParserChoice {
  let best: ParserChoice | null = null;
  for (const parser of parsers) {
    const score = Math.min(1, Math.max(0, parser.match(email)));
    if (score >= MATCH_THRESHOLD && (best === null || score > best.score)) best = { parser, score };
  }
  if (best !== null) return best;
  const fallback = parsers.find((parser) => parser.id === 'generic') ?? genericParser;
  return { parser: fallback, score: fallback.match(email) };
}

export type DropReason = 'bounce' | 'auto_reply';

const BOUNCE_FROM = /^(?:mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT =
  /^(?:undeliverable|delivery status notification|mail delivery failed|returned mail|failure notice)/i;
const AUTO_SUBJECT = /^(?:automatic reply|auto(?:matic)?[- ]?reply|out of office|vacation)\b/i;

/** Bounce, vacation and out-of-office mail is dropped before anything else reads it. */
export function dropReason(email: ParsedEmail): DropReason | null {
  const { headers, from, subject } = email;
  if (
    BOUNCE_FROM.test(from.address) ||
    BOUNCE_SUBJECT.test(subject) ||
    (headers['return-path'] ?? '').replace(/\s/g, '') === '<>' ||
    /multipart\/report/i.test(headers['content-type'] ?? '')
  ) {
    return 'bounce';
  }
  const autoSubmitted = (headers['auto-submitted'] ?? 'no').trim().toLowerCase();
  if (
    (autoSubmitted !== 'no' && autoSubmitted !== '') ||
    /^(?:auto_reply|auto-reply|junk|bulk)$/i.test((headers.precedence ?? '').trim()) ||
    headers['x-autoreply'] !== undefined ||
    headers['x-autorespond'] !== undefined ||
    AUTO_SUBJECT.test(subject)
  ) {
    return 'auto_reply';
  }
  return null;
}

const INJECTION: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,30}\b(?:instructions?|prompts?|rules)\b/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|chatgpt|language model|system)\b/i,
  /\b(?:reveal|print|show|send)\b[^.\n]{0,40}\b(?:prompt|api\s*key|password|secret|credentials)\b/i,
  /\bdo\s+not\s+(?:tell|inform|alert)\s+the\s+(?:user|lawyer|advocate)\b/i,
  /<\s*\/?\s*(?:system|assistant|instructions?)\s*>/i,
];

/** Instruction-like text aimed at a model. It is only flagged: the text stays data. */
export function detectInjection(text: string): boolean {
  return INJECTION.some((pattern) => pattern.test(text));
}

export type IntakeOutcome =
  | { status: 'dropped'; reason: DropReason }
  | { status: 'quarantined'; verdict: Extract<SenderVerdict, { verdict: 'quarantine' }> }
  | {
      status: 'parsed';
      parserId: string;
      score: number;
      sender: SenderVerdict;
      intake: IntakeEmail;
      result: IntakeResult;
    };

export interface IntakeOptions {
  allowList: readonly SenderPattern[];
  context: IntakeContext;
  parsers?: readonly IntakeParser[] | undefined;
}

/** Runs one raw message through the whole pipeline. */
export async function processIntake(
  raw: string | Uint8Array,
  options: IntakeOptions,
): Promise<IntakeOutcome> {
  const email = await parseEmail(raw);
  const dropped = dropReason(email);
  if (dropped !== null) return { status: 'dropped', reason: dropped };

  const sender = evaluateSender(email, options.allowList);
  if (sender.verdict === 'quarantine') return { status: 'quarantined', verdict: sender };

  const intake = unwrapForward(email, sender.kind);
  const choice = selectParser(intake, options.parsers);
  const result = await choice.parser.parse(intake, options.context);
  const flags: IntakeDiagnostic[] = detectInjection(`${intake.subject}\n${intake.body}`)
    ? [
        {
          code: 'instruction_like',
          severity: 'needs_you',
          message: 'the message contains instruction-like text; it was treated as data only',
        },
      ]
    : [];
  return {
    status: 'parsed',
    parserId: choice.parser.id,
    score: choice.score,
    sender,
    intake,
    result: { ...result, diagnostics: [...flags, ...result.diagnostics] },
  };
}
