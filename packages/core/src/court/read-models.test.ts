// Courts read models (#397): the index by city and court with disabled forums apart (reason, no
// links), a forum's new-window deep links with the captcha-gated flag and its access-mode rows,
// an adapter's status with health derived from the summary view, and the halls seen in a
// workspace's parse runs.
import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { createDb, inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { seedForumCatalogue } from '@causedeck/db/seed/forum-catalogue';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkspaceError } from '../shared/errors.ts';

import { getAdapterStatus, getCourtsIndex, getForumDetail, listHallsSeen } from './read-models.ts';

const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });

beforeAll(async () => {
  // Committed, as `pnpm db:migrate` leaves it.
  await seedForumCatalogue(owner);
});

afterAll(async () => {
  await owner.$client.end();
});

const APPELLATE = 'in.tn.madras-hc.principal.appellate';
const T0 = Date.parse('2026-10-01T04:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

interface RunInput {
  adapterId?: string;
  forumCode?: string;
  status?: 'ok' | 'degraded' | 'failed';
  hallsSeen?: string[];
  hallsUnreadable?: string[];
  rowsParsed?: number;
  createdAt: Date;
}

async function addRun(tx: Transaction, { a }: TwoTenants, run: RunInput) {
  const documentId = a.rows.adapter_parse_run?.documentId ?? '';
  const rows = run.rowsParsed ?? 4;
  await inWorkspace(tx, a.id, (s) =>
    s.insert(schema.adapterParseRun).values({
      workspaceId: a.id,
      documentId,
      adapterId: run.adapterId ?? 'echo',
      adapterVersion: '1.0.0',
      forumCode: run.forumCode ?? APPELLATE,
      rowsParsed: rows,
      rowsAnchored: rows - 1,
      unmappedHeadings: 0,
      unknownCaseTypes: 0,
      hallsSeen: run.hallsSeen ?? [],
      hallsUnreadable: run.hallsUnreadable ?? [],
      status: run.status ?? 'ok',
      createdAt: run.createdAt,
    }),
  );
}

async function activate(tx: Transaction, adapterId: string, lastVerifiedAt: Date | null = null) {
  await tx.insert(schema.adapterVersion).values({
    adapterId,
    version: '1.0.0',
    config: {},
    status: 'active',
    checksum: 'a'.repeat(64),
    activatedAt: at(0),
    lastVerifiedAt,
  });
}

describe('getCourtsIndex (#397)', () => {
  it('groups enabled forums by city then court; disabled forums apart, with reason, no links', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      await addRun(tx, seeded, { status: 'ok', createdAt: at(1) });
      await addRun(tx, seeded, {
        status: 'degraded',
        hallsSeen: ['3'],
        hallsUnreadable: ['7'],
        createdAt: at(2),
      });
      const index = await getCourtsIndex(tx, seeded.a.id);

      const cities = index.cities.map((c) => c.city);
      expect(cities).toEqual(expect.arrayContaining(['Bengaluru', 'Chennai']));
      const named = cities.filter((c) => c !== null);
      expect(named).toEqual([...named].sort((x, y) => x.localeCompare(y)));
      const chennai = index.cities.find((c) => c.city === 'Chennai');
      const madras = chennai?.courts.find((c) => c.court === 'Madras High Court');
      const forums = madras?.forums ?? [];
      expect(forums.map((f) => f.code)).toEqual(
        expect.arrayContaining(['in.tn.madras-hc.principal.original', APPELLATE]),
      );
      const appellate = forums.find((f) => f.code === APPELLATE);
      expect(appellate).toMatchObject({
        adapterLevel: 'A1',
        side: 'appellate',
        languageProfile: { primary: 'en' },
        workspaceOwned: false,
        latestParse: { status: 'degraded', at: at(2), hallsUnreadable: ['7'] },
      });
      // The banner's "Open the official list" (#399): a new-window link, never fetched.
      expect(appellate?.officialList).toMatchObject({
        target: '_blank',
        rel: 'noopener noreferrer',
      });
      expect(appellate?.officialList?.url).toMatch(/^https:\/\/[^/]+\/cause_list_mhc\.php$/);
      const civil = chennai?.courts
        .flatMap((c) => c.forums)
        .find((f) => f.code === 'in.tn.chennai.city-civil-court');
      expect(civil?.officialList).toBeNull();
      expect(forums.find((f) => f.code !== APPELLATE)?.latestParse).toBeNull();
      for (const city of index.cities) {
        for (const court of city.courts) {
          for (const f of court.forums) expect(f.code).not.toBe('in.tn.madras-hc.madurai');
        }
      }

      const disabled = index.disabled.map((f) => f.code);
      expect(disabled).toEqual(
        expect.arrayContaining([
          'in.tn.madras-hc.madurai',
          'in.ka.karnataka-hc.dharwad',
          'in.ka.karnataka-hc.kalaburagi',
        ]),
      );
      for (const f of index.disabled) {
        expect(f.reason).toMatch(/\S/);
        expect(Object.keys(f).sort()).toEqual(
          ['code', 'court', 'establishment', 'id', 'reason', 'seat'].sort(),
        );
      }
      expect(JSON.stringify(index.disabled)).not.toMatch(/https?:|hosts|deepLinks/);
    });
  });
});

