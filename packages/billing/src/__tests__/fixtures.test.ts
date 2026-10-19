import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '../__fixtures__/razorpay');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

const WEBHOOK_EVENTS = [
  'subscription.activated',
  'subscription.charged',
  'payment.failed',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.paused',
];

/** Every [key, string value] pair in a JSON tree. */
function strings(value: unknown, key = ''): [string, string][] {
  if (typeof value === 'string') return [[key, value]];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, key));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => strings(v, k));
  }
  return [];
}

describe('recorded Razorpay fixtures', () => {
  it('include every webhook event and API response used by the tests', () => {
    expect(files.sort()).toEqual(
      [
        ...WEBHOOK_EVENTS.map((e) => `${e}.json`),
        'customer.create.json',
        'subscription.create.json',
        'subscription.fetch.json',
      ].sort(),
    );
  });

  it.each(files)('%s parses and uses fictional ids and emails only', (file) => {
    const json: unknown = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    for (const [key, value] of strings(json)) {
      if (key === 'id' || key.endsWith('_id') || /^[a-z]+_[A-Za-z0-9]{8,}$/.test(value)) {
        expect(value, `${file}: ${key}`).toContain('FIXTURE');
      }
      if (value.includes('@')) expect(value, `${file}: ${key}`).toMatch(/@example\.com$/);
    }
  });

  it.each(WEBHOOK_EVENTS)('%s.json is a webhook event named after its file', (event) => {
    const json = JSON.parse(readFileSync(join(DIR, `${event}.json`), 'utf8')) as {
      entity: string;
      event: string;
      contains: string[];
      payload: Record<string, { entity: { entity: string } }>;
    };
    expect(json.entity).toBe('event');
    expect(json.event).toBe(event);
    expect(Object.keys(json.payload).sort()).toEqual([...json.contains].sort());
    for (const name of json.contains) expect(json.payload[name]?.entity.entity).toBe(name);
  });
});
