import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readSiteEnv } from '../env.ts';
import { baseCsp } from '../../scripts/write-headers.ts';
import { buildAtom, buildRss, loadVerifiedSnapshot, xmlEscape } from './feed.ts';
import { formatIst, formatUtc, uptimeDays } from './format.ts';
import { COMPONENT_LABELS, STALE_AFTER_SEC, type StatusSnapshot } from './model.ts';
import { loadStatus, watchOnline } from './state.ts';
import { canonicalJson, verifySnapshot } from './verify.ts';

const KEY = 'test-signing-key-0123456789abcdef';
// Signed by core's `signSnapshot` algorithm (canonicalStatusJson + HMAC-SHA256 hex).
const SIGNED: StatusSnapshot = {
  version: 1,
  generatedAt: '2026-10-25T10:00:00.000Z',
  overall: 'degraded',
  components: [
    { id: 'database', name: 'Database', status: 'operational' },
    { id: 'storage', name: 'Storage', status: 'operational' },
    { id: 'court', name: 'Parsing of documents you share', status: 'degraded' },
  ],
  incidents: [
    {
      id: '3f9c1c1e-6a49-4d0e-8a77-0c5f0d6a1b11',
      title: 'Slow parsing',
      severity: 'degraded',
      state: 'monitoring',
      component: 'court',
      startedAt: '2026-10-25T08:00:00.000Z',
      resolvedAt: null,
      updates: [
        { state: 'monitoring', body: 'A fix is in place.', at: '2026-10-25T09:00:00.000Z' },
      ],
    },
  ],
  signature: {
    alg: 'HS256',
    value: '89705d3a1ae19e5abc5dcbf892f29e2a478e4c1247d95e8983e785f04ae5e9b8',
  },
};
const T0 = Date.parse(SIGNED.generatedAt);
const respond =
  (body: unknown, ok = true) =>
  () =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) });
const at = (sec: number) => new Date(T0 + sec * 1000);
const quiet = (): StatusSnapshot => ({
  ...SIGNED,
  overall: 'operational',
  components: SIGNED.components.map((c) => ({ ...c, status: 'operational' })),
  incidents: [],
});

describe('verify', () => {
  it('canonical JSON sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: null }] })).toBe(
      '{"a":[{"c":null}],"b":1}',
    );
  });
  it('matches the bytes core signs', async () => {
    const { signature, ...unsigned } = SIGNED;
    const expected = createHmac('sha256', KEY).update(canonicalJson(unsigned)).digest('hex');
    expect(expected).toBe(signature.value);
    expect(await verifySnapshot(SIGNED, KEY)).toEqual(SIGNED);
  });
  it('rejects a tampered body, signature or key', async () => {
    expect(await verifySnapshot({ ...SIGNED, overall: 'operational' }, KEY)).toBeNull();
    const bad = { ...SIGNED, signature: { alg: 'HS256', value: 'a'.repeat(64) } };
    expect(await verifySnapshot(bad, KEY)).toBeNull();
    expect(await verifySnapshot(SIGNED, 'other-key')).toBeNull();
    expect(await verifySnapshot({ nope: 1 }, KEY)).toBeNull();
  });
});

describe('loadStatus', () => {
  it('is stale at 301s and not at 300s', async () => {
    expect((await loadStatus(respond(SIGNED), '/s', KEY, at(STALE_AFTER_SEC))).kind).toBe('ok');
    expect((await loadStatus(respond(SIGNED), '/s', KEY, at(STALE_AFTER_SEC + 1))).kind).toBe(
      'stale',
    );
  });
  it('classifies every kind', async () => {
    expect((await loadStatus(respond({ ...SIGNED, overall: 'down' }), '/s', KEY, at(0))).kind).toBe(
      'unverified',
    );
    expect((await loadStatus(respond(null, false), '/s', KEY, at(0))).kind).toBe('unavailable');
    const boom = () => Promise.reject(new Error('offline'));
    expect((await loadStatus(boom, '/s', KEY, at(0))).kind).toBe('unavailable');
    const q = quiet();
    const unsigned: Omit<StatusSnapshot, 'signature'> & { signature?: unknown } = { ...q };
    delete unsigned.signature;
    const signed = {
      ...q,
      signature: {
        alg: 'HS256',
        value: createHmac('sha256', KEY).update(canonicalJson(unsigned)).digest('hex'),
      },
    };
    expect((await loadStatus(respond(signed), '/s', KEY, at(0))).kind).toBe('empty');
  });
  it('watches online and offline events', () => {
    const seen: boolean[] = [];
    const target = new EventTarget();
    const stop = watchOnline(target, (v) => seen.push(v));
    target.dispatchEvent(new Event('offline'));
    target.dispatchEvent(new Event('online'));
    stop();
    target.dispatchEvent(new Event('offline'));
    expect(seen).toEqual([false, true]);
  });
});

