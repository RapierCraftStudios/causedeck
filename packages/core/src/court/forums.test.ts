// Forum services and deep links (#34): new-window links on the first catalogue host with the others
// as fallbacks (never embeddable), the catalogue plus a workspace's own forums, custom A0 forums
// that cannot take a catalogue code and stay inside their workspace, and no court hostname spelled
// anywhere in packages/core (hosts are catalogue data).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { createDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { FORUM_CATALOGUE, seedForumCatalogue } from '@causedeck/db/seed/forum-catalogue';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkspaceError } from '../shared/errors.ts';

import { buildDeepLink, interpolateTemplate } from './deep-links.ts';
import {
  createWorkspaceForum,
  getForum,
  listForums,
  listForumsByCity,
  resolveDeepLink,
} from './forums.ts';

const CONFIG = {
  hosts: ['primary.example.test', 'second.example.test', 'third.example.test'],
  deepLinks: {
    cause_list: 'cause_list.php',
    case_status: 'status/{caseType}/{number}',
    orders: 'https://second.example.test/orders/',
  },
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

describe('deep links (#34)', () => {
  it('opens the first host in a new window, the other hosts as fallbacks', () => {
    const link = resolveDeepLink({ enabled: true, config: CONFIG }, 'cause_list');
    expect(link).toEqual({
      url: 'https://primary.example.test/cause_list.php',
      fallbacks: [
        'https://second.example.test/cause_list.php',
        'https://third.example.test/cause_list.php',
      ],
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(Object.keys(link ?? {}).sort()).toEqual(['fallbacks', 'rel', 'target', 'url']);
  });

  it('keeps an absolute template on its own host', () => {
    expect(resolveDeepLink({ enabled: true, config: CONFIG }, 'orders')).toMatchObject({
      url: 'https://second.example.test/orders/',
      fallbacks: [],
      target: '_blank',
    });
  });

  it('interpolates encoded parameters and rejects a missing one', () => {
    expect(buildDeepLink(CONFIG, 'case_status', { caseType: 'W.P./MD', number: 12 })?.url).toBe(
      'https://primary.example.test/status/W.P.%2FMD/12',
    );
    expect(() => interpolateTemplate('status/{caseType}', {})).toThrow(WorkspaceError);
  });

  it('returns null for a disabled forum, a missing page or an embeddable config', () => {
    expect(resolveDeepLink({ enabled: false, config: CONFIG }, 'cause_list')).toBeNull();
    expect(resolveDeepLink({ enabled: true, config: CONFIG }, 'e_copy')).toBeNull();
    expect(
      resolveDeepLink({ enabled: true, config: { ...CONFIG, embed: true } }, 'cause_list'),
    ).toBeNull();
  });

  it('resolves every catalogue deep link to a new-window link on a catalogue host', () => {
    for (const entry of FORUM_CATALOGUE) {
      for (const kind of Object.keys(entry.config.deepLinks) as (keyof typeof CONFIG.deepLinks)[]) {
        const link = resolveDeepLink({ enabled: true, config: entry.config }, kind);
        expect(link, `${entry.code} ${kind}`).not.toBeNull();
        expect(link).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
        expect(entry.config.hosts).toContain(new URL(link?.url ?? '').host);
      }
    }
  });
});

const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });

beforeAll(async () => {
  // Committed, as `pnpm db:migrate` leaves it.
  await seedForumCatalogue(owner);
});

afterAll(async () => {
  await owner.$client.end();
});

describe('forum services (#34)', () => {
  it('lists the catalogue and the workspace’s own forums, never another workspace’s', async () => {
    await withTestDb(async (tx) => {
      const { a, b } = await seedTwoTenants(tx);
      const aForum = a.rows.forum?.forumId ?? '';
      const bForum = b.rows.forum?.forumId ?? '';
      const inB = await listForums(tx, b.id);
      const ids = inB.map((f) => f.id);
      expect(ids).toContain(bForum);
      expect(ids).not.toContain(aForum);
      const codes = inB.map((f) => f.code);
      expect(codes).toContain('in.tn.madras-hc.principal.original');
      expect(codes).not.toContain('in.tn.madras-hc.madurai');
      const all = await listForums(tx, b.id, { includeDisabled: true });
      expect(all.map((f) => f.code)).toContain('in.tn.madras-hc.madurai');
      await expect(getForum(tx, b.id, aForum)).rejects.toBeInstanceOf(WorkspaceError);
      expect((await getForum(tx, b.id, 'in.nclt.bengaluru')).workspaceId).toBeNull();
    });
  });

  it('lists forums by city', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const chennai = await listForumsByCity(tx, a.id, 'chennai');
      expect(chennai.length).toBeGreaterThan(0);
      expect(chennai.every((f) => f.seat === 'Chennai')).toBe(true);
      expect(chennai.map((f) => f.code)).toContain('in.tn.chennai.cmm-egmore');
      expect(await listForumsByCity(tx, a.id, ' ')).toEqual([]);
    });
  });

  it('resolves a seeded forum’s link on its first catalogue host', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const madras = await getForum(tx, a.id, 'in.tn.madras-hc.principal.appellate');
      const hosts = (madras.config as { hosts: string[] }).hosts;
      const link = resolveDeepLink(madras, 'cause_list');
      expect(link?.url.startsWith(`https://${hosts[0] ?? ''}/`)).toBe(true);
      expect(link?.fallbacks).toHaveLength(hosts.length - 1);
    });
  });

  it('creates a custom A0 forum in the actor’s workspace, invisible to others', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua } = await seedTwoTenants(tx);
      const created = await createWorkspaceForum(
        tx,
        { userId: ua, workspaceId: a.id },
        {
          code: 'ws.tribunal.chennai-debt-1',
          court: 'Debts Recovery Tribunal',
          establishment: 'DRT-1 Chennai',
          seat: 'Chennai',
          jurisdictionKind: 'tribunal',
          languageProfile: { primary: 'en' },
        },
      );
      expect(created).toMatchObject({
        workspaceId: a.id,
        adapterLevel: 'A0',
        adapterId: null,
        enabled: true,
      });
      expect((await listForums(tx, a.id)).map((f) => f.id)).toContain(created.id);
      expect((await listForums(tx, b.id)).map((f) => f.id)).not.toContain(created.id);
      // The same code again, in the same workspace: CONFLICT.
      expect(
        await codeOf(
          createWorkspaceForum(
            tx,
            { userId: ua, workspaceId: a.id },
            { code: 'ws.tribunal.chennai-debt-1', court: 'Again', jurisdictionKind: 'tribunal' },
          ),
        ),
      ).toBe('CONFLICT');
    });
  });

  it('refuses a catalogue code, a malformed input and a viewer', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const actor = { userId: ua, workspaceId: a.id };
      expect(
        await codeOf(
          createWorkspaceForum(tx, actor, {
            code: 'in.tn.madras-hc.principal.original',
            court: 'Shadow',
            jurisdictionKind: 'high_court',
          }),
        ),
      ).toBe('CONFLICT');
      expect(
        await codeOf(
          createWorkspaceForum(tx, actor, {
            code: 'Not A Code',
            court: 'X',
            jurisdictionKind: 'other',
          }),
        ),
      ).toBe('VALIDATION');
      expect(
        await codeOf(
          createWorkspaceForum(tx, actor, {
            code: 'ws.embedded',
            court: 'X',
            jurisdictionKind: 'other',
            config: { hosts: ['x.example.test'], deepLinks: {}, embed: true } as never,
          }),
        ),
      ).toBe('VALIDATION');
      const viewer = a.rows.member?.userId ?? '';
      expect(
        await codeOf(
          createWorkspaceForum(
            tx,
            { userId: viewer, workspaceId: a.id },
            { code: 'ws.viewer', court: 'X', jurisdictionKind: 'other' },
          ),
        ),
      ).toBe('FORBIDDEN');
      // Nothing was written for the refused calls.
      const own = await listForums(tx, a.id);
      expect(own.map((f) => f.code)).not.toContain('ws.viewer');
    });
  });
});

describe('court hostnames (#34)', () => {
  it('appear nowhere in packages/core: hosts are catalogue data', () => {
    const src = path.resolve(import.meta.dirname, '..');
    const pattern = new RegExp(['tn', 'karnataka', 'nclt'].map((s) => `${s}\\.gov\\.in`).join('|'));
    const hits = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => pattern.test(readFileSync(path.join(src, file), 'utf8')));
    expect(hits).toEqual([]);
  });
});
