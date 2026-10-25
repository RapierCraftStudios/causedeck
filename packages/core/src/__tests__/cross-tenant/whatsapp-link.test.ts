// Cross-tenant WhatsApp link services (#678, D-029): user `ub`, working in workspace B, names
// workspace A. Every call is refused (NOT_FOUND) or yields nothing, and A's link and pending
// challenge are unchanged. Driven by the same registry as services.test.ts, so a registered
// service without a case fails.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/whatsapp-link.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
}

type Case = (f: Fixture) => Promise<void>;

async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(core.WorkspaceError);
  expect((error as core.WorkspaceError).code).toBe('NOT_FOUND');
}

async function aState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    links: await s.select().from(schema.whatsappLink).orderBy(schema.whatsappLink.id),
    challenges: await s
      .select()
      .from(schema.whatsappOtpChallenge)
      .orderBy(schema.whatsappOtpChallenge.id),
  }));
}

const asBInA = (f: Fixture) => ({ userId: f.ub, workspaceId: f.a.id });
const asAInB = (f: Fixture) => ({ userId: f.ua, workspaceId: f.b.id });

const CASES: Record<string, Case> = {
  requestWhatsAppOtp: async (f) => {
    const before = await aState(f);
    await expectDenied(
      core.requestWhatsAppOtp({ db: f.tx }, asBInA(f), { e164: '+919800000009', consent: true }),
    );
    expect(await aState(f)).toEqual(before);
  },
  verifyWhatsAppOtp: async (f) => {
    const before = await aState(f);
    await expectDenied(core.verifyWhatsAppOtp({ db: f.tx }, asBInA(f), { code: '123456' }));
    expect(await aState(f)).toEqual(before);
  },
  unlinkWhatsApp: async (f) => {
    const before = await aState(f);
    expect(before.links).toHaveLength(1);
    await expectDenied(core.unlinkWhatsApp({ db: f.tx }, asBInA(f)));
    expect(await aState(f)).toEqual(before);
  },
  setWhatsAppCategories: async (f) => {
    const before = await aState(f);
    await expectDenied(
      core.setWhatsAppCategories({ db: f.tx }, asBInA(f), { categories: ['court.board'] }),
    );
    expect(await aState(f)).toEqual(before);
  },
  getWhatsAppLink: async (f) => {
    await expectDenied(core.getWhatsAppLink({ db: f.tx }, asBInA(f)));
    // B's own link is B's, not A's.
    const own = await core.getWhatsAppLink({ db: f.tx }, { userId: f.ub, workspaceId: f.b.id });
    expect(own).not.toBeNull();
  },
  getWhatsAppSendTarget: async (f) => {
    // B's user never gets A's number, by naming A's workspace or A's user in B's.
    expect(await core.getWhatsAppSendTarget({ db: f.tx }, asBInA(f))).toBeNull();
    expect(await core.getWhatsAppSendTarget({ db: f.tx }, asAInB(f))).toBeNull();
    const own = await core.getWhatsAppSendTarget(
      { db: f.tx },
      { userId: f.ub, workspaceId: f.b.id },
    );
    expect(own?.e164).not.toBe((await aState(f)).links[0]?.e164);
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant whatsapp-link services: ub on workspace B against A (#678)', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      await run({ ...(await seedTwoTenants(tx)), tx });
    });
  });
});
