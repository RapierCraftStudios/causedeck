// The public v1 data routes (#625, #487 part 2) through the real app: a key without the route's
// scope gets 403; only cleared sources are served, shared records only from non-personal ones;
// every record carries `as_of` and `official_url` and no source name or licence (D-053); another workspace's case is invisible; no
// response holds a judge rating, ranking or prediction (D-048, D-050).
import { randomUUID } from 'node:crypto';

import { createApiKey } from '@causedeck/core/api-keys';
import { closeTestDb, schema, testAppDb, withWorkspace } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call, makeApp, signIn } from './helpers.ts';

afterAll(closeTestDb);

const CASE_CNR = 'TNCH010012342024';
const tag = randomUUID().slice(0, 8);
const ids = {
  open: `pa.${tag}.open`,
  personal: `pa.${tag}.personal`,
  uncleared: `pa.${tag}.uncleared`,
  killed: `pa.${tag}.killed`,
};
const cleared = {
  termsStatus: 'cleared',
  counselStatus: 'cleared',
  clearedAt: new Date(),
} as const;

let t: TwoTenants;
let keyA: string;
let keyB: string;
let keyNoScopes: string;
const app = makeApp();

async function keyFor(workspaceId: string, actorUserId: string, scopes: string[]) {
  const { token } = await createApiKey(testAppDb(), {
    workspaceId,
    actorUserId,
    name: 'public-api',
    scopes,
  });
  return token;
}

beforeAll(async () => {
  const [ua, ub, uboth] = [await signIn(), await signIn(), await signIn()];
  t = await seedTwoTenants(testAppDb(), { users: { ua: ua.id, ub: ub.id, uboth: uboth.id } });
  const db = testAppDb();
  const base = { kind: 'court', baseUrl: 'https://pa.example.test', owner: 'PA Court' } as const;
  await db.insert(schema.source).values([
    { ...base, id: ids.open, ...cleared, dataClass: 'non-personal' },
    { ...base, id: ids.personal, ...cleared, dataClass: 'personal' },
    { ...base, id: ids.uncleared, dataClass: 'non-personal' },
    { ...base, id: ids.killed, ...cleared, dataClass: 'non-personal', killSwitch: true },
  ]);
  let n = 0;
  for (const sourceId of Object.values(ids)) {
    n += 1;
    await db.insert(schema.notice).values({
      sourceId,
      kind: 'circular',
      title: `Notice from ${sourceId}`,
      issuedOn: '2026-10-01',
      url: `https://pa.example.test/${tag}/${String(n)}`,
      forumCodes: [`pa-${tag}`],
      sourceType: 'manual',
    });
    for (const kind of ['cause_list', 'order'] as const) {
      await db.insert(schema.contributedDocument).values({
        sourceId,
        kind,
        forumLabel: `PA ${tag}`,
        listingDate: '2026-10-02',
        content: `public ${kind} text ${sourceId}`,
        sha256:
          (kind + sourceId).length.toString(16).padStart(2, '0') +
          randomUUID().replaceAll('-', '').padEnd(62, '0'),
        retentionUntil: new Date(Date.now() + 86_400_000),
      });
    }
  }
  // A's case watch reads a cleared personal-class source: own-matter data may leave regardless.
  await withWorkspace(db, { workspaceId: t.a.id, userId: t.ua }, async (tx) => {
    await tx
      .update(schema.caseWatch)
      .set({ sourceId: ids.personal })
      .where(eq(schema.caseWatch.id, t.a.rows.case_status_snapshot?.watchId ?? ''));
  });
  keyA = await keyFor(t.a.id, t.ua, [
    'cases:read',
    'causelists:read',
    'orders:read',
    'notices:read',
  ]);
  keyB = await keyFor(t.b.id, t.ub, ['cases:read', 'orders:read']);
  keyNoScopes = await keyFor(t.a.id, t.ua, ['webhooks:write']);
});