describe('format', () => {
  it('shows IST and UTC', () => {
    expect(formatIst('2026-10-25T10:00:00.000Z')).toBe('25 Oct 2026, 15:30 IST');
    expect(formatUtc('2026-10-25T10:00:00.000Z')).toBe('25 Oct 2026, 10:00 UTC');
  });
  it('buckets 30 days with the worst incident', () => {
    const days = uptimeDays(SIGNED.incidents, at(0));
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ date: '2026-10-25', state: 'degraded' });
    expect(days[0]?.state).toBe('operational');
  });
  it('uses court wording without naming a court system', () => {
    expect(COMPONENT_LABELS.court).toBe('Parsing of documents you share');
    expect(JSON.stringify(COMPONENT_LABELS)).not.toMatch(/ecourts/i);
  });
});

describe('feeds', () => {
  const base = SIGNED.incidents[0] as StatusSnapshot['incidents'][number];
  const hostile: StatusSnapshot = {
    ...SIGNED,
    incidents: [
      {
        ...base,
        title: '<script>alert(1)</script> & co',
        updates: [
          { state: 'identified', body: 'x ]]> y\u0001z "q"', at: '2026-10-25T09:00:00.000Z' },
        ],
      },
    ],
  };
  it('escapes markup and control characters', () => {
    expect(xmlEscape('<a&b>\u0000"\'')).toBe('&lt;a&amp;b&gt;&quot;&apos;');
    for (const xml of [
      buildRss(hostile, 'https://x/status/'),
      buildAtom(hostile, 'https://x/status/'),
    ]) {
      expect(xml).not.toContain('<script>');
      expect(xml).not.toContain(']]>');
      expect(xml).not.toContain('\u0001');
      expect(xml).toContain('&lt;script&gt;');
    }
  });
  it('is well-formed RSS and Atom, and empty without a verified snapshot', () => {
    expect(buildRss(SIGNED, 'https://x/status/')).toMatch(
      /^<\?xml[^>]*\?>\n<rss version="2.0"><channel>.*<item>.*<\/channel><\/rss>\n$/s,
    );
    expect(buildAtom(SIGNED, 'https://x/status/')).toMatch(
      /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">.*<entry>.*<\/feed>/s,
    );
    expect(buildRss(null, 'https://x/status/')).not.toContain('<item>');
    expect(buildAtom(null, 'https://x/status/')).not.toContain('<entry>');
  });
  it('loads only a verified snapshot at build time', async () => {
    const f = (body: unknown, ok = true) =>
      (() => Promise.resolve({ ok, json: () => Promise.resolve(body) })) as unknown as typeof fetch;
    expect(await loadVerifiedSnapshot(f(SIGNED), 'u', KEY)).toEqual(SIGNED);
    expect(await loadVerifiedSnapshot(f({ ...SIGNED, overall: 'down' }), 'u', KEY)).toBeNull();
    expect(await loadVerifiedSnapshot(f(null, false), 'u', KEY)).toBeNull();
  });
});

describe('status env and CSP', () => {
  it('defaults, treats empty as unset and rejects bad URLs', () => {
    expect(readSiteEnv({}).statusUrl).toBe('/status/status.json');
    expect(readSiteEnv({ NEXT_PUBLIC_STATUS_URL: '' }).statusUrl).toBe('/status/status.json');
    expect(readSiteEnv({ NEXT_PUBLIC_STATUS_URL: 'https://s.example/status.json' }).statusUrl).toBe(
      'https://s.example/status.json',
    );
    expect(() => readSiteEnv({ NEXT_PUBLIC_STATUS_URL: 'http://evil.example/x' })).toThrow();
    expect(() => readSiteEnv({ NEXT_PUBLIC_STATUS_URL: '//evil.example/x' })).toThrow();
  });
  it('allows the status origin in connect-src only when given', () => {
    expect(baseCsp()).toContain("connect-src 'self'");
    expect(baseCsp()).not.toContain('s.example');
    expect(baseCsp(undefined, 'https://s.example')).toContain(
      "connect-src 'self' https://s.example",
    );
  });
});
