import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createStatusLink, revokeStatusLink } from '../create.ts';
import { classifyUserAgent, resolveStatusLink, STATUS_LINK_RATE_LIMIT } from '../resolve.ts';
import { chamber, deps, inWs, input, NOW } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

async function made(tx: Parameters<typeof deps>[0], expiryDays = 7) {
  const c = await chamber(tx);
  const created = await createStatusLink(
    deps(tx),
    c.advocate,
    input(c, { expiryDays, nextDate: '2026-11-20' }),
  );
  return { c, token: created.url.split('/s/')[1] ?? '', id: created.id };
}

describe('resolveStatusLink', () => {
  it('returns only the authored fields and the advocate name, and records a view', async () => {
    await withTestDb(async (tx) => {
      const { token, id, c } = await made(tx);
      const result = await resolveStatusLink(deps(tx), {
        token,
        ip: '203.0.113.9',
        userAgent: 'Mozilla/5.0 (iPhone) Mobile',
      });
      expect(result.state).toBe('ok');
      if (result.state !== 'ok') return;
      expect(Object.keys(result.view).sort()).toEqual(
        ['advocateName', 'expiresAt', 'headline', 'language', 'nextDate', 'note'].sort(),
      );
      expect(result.view).toMatchObject({ nextDate: '2026-11-20', language: 'en' });
      const views = await inWs(tx, c.workspaceId, (t) =>
        t.select().from(schema.statusLinkAccess).where(eq(schema.statusLinkAccess.linkId, id)),
      );
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ uaClass: 'mobile', workspaceId: c.workspaceId });
      expect(JSON.stringify(views[0])).not.toContain('203.0.113.9');
    });
  });

  it('is not found for every token while the flag is off, even a created one', async () => {
    await withTestDb(async (tx) => {
      const { token, c } = await made(tx);
      const off = deps(tx, { flagEnabled: () => Promise.resolve(false) });
      expect(await resolveStatusLink(off, { token })).toEqual({ state: 'not_found' });
      expect(await resolveStatusLink(off, { token: 'x'.repeat(43) })).toEqual({
        state: 'not_found',
      });
      expect(
        await inWs(tx, c.workspaceId, (t) => t.select().from(schema.statusLinkAccess)),
      ).toHaveLength(0);
    });
  });

  it('answers expired, revoked and unknown links alike, with no view recorded', async () => {
    await withTestDb(async (tx) => {
      const { token, c, id } = await made(tx);
      const later = deps(tx, { now: () => new Date(NOW.getTime() + 8 * DAY) });
      expect(await resolveStatusLink(later, { token, ip: 'a' })).toEqual({ state: 'unavailable' });
      await revokeStatusLink(deps(tx), c.advocate, id);
      expect(await resolveStatusLink(deps(tx), { token, ip: 'b' })).toEqual({
        state: 'unavailable',
      });
      expect(await resolveStatusLink(deps(tx), { token: 'y'.repeat(43), ip: 'c' })).toEqual({
        state: 'not_found',
      });
      expect(
        await inWs(tx, c.workspaceId, (t) => t.select().from(schema.statusLinkAccess)),
      ).toHaveLength(0);
    });
  });

  it('rate limits per IP and token', async () => {
    await withTestDb(async (tx) => {
      const { token } = await made(tx);
      let last = '';
      for (let i = 0; i <= STATUS_LINK_RATE_LIMIT.max; i++) {
        last = (await resolveStatusLink(deps(tx), { token, ip: '198.51.100.1' })).state;
      }
      expect(last).toBe('rate_limited');
      expect((await resolveStatusLink(deps(tx), { token, ip: '198.51.100.2' })).state).toBe('ok');
    });
  });
});

describe('classifyUserAgent', () => {
  it('keeps a coarse class only', () => {
    expect(classifyUserAgent('Googlebot/2.1')).toBe('bot');
    expect(classifyUserAgent('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe('mobile');
    expect(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0)')).toBe('desktop');
    expect(classifyUserAgent(null)).toBe('other');
  });
});
