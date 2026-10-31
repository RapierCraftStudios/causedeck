// eCourts captcha challenge (#1078, part of #492; dark behind `captcha.bulk`). An eCourts search
// page asks for the characters of a captcha image before it answers. This module finds that
// challenge in a page and answers it through an injected solver chain (local OCR first, the paid
// tier only inside its cost cap). Nothing here touches the network: the image read and the form
// submit are ports (`EcourtsChallengeIo`) that the caller wires, and the tests use mocks.
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

/** eCourts captchas are a few alphanumerics. */
export const ECOURTS_CAPTCHA_PATTERN = /^[A-Za-z0-9]{4,8}$/;
export const ecourtsCaptchaShape = (text: string): boolean => ECOURTS_CAPTCHA_PATTERN.test(text);

export interface EcourtsCaptchaChallenge {
  /** The `src` of the captcha image: a path, a URL or a `data:` URI. */
  imageSrc: string;
  /** The text input the answer goes into. */
  answerField: string;
  /** The enclosing form's action (`''` when it posts back to the page) and method. */
  formAction: string;
  method: 'GET' | 'POST';
  /** The other named fields of the form (tokens, hidden state), echoed back with the answer. */
  fields: Record<string, string>;
}

const isElement = (node: Node): node is Element => 'tagName' in node;
const childrenOf = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);
const attr = (node: Element, name: string): string | undefined =>
  node.attrs.find((a) => a.name === name)?.value;
const CAPTCHA = /captcha/i;

function elementsOf(root: Node, tag: string, into: Element[] = []): Element[] {
  for (const child of childrenOf(root)) {
    if (!isElement(child)) continue;
    if (child.tagName === tag) into.push(child);
    elementsOf(child, tag, into);
  }
  return into;
}

/** The captcha challenge of an eCourts page, or `null` when the page has none (total on bad markup). */
export function detectEcourtsCaptcha(html: string): EcourtsCaptchaChallenge | null {
  let document: Node;
  try {
    document = parse(html);
  } catch {
    return null;
  }
  for (const form of elementsOf(document, 'form')) {
    const image = elementsOf(form, 'img').find((img) =>
      [attr(img, 'id'), attr(img, 'src'), attr(img, 'alt'), attr(img, 'class')].some(
        (v) => v !== undefined && CAPTCHA.test(v),
      ),
    );
    const inputs = elementsOf(form, 'input');
    const answer = inputs.find(
      (input) =>
        (attr(input, 'type') ?? 'text') === 'text' &&
        [attr(input, 'id'), attr(input, 'name')].some((v) => v !== undefined && CAPTCHA.test(v)),
    );
    const imageSrc = image === undefined ? undefined : attr(image, 'src');
    const answerField =
      answer === undefined ? undefined : (attr(answer, 'name') ?? attr(answer, 'id'));
    if (imageSrc === undefined || imageSrc.trim() === '' || answerField === undefined) continue;
    const fields: Record<string, string> = {};
    for (const input of inputs) {
      const name = attr(input, 'name');
      if (name === undefined || name === answerField) continue;
      if ((attr(input, 'type') ?? 'text') === 'hidden') fields[name] = attr(input, 'value') ?? '';
    }
    return {
      imageSrc: imageSrc.trim(),
      answerField,
      formAction: (attr(form, 'action') ?? '').trim(),
      method: (attr(form, 'method') ?? 'post').toUpperCase() === 'GET' ? 'GET' : 'POST',
      fields,
    };
  }
  return null;
}

/** Structurally the `SolverChain` of `@causedeck/fetch`. */
export interface CaptchaSolveChain {
  solve(challenge: {
    image: Uint8Array;
    host: string;
    validate?: (text: string) => boolean;
  }): Promise<
    | { solved: true; text: string; tier: 'local' | 'paid'; costDollars: number }
    | { solved: false; reason: 'unsolved' | 'cost_cap_reached' }
  >;
}

export interface EcourtsPageResponse {
  status: number;
  body: string;
  contentType: string;
  etag?: string | null;
  notModified?: boolean;
}

/** The two requests answering a challenge needs; the caller wires them through the governed fetcher. */
export interface EcourtsChallengeIo {
  loadImage(sourceId: string, imageSrc: string, pageUrl: string): Promise<Uint8Array>;
  submit(
    sourceId: string,
    challenge: EcourtsCaptchaChallenge,
    answer: string,
    pageUrl: string,
  ): Promise<EcourtsPageResponse>;
}

/** One solve, for the cost ledger. A refused or failed solve is reported too (`solved: false`). */
export interface EcourtsSolveEvent {
  sourceId: string;
  host: string;
  solved: boolean;
  tier: 'local' | 'paid' | null;
  costDollars: number;
  reason?: 'unsolved' | 'cost_cap_reached' | 'io_failed';
}