const get = async (path: string, bearer: string) => {
  const response = await call(app, path, { bearer });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** Keys that would name a source, aggregator, fetch route or licence (D-053 item 4). */
const FORBIDDEN_KEYS = ['source_id', 'source_license', 'provenance', 'ref', 'url'];

const ROUTES = [`/v1/cases/${CASE_CNR}`, '/v1/causelists', '/v1/orders', '/v1/notices'];

describe('public API scopes', () => {
  it.each(ROUTES)('answers 403 on %s for a key without the scope', async (path) => {
    expect((await get(path, keyNoScopes)).status).toBe(403);
  });

  it('answers 403 for a key that has other scopes but not this one', async () => {
    expect((await get('/v1/notices', keyB)).status).toBe(403);
    expect((await get('/v1/causelists', keyB)).status).toBe(403);
  });
});

describe('notices, cause lists and orders', () => {
  it('serves only cleared non-personal sources, with as_of and official_url and no source fields', async () => {
    for (const path of [
      `/v1/notices?forum=pa-${tag}`,
      `/v1/causelists?forum=PA%20${tag}`,
      `/v1/orders`,
    ]) {
      const { status, body } = await get(path, keyA);
      expect(status).toBe(200);
      // The seeded text carries its source id, so it identifies which sources were served.
      const data = (body.data as Record<string, unknown>[]).filter((r) =>
        JSON.stringify(r).includes(`pa.${tag}`),
      );
      expect(data, path).toHaveLength(1);
      expect(JSON.stringify(data[0])).toContain(ids.open);
      for (const record of data) {
        expect(Number.isNaN(Date.parse(String(record.as_of)))).toBe(false);
        expect(record).toHaveProperty('official_url');
        expect(FORBIDDEN_KEYS.filter((k) => k in record)).toEqual([]);
      }
    }
  });

  it('keeps official_url only for a link on the court’s own host', async () => {
    const { body } = await get(`/v1/notices?forum=pa-${tag}`, keyA);
    const open = (body.data as { title: string; official_url: string | null }[]).find((r) =>
      r.title.includes(ids.open),
    );
    expect(open?.official_url).toMatch(/^https:\/\/pa\.example\.test\//);
  });

  it('declares no source field in any v1 response schema', async () => {
    const response = await call(app, '/openapi.json', {});
    const { paths } = (await response.json()) as { paths: Record<string, unknown> };
    const spec = JSON.stringify(
      Object.entries(paths).filter(([route]) =>
        ['/v1/cases/', '/v1/causelists', '/v1/orders', '/v1/notices'].some((p) =>
          route.startsWith(p),
        ),
      ),
    );
    const keys = [...spec.matchAll(/"([a-z_]+)":\{"type"/g)].map((m) => m[1] ?? '');
    expect(keys.length).toBeGreaterThan(0);
    expect(FORBIDDEN_KEYS.filter((k) => keys.includes(k))).toEqual([]);
  });

  it('never narrows shared text by advocate unless the workspace watches that name', async () => {
    const { body } = await get('/v1/causelists?advocate=Nobody%20Watched', keyA);
    expect(body.data).toEqual([]);
  });
});

describe('cases', () => {
  it('serves the caller’s own case with as_of and no source fields', async () => {
    const { status, body } = await get(`/v1/cases/${CASE_CNR}`, keyA);
    expect(status).toBe(200);
    expect(body).toMatchObject({ cnr: CASE_CNR });
    expect(Number.isNaN(Date.parse(String(body.as_of)))).toBe(false);
    expect(FORBIDDEN_KEYS.filter((k) => k in body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(ids.personal);
    const orders = await get(`/v1/orders?case=${CASE_CNR}`, keyA);
    expect(orders.status).toBe(200);
  });

  it('is a 404 for another workspace’s case', async () => {
    expect((await get(`/v1/cases/${CASE_CNR}`, keyB)).status).toBe(404);
    expect((await get(`/v1/orders?case=${CASE_CNR}`, keyB)).body.data).toEqual([]);
  });

  it('is a 404 once the source is no longer cleared', async () => {
    const watchId = t.a.rows.case_status_snapshot?.watchId ?? '';
    const point = (sourceId: string) =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id, userId: t.ua }, (tx) =>
        tx.update(schema.caseWatch).set({ sourceId }).where(eq(schema.caseWatch.id, watchId)),
      );
    await point(ids.uncleared);
    expect((await get(`/v1/cases/${CASE_CNR}`, keyA)).status).toBe(404);
    await point(ids.personal);
  });
});

describe('what responses never hold', () => {
  it('has no rating, ranking, prediction or contributor field', async () => {
    const bodies = await Promise.all(
      [`/v1/cases/${CASE_CNR}`, '/v1/causelists', '/v1/orders', '/v1/notices'].map(async (path) =>
        JSON.stringify((await get(path, keyA)).body),
      ),
    );
    for (const text of bodies) {
      expect(text).not.toMatch(/rating|ranking|rank"|predict|contributor|workspace/i);
    }
  });
});