describe('getForumDetail (#397)', () => {
  it('returns new-window deep links with the captcha-gated flag, and access modes', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      await tx.insert(schema.accessModeRegistry).values([
        { adapterId: 'in.tn.madras-hc.principal', resource: 'cause-list', mode: 'user_supplied' },
        {
          adapterId: 'in.tn.madras-hc.principal',
          resource: 'orders',
          mode: 'official',
          counselNote: 'Cleared by counsel.',
        },
      ]);
      const detail = await getForumDetail(tx, a.id, APPELLATE);
      expect(detail.forum.code).toBe(APPELLATE);
      expect(detail.deepLinks.length).toBeGreaterThan(0);
      for (const { link } of detail.deepLinks) {
        expect(link).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
      }
      const byKind = new Map(detail.deepLinks.map((d) => [d.kind, d.captchaGated]));
      expect(byKind.get('cause_list')).toBe(true);
      expect(byKind.get('case_status')).toBe(true);
      expect(byKind.get('orders')).toBe(false);
      expect(detail.accessModes).toEqual([
        {
          resource: 'cause-list',
          mode: 'user_supplied',
          enabled: false,
          counselNote: null,
          legalReviewPending: true,
        },
        {
          resource: 'orders',
          mode: 'official',
          enabled: false,
          counselNote: 'Cleared by counsel.',
          legalReviewPending: false,
        },
      ]);
    });
  });

  it('gives a disabled forum no links, skips templates needing case details, 404s unknown', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      expect((await getForumDetail(tx, a.id, 'in.tn.madras-hc.madurai')).deepLinks).toEqual([]);
      await inWorkspace(tx, a.id, (s) =>
        s.insert(schema.forum).values({
          workspaceId: a.id,
          code: 'ws.read-models.params',
          court: 'Probe Court',
          jurisdictionKind: 'other',
          config: {
            hosts: ['primary.example.test'],
            deepLinks: { cause_list: 'list.php', case_status: 'status/{caseType}/{number}' },
          },
        }),
      );
      const custom = await getForumDetail(tx, a.id, 'ws.read-models.params');
      expect(custom.deepLinks.map((d) => d.kind)).toEqual(['cause_list']);
      expect(custom.accessModes).toEqual([]);
      const error: unknown = await getForumDetail(tx, a.id, 'in.xx.nowhere.court').catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(WorkspaceError);
      expect((error as WorkspaceError).code).toBe('NOT_FOUND');
    });
  });
});

describe('getAdapterStatus (#397)', () => {
  it('returns the active version, level, verification, derived health and last parse', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const { a } = seeded;
      await activate(tx, 'rm-ok', at(5));
      for (let i = 0; i < 10; i++) {
        await addRun(tx, seeded, { adapterId: 'rm-ok', createdAt: at(10 + i) });
      }
      await addRun(tx, seeded, {
        adapterId: 'rm-ok',
        createdAt: at(30),
        hallsSeen: ['4'],
        hallsUnreadable: ['7'],
        rowsParsed: 12,
      });
      expect(await getAdapterStatus(tx, a.id, 'rm-ok')).toEqual({
        adapterId: 'rm-ok',
        activeVersion: '1.0.0',
        level: null,
        lastVerifiedAt: at(5),
        health: 'ok',
        lastParse: {
          at: at(30),
          status: 'ok',
          rowsParsed: 12,
          rowsAnchored: 11,
          hallsUnreadable: ['7'],
        },
      });

      await activate(tx, 'rm-degraded');
      for (let i = 0; i < 9; i++) {
        await addRun(tx, seeded, { adapterId: 'rm-degraded', createdAt: at(10 + i) });
      }
      await addRun(tx, seeded, { adapterId: 'rm-degraded', status: 'failed', createdAt: at(20) });
      const degraded = await getAdapterStatus(tx, a.id, 'rm-degraded');
      expect(degraded).toMatchObject({ health: 'degraded', lastVerifiedAt: null });

      await activate(tx, 'rm-failed');
      await addRun(tx, seeded, { adapterId: 'rm-failed', createdAt: at(10) });
      await addRun(tx, seeded, { adapterId: 'rm-failed', status: 'failed', createdAt: at(11) });
      expect((await getAdapterStatus(tx, a.id, 'rm-failed')).health).toBe('failed');
    });
  });

  it('takes the version from migration 0048 and the level from forums when no run exists', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      expect(await getAdapterStatus(tx, a.id, 'in.tn.madras-hc.principal')).toEqual({
        adapterId: 'in.tn.madras-hc.principal',
        activeVersion: '1.0.0',
        level: 'A1',
        lastVerifiedAt: null,
        health: null,
        lastParse: null,
      });
    });
  });
});

describe('listHallsSeen (#397)', () => {
  it('lists halls with their last list date and whether the newest list could read them', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      await addRun(tx, seeded, { hallsSeen: ['3', '12A'], createdAt: at(1) });
      await addRun(tx, seeded, { hallsSeen: ['2'], hallsUnreadable: ['3'], createdAt: at(2) });
      await addRun(tx, seeded, {
        forumCode: 'in.tn.madras-hc.principal.original',
        hallsSeen: ['9'],
        createdAt: at(3),
      });
      expect(await listHallsSeen(tx, seeded.a.id, APPELLATE)).toEqual([
        { hallNo: '2', lastListAt: at(2), unreadable: false },
        { hallNo: '3', lastListAt: at(2), unreadable: true },
        { hallNo: '12A', lastListAt: at(1), unreadable: false },
      ]);
      expect(await listHallsSeen(tx, seeded.a.id, 'in.ka.karnataka-hc.bengaluru')).toEqual([]);
    });
  });
});
