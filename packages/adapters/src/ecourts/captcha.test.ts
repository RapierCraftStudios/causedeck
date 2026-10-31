// eCourts captcha challenge (#1078): detection in a page and answering through an injected solver
// chain. Mocks only: the image read, the submit and the chain are ports.
import { describe, expect, it, vi } from 'vitest';

import {
  detectEcourtsCaptcha,
  resolveEcourtsChallenge,
  withEcourtsCaptcha,
  type CaptchaSolveChain,
  type EcourtsChallengeIo,
  type EcourtsPageResponse,
} from './index.ts';

const CHALLENGE = `<form action="/cases/search" method="POST">
  <img id="captcha_image" src="/securimage/show.png"><input type="text" id="captcha" name="captcha_code">
  <input type="hidden" name="app_token" value="tok"><input name="free" value="x"></form>`;
const RESULT = '<table><tr><td>Case list</td></tr></table>';
const ok = (body: string): EcourtsPageResponse => ({ status: 200, body, contentType: 'text/html' });

const chainOf = (...outcomes: Awaited<ReturnType<CaptchaSolveChain['solve']>>[]) => {
  const queue = [...outcomes];
  return {
    solve: vi.fn<CaptchaSolveChain['solve']>(() =>
      Promise.resolve(queue.shift() ?? { solved: false as const, reason: 'unsolved' as const }),
    ),
  };
};
const solved = (text: string, tier: 'local' | 'paid' = 'local') =>
  ({ solved: true, text, tier, costDollars: tier === 'paid' ? 0.003 : 0 }) as const;

describe('detectEcourtsCaptcha', () => {
  it('finds the image, the answer field and the hidden state', () => {
    expect(detectEcourtsCaptcha(CHALLENGE)).toEqual({
      imageSrc: '/securimage/show.png',
      answerField: 'captcha_code',
      formAction: '/cases/search',
      method: 'POST',
      fields: { app_token: 'tok' },
    });
  });

  it('is null for a page without a captcha, and total on bad markup', () => {
    expect(detectEcourtsCaptcha(RESULT)).toBeNull();
    expect(detectEcourtsCaptcha('<form><img src="/logo.png"><input name="q"></form>')).toBeNull();
    expect(detectEcourtsCaptcha('')).toBeNull();
    expect(detectEcourtsCaptcha('<<<form <img captcha')).toBeNull();
  });
});

describe('resolveEcourtsChallenge', () => {
  const io = (next: EcourtsPageResponse[]): EcourtsChallengeIo & { answers: string[] } => {
    const answers: string[] = [];
    return {
      answers,
      loadImage: () => Promise.resolve(new Uint8Array([1])),
      submit: (_s, _c, answer) => {
        answers.push(answer);
        return Promise.resolve(next.shift() ?? ok(CHALLENGE));
      },
    };
  };

  it('answers once and returns the page that follows', async () => {
    const port = io([ok(RESULT)]);
    const events: unknown[] = [];
    const out = await resolveEcourtsChallenge({
      sourceId: 's',
      pageUrl: 'https://c.example.in/x',
      html: CHALLENGE,
      io: port,
      chain: chainOf(solved('ab12c', 'paid')),
      onSolve: (e) => void events.push(e),
    });
    expect(out).toMatchObject({ kind: 'solved', attempts: 1 });
    expect(port.answers).toEqual(['ab12c']);
    expect(events).toMatchObject([
      { solved: true, tier: 'paid', costDollars: 0.003, host: 'c.example.in' },
    ]);
  });

  it('retries a wrong answer on the fresh challenge, up to the attempt limit', async () => {
    const port = io([ok(CHALLENGE), ok(RESULT)]);
    const out = await resolveEcourtsChallenge({
      sourceId: 's',
      pageUrl: 'https://c.example.in/x',
      html: CHALLENGE,
      io: port,
      chain: chainOf(solved('aaaa1'), solved('bbbb2')),
    });
    expect(out).toMatchObject({ kind: 'solved', attempts: 2 });
    const limited = await resolveEcourtsChallenge({
      sourceId: 's',
      pageUrl: 'https://c.example.in/x',
      html: CHALLENGE,
      io: io([]),
      chain: chainOf(solved('aaaa1'), solved('bbbb2'), solved('cccc3')),
      maxAttempts: 2,
    });
    expect(limited).toMatchObject({ kind: 'failed', attempts: 2 });
  });

  it('reads a data URI image without the image port and stops at the cost cap', async () => {
    const loadImage = vi.fn();
    const page = CHALLENGE.replace('/securimage/show.png', 'data:image/png;base64,AQID');
    const chain = chainOf({ solved: false, reason: 'cost_cap_reached' });
    const out = await resolveEcourtsChallenge({
      sourceId: 's',
      pageUrl: 'https://c.example.in/x',
      html: page,
      io: { ...io([]), loadImage },
      chain,
    });
    expect(out).toEqual({ kind: 'failed', reason: 'cost_cap_reached', attempts: 1 });
    expect(loadImage).not.toHaveBeenCalled();
    expect(chain.solve.mock.calls[0]?.[0].image).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('is no_challenge for a plain page and reports an image read failure', async () => {
    const plain = await resolveEcourtsChallenge({
      sourceId: 's',
      pageUrl: 'https://c.example.in/x',
      html: RESULT,
      io: io([]),
      chain: chainOf(),
    });
    expect(plain).toEqual({ kind: 'no_challenge' });
    const failed = await resolveEcourtsChallenge({
      sourceId: 's',
      pageUrl: 'https://c.example.in/x',
      html: CHALLENGE,
      io: { ...io([]), loadImage: () => Promise.reject(new Error('down')) },
      chain: chainOf(),
    });
    expect(failed).toMatchObject({ kind: 'failed', reason: 'io_failed' });
  });
});

describe('withEcourtsCaptcha', () => {
  const base = (body: string) => () => Promise.resolve(ok(body));
  const port: EcourtsChallengeIo = {
    loadImage: () => Promise.resolve(new Uint8Array([1])),
    submit: () => Promise.resolve(ok(RESULT)),
  };

  it('passes plain pages through, answers challenges and turns a failure into a 503', async () => {
    const chain = chainOf(solved('abcd1'));
    expect(
      (
        await withEcourtsCaptcha(base(RESULT), { io: port, chain })(
          's',
          'https://c.example.in/',
          {},
        )
      ).body,
    ).toBe(RESULT);
    expect(chain.solve).not.toHaveBeenCalled();
    expect(
      (
        await withEcourtsCaptcha(base(CHALLENGE), { io: port, chain })(
          's',
          'https://c.example.in/',
          {},
        )
      ).body,
    ).toBe(RESULT);
    const failing = await withEcourtsCaptcha(base(CHALLENGE), { io: port, chain: chainOf() })(
      's',
      'https://c.example.in/',
      {},
    );
    expect(failing.status).toBe(503);
  });

  it('leaves a challenge page untouched, with nothing spent, when no transport is wired', async () => {
    const chain = chainOf(solved('abcd1'));
    const out = await withEcourtsCaptcha(base(CHALLENGE), { chain })(
      's',
      'https://c.example.in/',
      {},
    );
    expect(out.body).toBe(CHALLENGE);
    expect(chain.solve).not.toHaveBeenCalled();
  });
});
