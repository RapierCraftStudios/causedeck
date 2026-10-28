import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createStatusLink,
  extendStatusLink,
  hashStatusLinkToken,
  listStatusLinks,
  revokeStatusLink,
} from '../create.ts';
import { chamber, deps, inWs, input, NOW } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const UUID = '11111111-1111-4111-8111-111111111111';

describe('createStatusLink', () => {
  it('stores the hash and the authored fields, returns the URL once, default 7 days', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const created = await createStatusLink(
        deps(tx, { randomToken: () => 'tok-aaaaaaaaaaaaaaaaaaaa' }),
        c.advocate,
        input(c),
      );
      expect(created.url).toBe('https://app.example.test/s/tok-aaaaaaaaaaaaaaaaaaaa');
      expect(created.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
      const [row] = await inWs(tx, c.workspaceId, (t) =>
        t.select().from(schema.statusLink).where(eq(schema.statusLink.id, created.id)),
      );
      expect(row?.tokenHash).toBe(hashStatusLinkToken('tok-aaaaaaaaaaaaaaaaaaaa'));
      expect(JSON.stringify(row)).not.toContain('tok-aaaaaaaaaaaaaaaaaaaa');
      expect(row?.payload).toEqual({
        headline: 'Status as on 2 November',
        note: 'The matter is listed on 20 November.',
        nextDate: null,
      });
    });
  });

  it('uses a 256-bit random token', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const a = await createStatusLink(deps(tx), c.owner, input(c));
      const b = await createStatusLink(deps(tx), c.owner, input(c));
      const token = a.url.split('/s/')[1]!;
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(a.url).not.toBe(b.url);
    });
  });

  it('refuses a clerk, a junior and a viewer', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      for (const who of [c.clerk, c.junior, c.viewer]) {
        await expect(createStatusLink(deps(tx), who, input(c))).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      }
      expect(await inWs(tx, c.workspaceId, (t) => t.select().from(schema.statusLink))).toHaveLength(0);
    });
  });

  it('needs an existing client contact of the workspace and a valid expiry', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await expect(
        createStatusLink(deps(tx), c.owner, input({ ...c, contactId: UUID })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        createStatusLink(deps(tx), c.owner, input(c, { expiryDays: 31 })),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        createStatusLink(deps(tx), c.owner, input(c, { note: ' ' })),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});

describe('revoke, extend and list', () => {
  it('revokes once, audited, and lists the state with a view count', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const { id } = await createStatusLink(deps(tx), c.owner, input(c));
      await inWs(tx, c.workspaceId, (t) =>
        t.insert(schema.statusLinkAccess).values([
          { workspaceId: c.workspaceId, linkId: id, uaClass: 'mobile' },
          { workspaceId: c.workspaceId, linkId: id, uaClass: 'desktop' },
          { workspaceId: c.workspaceId, linkId: id, uaClass: 'bot' },
        ]),
      );
      const [live] = await listStatusLinks(deps(tx), c.owner, c.matterId);
      expect(live).toMatchObject({ id, state: 'active', views: 3, headline: 'Status as on 2 November' });
      await revokeStatusLink(deps(tx), c.owner, id);
      const [dead] = await listStatusLinks(deps(tx), c.owner, c.matterId);
      expect(dead?.state).toBe('revoked');
      await expect(revokeStatusLink(deps(tx), c.owner, id)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      const audit = await inWs(tx, c.workspaceId, (t) => t.select().from(schema.auditEvent));
      expect(audit.map((e) => e.action)).toEqual(
        expect.arrayContaining(['status_link.created', 'status_link.revoked']),
      );
    });
  });

  it('extends to at most 30 days from creation and only forward', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const { id, expiresAt } = await createStatusLink(deps(tx), c.owner, input(c));
      const later = await extendStatusLink(deps(tx), c.owner, { linkId: id, expiryDays: 30 });
      expect(later.expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
      expect(later.expiresAt > expiresAt).toBe(true);
      await expect(
        extendStatusLink(deps(tx), c.owner, { linkId: id, expiryDays: 31 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        extendStatusLink(deps(tx), c.owner, { linkId: id, expiryDays: 10 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});
