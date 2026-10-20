// `/healthz` (#309): liveness without auth; proxy.ts never runs on it.
import { describe, expect, it } from 'vitest';

import { GET } from '../app/healthz/route.ts';
import { classifyPath } from '../lib/gate.ts';

describe('/healthz', () => {
  it('answers 200 with no session', async () => {
    const response = await GET(new Request('http://localhost:3200/healthz'));
    expect(response.status).toBe(200);
  });

  it('is excluded from the gate', async () => {
    expect(classifyPath('/healthz', { production: true })).toBe('probe');
    const { config } = await import('../proxy.ts');
    const matcher = new RegExp(`^${config.matcher[0] ?? ''}$`);
    expect(matcher.test('/healthz')).toBe(false);
    expect(matcher.test('/flags')).toBe(true);
    expect(matcher.test('/healthzx')).toBe(true);
  });
});
