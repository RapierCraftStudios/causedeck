// The solver chain (#492): a local solver first (the in-house OCR port), the paid tier only after
// a local failure and only inside a cost cap. The OCR engine and the paid client are injected; the
// mock implementations keep every test and the dark build off the network and off any key.

export type SolverTier = 'local' | 'paid';

export interface CaptchaChallenge {
  /** The challenge image bytes. */
  image: Uint8Array;
  /** The host the challenge came from, for the cost ledger and logs. */
  host: string;
  /** Optional shape check of an answer (eCourts captchas are a few alphanumerics). */
  validate?: (text: string) => boolean;
}

export interface SolveAttempt {
  text: string;
  /** 0..1 when the engine reports one. */
  confidence?: number;
  costDollars: number;
}

/** A solver returns an answer, or `null` when it cannot (never throws for "could not read"). */
export interface CaptchaSolver {
  readonly tier: SolverTier;
  solve(challenge: CaptchaChallenge): Promise<SolveAttempt | null>;
}

/** The in-house OCR engine port; the real implementation is a follow-up behind this interface. */
export interface OcrEngine {
  recognize(image: Uint8Array): Promise<{ text: string; confidence: number } | null>;
}

export const DEFAULT_MIN_CONFIDENCE = 0.6;

export function createLocalSolver(
  engine: OcrEngine,
  options: { minConfidence?: number } = {},
): CaptchaSolver {
  const min = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  return {
    tier: 'local',
    async solve(challenge) {
      let read;
      try {
        read = await engine.recognize(challenge.image);
      } catch {
        return null;
      }
      if (read === null) return null;
      const text = read.text.trim();
      if (text === '' || read.confidence < min) return null;
      if (challenge.validate !== undefined && !challenge.validate(text)) return null;
      return { text, confidence: read.confidence, costDollars: 0 };
    },
  };
}

const keyOf = (image: Uint8Array): string => Buffer.from(image).toString('base64');

/** A deterministic OCR engine: answers from (image, text) pairs; unknown images are unreadable. */
export function createMockOcrEngine(
  answers: readonly (readonly [Uint8Array, string])[] = [],
): OcrEngine & { calls: number } {
  const table = new Map(answers.map(([image, text]) => [keyOf(image), text]));
  const engine = {
    calls: 0,
    recognize(image: Uint8Array) {
      engine.calls += 1;
      const text = table.get(keyOf(image));
      return Promise.resolve(text === undefined ? null : { text, confidence: 0.95 });
    },
  };
  return engine;
}

/** What a paid solving service offers; the AlterLab `captcha` adapter implements it later. */
export interface PaidSolverClient {
  solveImage(image: Uint8Array): Promise<{ text: string; costDollars: number } | null>;
}

export const DEFAULT_PAID_COST_PER_SOLVE_DOLLARS = 0.003;

/** A paid-tier mock: answers from a table (or a fixed answer), at a fixed per-solve cost. */
export function createMockPaidSolver(
  options: { answer?: (image: Uint8Array) => string | null; costDollars?: number } = {},
): CaptchaSolver & { calls: number } {
  const solver = {
    tier: 'paid' as const,
    calls: 0,
    solve(challenge: CaptchaChallenge) {
      solver.calls += 1;
      const text = options.answer === undefined ? 'MOCK00' : options.answer(challenge.image);
      return Promise.resolve(
        text === null
          ? null
          : { text, costDollars: options.costDollars ?? DEFAULT_PAID_COST_PER_SOLVE_DOLLARS },
      );
    },
  };
  return solver;
}

/**
 * The paid adapter. With no API key it is the mock (nothing is spent, nothing leaves the host);
 * with a key a client must be supplied, because this layer ships without a real provider wired.
 */
export function createPaidSolver(options: {
  apiKey?: string | undefined;
  client?: PaidSolverClient | undefined;
}): CaptchaSolver {
  if (options.apiKey === undefined || options.apiKey === '') return createMockPaidSolver();
  const { client } = options;
  if (client === undefined) throw new Error('A paid captcha client is required when a key is set');
  return {
    tier: 'paid',
    async solve(challenge) {
      const out = await client.solveImage(challenge.image);
      if (out === null) return null;
      if (challenge.validate !== undefined && !challenge.validate(out.text)) return null;
      return { text: out.text, costDollars: out.costDollars };
    },
  };
}

export type SolveOutcome =
  | { solved: true; text: string; tier: SolverTier; costDollars: number }
  | { solved: false; reason: 'unsolved' | 'cost_cap_reached' };

export interface SolverChain {
  solve(challenge: CaptchaChallenge): Promise<SolveOutcome>;
  /** Dollars spent on the paid tier in the current UTC day for `host`. */
  spentToday(host: string): number;
}

export interface SolverChainOptions {
  local: CaptchaSolver;
  paid: CaptchaSolver;
  /** Paid spend allowed per host per UTC day; the paid tier is skipped once the next solve could pass it. */
  dailyCostCapDollars: number;
  /** What one paid solve is expected to cost; checked before the call so the cap is never overshot. */
  expectedPaidCostDollars?: number;
  now: () => number;
}

export function createSolverChain(options: SolverChainOptions): SolverChain {
  const expected = options.expectedPaidCostDollars ?? DEFAULT_PAID_COST_PER_SOLVE_DOLLARS;
  const spend = new Map<string, number>();
  const dayOf = (): string => new Date(options.now()).toISOString().slice(0, 10);
  const key = (host: string): string => `${dayOf()}|${host}`;

  return {
    spentToday: (host) => spend.get(key(host)) ?? 0,
    async solve(challenge) {
      const local = await options.local.solve(challenge).catch(() => null);
      if (local !== null) {
        return { solved: true, text: local.text, tier: 'local', costDollars: local.costDollars };
      }
      const k = key(challenge.host);
      if ((spend.get(k) ?? 0) + expected > options.dailyCostCapDollars) {
        return { solved: false, reason: 'cost_cap_reached' };
      }
      let paid: SolveAttempt | null = null;
      try {
        paid = await options.paid.solve(challenge);
      } catch {
        paid = null;
      }
      if (paid === null) return { solved: false, reason: 'unsolved' };
      spend.set(k, (spend.get(k) ?? 0) + paid.costDollars);
      return { solved: true, text: paid.text, tier: 'paid', costDollars: paid.costDollars };
    },
  };
}
