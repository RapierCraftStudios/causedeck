// The email-intake domain (#54 part 2), against the real test database: the address format, rotate
// and revoke, the oracle-free resolve, the allow-list, the email channel disclosure and the single
// address scheme (#287 reconciliation). Every test runs in a rolled-back transaction.
import { readFileSync } from 'node:fs';

import { captureConfigFromEnv } from '@causedeck/capture';
import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore } from '@causedeck/storage';
import { INTEGRATION_KIND_VALUES } from '@causedeck/validators/workspace';
import { describe, expect, it } from 'vitest';

import { CAPTURE_DISCLOSURE_VERSION, type CaptureCtx } from '../../capture/index.ts';
import {
  addAllowlistEntry,
  createAddress,
  EMAIL_CHANNEL_DISCLOSURE,
  enableEmailChannel,
  generateLocalPart,
  listAllowlist,
  removeAllowlistEntry,
  resolveAddress,
  revokeAddress,
  rotateAddress,
  type AddAllowlistEntryInput,
  type EmailIntakeCtx,
} from '../index.ts';

const DOMAIN = 'intake.test';

class Denied extends Error {}

function ctxFor(
  tx: EmailIntakeCtx['db'],
  workspaceId: string,
  userId: string,
  allowed = true,
): EmailIntakeCtx {
  return {
    db: tx,
    workspaceId,
    userId,
    domain: DOMAIN,
    authorize: () => {
      if (!allowed) throw new Denied();
    },
  };
}

function captureCtx(tx: EmailIntakeCtx['db'], workspaceId: string, userId: string): CaptureCtx {
  return {
    db: tx,
    store: createMemoryObjectStore(),
    workspaceId,
    userId,
    authorize: () => undefined,
    config: captureConfigFromEnv({}),
    jobs: { scan: () => Promise.resolve(), process: () => Promise.resolve() },
  };
}

describe('address format', () => {
  it('is u- plus 10 base32 characters, random and not derived from anything', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const local = generateLocalPart();
      expect(local).toMatch(/^u-[a-z2-7]{10}$/);
      seen.add(local);
    }
    expect(seen.size).toBe(50);
  });

  it('creates one active address per member and refuses a second', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      const ctx = ctxFor(tx, a.id, ua);
      const created = await createAddress(ctx);
      expect(created.address).toMatch(/^u-[a-z2-7]{10}@intake\.test$/);
      expect(created.status).toBe('active');
      await expect(createAddress(ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('is refused without workspace.manage', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      await expect(createAddress(ctxFor(tx, a.id, ua, false))).rejects.toBeInstanceOf(Denied);
    });
  });
});

describe('rotate, revoke and resolve', () => {
  it('rotating stops the old address at once and the new one resolves', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      const ctx = ctxFor(tx, a.id, ua);
      const first = await createAddress(ctx);
      expect(await resolveAddress(tx, first.address)).toEqual({ workspaceId: a.id, userId: ua });
      const second = await rotateAddress(ctx);
      expect(second.address).not.toBe(first.address);
      expect(await resolveAddress(tx, first.address)).toBeNull();
      expect(await resolveAddress(tx, second.address)).toEqual({ workspaceId: a.id, userId: ua });
    });
  });

  it('revoking stops the address; resolve gives the same null for unknown and revoked', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      const ctx = ctxFor(tx, a.id, ua);
      const created = await createAddress(ctx);
      await revokeAddress(ctx, created.id);
      const revoked = await resolveAddress(tx, created.address);
      const unknown = await resolveAddress(tx, `u-aaaaaaaaaa@${DOMAIN}`);
      const malformed = await resolveAddress(tx, 'someone@example.test');
      expect(revoked).toBeNull();
      expect(unknown).toBe(revoked);
      expect(malformed).toBe(revoked);
      await expect(revokeAddress(ctx, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(rotateAddress(ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('allow-list', () => {
  it('adds, lists and removes entries, normalising the pattern', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      const ctx = ctxFor(tx, a.id, ua);
      const domain = await addAllowlistEntry(ctx, { pattern: ' Court.Gov.IN ', kind: 'court' });
      expect(domain).toMatchObject({ pattern: 'court.gov.in', isDomain: true, kind: 'court' });
      const exact = await addAllowlistEntry(ctx, {
        pattern: 'clerk@court.gov.in',
        kind: 'efiling',
        label: 'Registry',
      });
      expect(exact).toMatchObject({ isDomain: false, label: 'Registry' });
      expect((await listAllowlist(tx, a.id)).map((e) => e.pattern)).toContain('court.gov.in');
      await expect(
        addAllowlistEntry(ctx, { pattern: 'court.gov.in', kind: 'court' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await removeAllowlistEntry(ctx, domain.id);
      await expect(removeAllowlistEntry(ctx, domain.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it('rejects a bad pattern, an unknown kind and an over-long label', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      const ctx = ctxFor(tx, a.id, ua);
      const bad: AddAllowlistEntryInput[] = [
        { pattern: 'not an address', kind: 'court' },
        { pattern: '*@court.gov.in', kind: 'court' },
        { pattern: 'court.gov.in', kind: 'friend' },
        { pattern: 'court.gov.in', kind: 'court', label: 'x'.repeat(81) },
      ];
      for (const input of bad) {
        await expect(addAllowlistEntry(ctx, input)).rejects.toMatchObject({ code: 'VALIDATION' });
      }
    });
  });
});

describe('email channel', () => {
  it('records the current disclosure version and carries the product text', async () => {
    await withTestDb(async (tx) => {
      const { a, uboth: ua } = await seedTwoTenants(tx);
      const state = await enableEmailChannel(captureCtx(tx, a.id, ua));
      expect(state).toMatchObject({
        channel: 'email',
        enabled: true,
        disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
      });
      expect(EMAIL_CHANNEL_DISCLOSURE).toBe(
        'Forwarded emails are processed in India. Forward only what you want CauseDeck to read. Client emails are excluded unless you choose to forward them.',
      );
    });
  });
});

describe('one address scheme', () => {
  it('has no email_intake integration kind and no intake+ address builder', () => {
    expect(schema.INTEGRATION_KINDS).toEqual(['ics_feed']);
    expect([...INTEGRATION_KIND_VALUES]).toEqual(['ics_feed']);
    const values = readFileSync(
      new URL(
        '../../../../../apps/web/app/(app)/w/[slug]/settings/integrations/integration-values.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(values).not.toContain('intake+');
    expect(values).not.toContain('email_intake');
  });
});
