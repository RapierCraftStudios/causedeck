import { Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_KEYS,
  contentPlaceholder,
  redactDeep,
  scrubSecretsInString,
  SECRET_KEY_PATTERN,
} from '../redact.ts';
import { captureLogger } from './helpers.ts';

describe('redaction', () => {
  it('never logs seeded privileged strings under title, filename, email, body or token', () => {
    const { logger, raw } = captureLogger();
    const seeded = [
      'Sharma v. State brief',
      'affidavit-final.pdf',
      'client@example.com',
      'secret-body',
      'tok-seeded',
    ];

    logger.info(
      {
        title: seeded[0],
        doc: { filename: seeded[1], email: seeded[2] },
        body: seeded[3],
        token: seeded[4],
      },
      'event',
    );

    for (const value of seeded) expect(raw()).not.toContain(value);
  });

  it('redacts password, authorization and cookie', () => {
    const { logger, lines, raw } = captureLogger();

    logger.info({ password: 'x', authorization: 'Bearer y', cookie: 'z' }, 'login');

    const [line] = lines();
    expect(line).toMatchObject({
      password: '[REDACTED]',
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
    });
    expect(raw()).not.toContain('Bearer y');
  });

  it('replaces matter content with its length only', () => {
    const { logger, lines, raw } = captureLogger();

    logger.info({ content: 'privileged text' });

    expect(lines()[0]?.content).toBe('[CONTENT_REDACTED:15]');
    expect(raw()).not.toContain('privileged text');
  });

  it('covers every content key and nested secret keys', () => {
    const input = {
      a: { text: 'aa', body: { nested: 'bb' }, quote: 'cc', prompt: 'dd', memoryValue: 'ee' },
      list: [{ apiKey: 'k1' }, { 'x-api-key': 'k2' }, { refresh_token: 't1' }, { userOtp: '1234' }],
      env: new Secret('s3cr3t'),
    };

    const out = JSON.stringify(redactDeep(input));

    for (const secret of ['aa', 'bb', 'cc', 'dd', 'ee', 'k1', 'k2', 't1', '1234', 's3cr3t']) {
      expect(out).not.toContain(`"${secret}"`);
    }
    expect(out).toContain('[CONTENT_REDACTED:2]');
  });

  it('does not mutate its input and survives cycles', () => {
    const input: Record<string, unknown> = { password: 'p', keep: 1 };
    input.self = input;

    const out = redactDeep(input) as Record<string, unknown>;

    expect(input.password).toBe('p');
    expect(out.password).toBe('[REDACTED]');
    expect(out.self).toBe('[Circular]');
  });

  it('scrubs credentials embedded in strings', () => {
    const scrubbed = scrubSecretsInString(
      'auth failed: Bearer abc.def token=xyz postgres://u:pw@db/x eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl',
    );

    for (const leaked of ['abc.def', 'xyz', ':pw@', 'eyJzdWIiOiIx']) {
      expect(scrubbed).not.toContain(leaked);
    }
  });

  describe('property: no raw content or secret survives in output', () => {
    // Deterministic PRNG so failures reproduce.
    function rng(seed: number) {
      let s = seed;
      return () => {
        s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
        return s / 2_147_483_648;
      };
    }
    const secretKeys = ['password', 'authorization', 'cookie', 'apiKey', 'otp', 'clientSecret'];
    const plainKeys = ['id', 'meta', 'items', 'child', 'name'];

    function generate(rand: () => number, depth: number, sensitive: string[]): unknown {
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
      if (depth > 4 || rand() < 0.2) return Math.floor(rand() * 100);
      if (rand() < 0.3) {
        return Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
          generate(rand, depth + 1, sensitive),
        );
      }
      const obj: Record<string, unknown> = {};
      const fields = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < fields; i++) {
        const roll = rand();
        if (roll < 0.25) {
          const marker = `SENSITIVE_${String(sensitive.length)}_${String(Math.floor(rand() * 1e9))}`;
          sensitive.push(marker);
          obj[pick(CONTENT_KEYS)] = rand() < 0.5 ? marker : { deep: [marker] };
        } else if (roll < 0.45) {
          const marker = `SECRET_${String(sensitive.length)}_${String(Math.floor(rand() * 1e9))}`;
          sensitive.push(marker);
          obj[pick(secretKeys)] = marker;
        } else {
          obj[pick(plainKeys)] = generate(rand, depth + 1, sensitive);
        }
      }
      return obj;
    }

    it.each(Array.from({ length: 200 }, (_, i) => i))('seed %i', (seed) => {
      const rand = rng(seed + 1);
      const sensitive: string[] = [];
      const payload = generate(rand, 0, sensitive);
      const { logger, raw } = captureLogger();

      logger.info({ payload, list: [payload] }, 'property');

      const output = raw();
      for (const marker of sensitive) expect(output).not.toContain(marker);
    });
  });

  it('exposes the documented secret-key pattern', () => {
    expect(SECRET_KEY_PATTERN.source).toBe(
      'password|secret|token|authorization|cookie|api[-_]?key|otp',
    );
    expect(contentPlaceholder({ a: 1 })).toBe('[CONTENT_REDACTED:7]');
  });
});
