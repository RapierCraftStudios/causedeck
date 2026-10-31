// Solver chain (#492): local first, paid only after a local failure and inside the cost cap.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createLocalSolver,
  createMockOcrEngine,
  createMockPaidSolver,
  createPaidSolver,
  createSolverChain,
  loadLabelledSet,
  measureAccuracy,
  type CaptchaChallenge,
} from '../index.ts';

const img = (s: string): Uint8Array => new TextEncoder().encode(s);
const challenge = (s: string, host = 'h.example.in'): CaptchaChallenge => ({ image: img(s), host });

function chain(opts: { cap: number; known?: string[] }) {
  const ocr = createMockOcrEngine(
    (opts.known ?? []).map((k) => [img(k), k.toUpperCase()] as const),
  );
  const paid = createMockPaidSolver({ costDollars: 0.01 });
  let now = Date.parse('2026-10-31T10:00:00Z');
  const c = createSolverChain({
    local: createLocalSolver(ocr),
    paid,
    dailyCostCapDollars: opts.cap,
    expectedPaidCostDollars: 0.01,
    now: () => now,
  });
  return { c, ocr, paid, advance: (ms: number) => (now += ms) };
}

describe('solver chain', () => {
  it('a local success never touches the paid tier', async () => {
    const { c, paid } = chain({ cap: 1, known: ['a'] });
    expect(await c.solve(challenge('a'))).toEqual({
      solved: true,
      text: 'A',
      tier: 'local',
      costDollars: 0,
    });
    expect(paid.calls).toBe(0);
  });

  it('goes to the paid tier only after a local failure, and records the spend', async () => {
    const { c, paid } = chain({ cap: 1 });
    const out = await c.solve(challenge('unknown'));
    expect(out).toMatchObject({ solved: true, tier: 'paid', costDollars: 0.01 });
    expect(paid.calls).toBe(1);
    expect(c.spentToday('h.example.in')).toBeCloseTo(0.01);
  });

  it('stops spending at the cost cap, per host, and resets the next UTC day', async () => {
    const { c, paid, advance } = chain({ cap: 0.02 });
    expect((await c.solve(challenge('x1'))).solved).toBe(true);
    expect((await c.solve(challenge('x2'))).solved).toBe(true);
    expect(await c.solve(challenge('x3'))).toEqual({ solved: false, reason: 'cost_cap_reached' });
    expect(paid.calls).toBe(2);
    expect((await c.solve(challenge('x4', 'other.example.in'))).solved).toBe(true);
    advance(24 * 3_600_000);
    expect((await c.solve(challenge('x5'))).solved).toBe(true);
  });

  it('local rejects low confidence, an engine error and a failed shape check', async () => {
    const low = createLocalSolver({
      recognize: () => Promise.resolve({ text: 'ab', confidence: 0.1 }),
    });
    expect(await low.solve(challenge('z'))).toBeNull();
    const boom = createLocalSolver({ recognize: () => Promise.reject(new Error('x')) });
    expect(await boom.solve(challenge('z'))).toBeNull();
    const shaped = createLocalSolver({
      recognize: () => Promise.resolve({ text: 'ab', confidence: 0.99 }),
    });
    expect(await shaped.solve({ ...challenge('z'), validate: (t) => t.length === 5 })).toBeNull();
  });

  it('the paid adapter is the mock while no key is set, and needs a client once one is', async () => {
    const mock = createPaidSolver({});
    expect(await mock.solve(challenge('z'))).toMatchObject({ text: 'MOCK00' });
    expect(() => createPaidSolver({ apiKey: 'k' })).toThrow();
    const real = createPaidSolver({
      apiKey: 'k',
      client: { solveImage: () => Promise.resolve({ text: 'REAL', costDollars: 0.02 }) },
    });
    expect(await real.solve(challenge('z'))).toEqual({ text: 'REAL', costDollars: 0.02 });
  });
});

describe('accuracy harness', () => {
  it('measures first-try accuracy over the synthetic sample directory', async () => {
    const dir = path.resolve(import.meta.dirname, '../../fixtures/synthetic-captchas');
    const samples = loadLabelledSet(dir);
    expect(samples).toHaveLength(9);
    const solver = createLocalSolver({
      recognize(image) {
        const [header, rendered] = Buffer.from(image).toString('utf8').split('\n');
        return Promise.resolve(
          header === 'SYNTHETIC-CAPTCHA' && rendered ? { text: rendered, confidence: 0.9 } : null,
        );
      },
    });
    const report = await measureAccuracy(samples, solver);
    expect(report).toMatchObject({ total: 9, correct: 6, unreadable: 1 });
    expect(report.wrong.map((w) => w.name)).toEqual(['s07.captcha', 's08.captcha']);
    expect(report.firstTryAccuracy).toBeCloseTo(6 / 9);
    expect((await measureAccuracy([], solver)).firstTryAccuracy).toBe(0);
  });
});