export type EcourtsChallengeResult =
  | { kind: 'no_challenge' }
  | { kind: 'solved'; response: EcourtsPageResponse; attempts: number }
  | { kind: 'failed'; reason: 'unsolved' | 'cost_cap_reached' | 'io_failed'; attempts: number };

const DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is;

export interface ResolveChallengeInput {
  sourceId: string;
  pageUrl: string;
  html: string;
  io: EcourtsChallengeIo;
  chain: CaptchaSolveChain;
  /** Attempts at one challenge (a wrong answer serves a fresh challenge). Default 2. */
  maxAttempts?: number;
  onSolve?: (event: EcourtsSolveEvent) => void | Promise<void>;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
};

/** Find the captcha in `html` and answer it through the chain; the page after the answer is the result. */
export async function resolveEcourtsChallenge(
  input: ResolveChallengeInput,
): Promise<EcourtsChallengeResult> {
  const max = Math.max(1, input.maxAttempts ?? 2);
  const host = hostOf(input.pageUrl);
  let html = input.html;
  const first = detectEcourtsCaptcha(html);
  if (first === null) return { kind: 'no_challenge' };
  let challenge = first;
  const report = async (event: EcourtsSolveEvent): Promise<void> => {
    try {
      await input.onSolve?.(event);
    } catch {
      // A ledger failure never fails a read.
    }
  };

  let attempts = 0;
  let last: 'unsolved' | 'cost_cap_reached' | 'io_failed' = 'unsolved';
  while (attempts < max) {
    attempts += 1;
    let image: Uint8Array;
    try {
      const data = DATA_URI.exec(challenge.imageSrc);
      image =
        data?.[1] === undefined
          ? await input.io.loadImage(input.sourceId, challenge.imageSrc, input.pageUrl)
          : new Uint8Array(Buffer.from(data[1], 'base64'));
    } catch {
      await report({
        sourceId: input.sourceId,
        host,
        solved: false,
        tier: null,
        costDollars: 0,
        reason: 'io_failed',
      });
      return { kind: 'failed', reason: 'io_failed', attempts };
    }
    const outcome = await input.chain.solve({ image, host, validate: ecourtsCaptchaShape });
    if (!outcome.solved) {
      last = outcome.reason;
      await report({
        sourceId: input.sourceId,
        host,
        solved: false,
        tier: null,
        costDollars: 0,
        reason: outcome.reason,
      });
      // The chain would fail the same way on the same image; a cap stays reached.
      if (outcome.reason === 'cost_cap_reached') break;
      return { kind: 'failed', reason: last, attempts };
    }
    await report({
      sourceId: input.sourceId,
      host,
      solved: true,
      tier: outcome.tier,
      costDollars: outcome.costDollars,
    });
    let response: EcourtsPageResponse;
    try {
      response = await input.io.submit(input.sourceId, challenge, outcome.text, input.pageUrl);
    } catch {
      return { kind: 'failed', reason: 'io_failed', attempts };
    }
    html = response.body;
    const next = detectEcourtsCaptcha(html);
    if (next === null) return { kind: 'solved', response, attempts };
    challenge = next;
    last = 'unsolved';
  }
  return { kind: 'failed', reason: last, attempts };
}

/** Structurally the `PageSource` of `@causedeck/fetch`. */
export type EcourtsPageSource = (
  sourceId: string,
  url: string,
  validators: { ifNoneMatch?: string },
) => Promise<EcourtsPageResponse>;

/**
 * Wrap a page source so a captcha challenge is answered through the chain. Without `io` the
 * challenge page passes through unchanged (nothing is solved, nothing is spent). An unanswered
 * challenge becomes a 503, which the scheduler counts as an error against the host (its error
 * alarm and backoff then apply).
 */
export function withEcourtsCaptcha(
  pages: EcourtsPageSource,
  options: {
    io?: EcourtsChallengeIo | undefined;
    chain: CaptchaSolveChain;
    maxAttempts?: number;
    onSolve?: (event: EcourtsSolveEvent) => void | Promise<void>;
  },
): EcourtsPageSource {
  return async (sourceId, url, validators) => {
    const page = await pages(sourceId, url, validators);
    if (options.io === undefined || page.notModified === true || !/html/i.test(page.contentType)) {
      return page;
    }
    const result = await resolveEcourtsChallenge({
      sourceId,
      pageUrl: url,
      html: page.body,
      io: options.io,
      chain: options.chain,
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      ...(options.onSolve === undefined ? {} : { onSolve: options.onSolve }),
    });
    if (result.kind === 'no_challenge') return page;
    if (result.kind === 'solved') return result.response;
    return { status: 503, body: '', contentType: page.contentType };
  };
}
