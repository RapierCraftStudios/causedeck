// The fixture workbench's actions (#516): each needs the `adapters` capability (support is denied),
// records `staff.read` with actor kind staff, and returns only redacted output: the contributed
// party names and personal data never appear in the built bundle.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { findLeaks } from '@causedeck/adapters/workbench';
import { SourceNotCleared } from '@causedeck/core/sources';
import { createFetcher, createMockProvider } from '@causedeck/fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  fetchEnabled: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  policyFor: vi.fn<(id: string) => Promise<unknown>>(),
  record: vi.fn<(ctx: unknown, event: unknown) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('../lib/staff.ts', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@causedeck/core/runtime', () => ({ db: { tag: 'db' } }));
vi.mock('@causedeck/core/audit', () => ({ record: mocks.record }));

const SOURCE = 'test.workbench:cause_list';
const SOURCE_URL = 'https://khc.example.test/causelist/daily';
const fixtures: Record<string, { body: string; status?: number }> = {};
// The real governed fetcher over the mock provider; only the registry and the flag are stubbed.
const fetcher = createFetcher({
  registry: { policyFor: (id) => mocks.policyFor(id) as never },
  alterlab: createMockProvider(fixtures),
  clock: { now: () => new Date('2026-10-21T04:00:00.000Z') },
  usage: { record: () => Promise.resolve() },
  log: { record: () => Promise.resolve() },
});
const fetchSource = vi.fn((...args: Parameters<typeof fetcher.fetchSource>) =>
  fetcher.fetchSource(...args),
);
vi.mock('../lib/workbench-fetcher.ts', () => ({
  workbenchFetchEnabled: mocks.fetchEnabled,
  workbenchFetcher: () => ({ fetchSource }),
}));

const { buildFixtureAction, previewFixtureAction } =
  await import('../app/(console)/fixtures/actions.ts');

const STAFF = { userId: '0b6c1a52-8a3e-4d7f-9c1e-5f2a7b3c4d5e', email: 'ops@x.test', role: 'ops' };
const DOCUMENT =
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../packages/adapters/fixtures/echo/list-01-admission.input.txt',
    ),
    'utf8',
  ) + '\nContact: arun@chambers.in, 9876543210\n';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const FIELDS = { adapterId: 'echo', format: 'text', name: 'list-81-workbench', document: DOCUMENT };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStaff.mockResolvedValue(STAFF);
  mocks.fetchEnabled.mockResolvedValue(true);
  mocks.policyFor.mockResolvedValue({
    sourceId: SOURCE,
    kind: 'court',
    baseUrl: 'https://khc.example.test/',
    rateLimitPerMinute: 60,
    maxTier: 'http',
    maxCostDollars: 0.01,
    captchaBulkCleared: false,
    version: 'v1',
  });
  Reflect.deleteProperty(fixtures, SOURCE_URL);
});

describe('fixture workbench actions', () => {
  it('require the adapters capability before touching the document', async () => {
    mocks.requireStaff.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(previewFixtureAction({}, form(FIELDS))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(buildFixtureAction({}, form(FIELDS))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.requireStaff).toHaveBeenCalledWith('adapters');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('preview returns the parser rows and records staff.read', async () => {
    const state = await previewFixtureAction({}, form(FIELDS));
    expect(state.preview?.rows.length).toBeGreaterThan(0);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: STAFF.userId, kind: 'staff' } }),
      expect.objectContaining({ action: 'staff.read' }),
    );
  });

  it('build returns a redacted bundle only, and records staff.read', async () => {
    const state = await buildFixtureAction({}, form(FIELDS));
    const bundle = state.built?.bundle;
    if (bundle === undefined) throw new Error(state.error ?? 'no bundle');
    const saved = `${bundle.inputContent}\n${JSON.stringify(bundle.expected)}`;
    expect(findLeaks(saved, ['Arun Kavitham'])).toEqual([]);
    expect(JSON.stringify(state)).not.toMatch(/Arun Kavitham|arun@chambers|9876543210/i);
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it('turns a bad fixture name or an empty document into a message', async () => {
    expect(
      (await buildFixtureAction({}, form({ ...FIELDS, name: 'Bad Name' }))).error,
    ).toBeTruthy();
    expect((await previewFixtureAction({}, form({ ...FIELDS, document: '  ' }))).error).toBe(
      'Add a document to label.',
    );
  });
});

describe('fixture workbench governed fetch (#598)', () => {
  const NO_DOC = { adapterId: FIELDS.adapterId, format: FIELDS.format, name: FIELDS.name };
  const FETCH = { ...NO_DOC, fetchSourceId: SOURCE, fetchUrl: SOURCE_URL };

  it('fetches through the governed fetcher and feeds preview and build, body in memory only', async () => {
    fixtures[SOURCE_URL] = { body: DOCUMENT };
    const preview = await previewFixtureAction({}, form(FETCH));
    expect(preview.preview?.rows.length).toBeGreaterThan(0);
    expect(preview.preview?.document).toBe(DOCUMENT);
    expect(fetchSource).toHaveBeenCalledWith(SOURCE, SOURCE_URL);

    // The build step re-posts the fetched text as the document, so it fetches nothing more.
    const built = await buildFixtureAction(
      {},
      form({ ...NO_DOC, document: preview.preview?.document ?? '' }),
    );
    expect(built.built?.bundle).toBeDefined();
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('audits staff.read step fetch with ids only, never the URL or the body', async () => {
    fixtures[SOURCE_URL] = { body: DOCUMENT };
    await previewFixtureAction({}, form(FETCH));
    const steps = mocks.record.mock.calls.map(
      ([, event]) => (event as { metadata: { step: string } }).metadata.step,
    );
    expect(steps).toEqual(['preview', 'fetch']);
    const logged = JSON.stringify(mocks.record.mock.calls);
    expect(logged).toContain(SOURCE);
    expect(logged).not.toContain(SOURCE_URL);
    expect(logged).not.toContain('Arun');
  });

  it('is dark: with the flag off nothing is fetched', async () => {
    mocks.fetchEnabled.mockResolvedValue(false);
    const state = await previewFixtureAction({}, form(FETCH));
    expect(state.error).toBe('Fetching a document is not enabled.');
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('requires the adapters capability before any fetch', async () => {
    mocks.requireStaff.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(previewFixtureAction({}, form(FETCH))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('prefers pasted text over a fetch', async () => {
    const state = await previewFixtureAction({}, form({ ...FETCH, document: DOCUMENT }));
    expect(state.preview).toBeDefined();
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('turns an uncleared source, a foreign URL and a bad status into messages', async () => {
    mocks.policyFor.mockRejectedValueOnce(new SourceNotCleared('uncleared', SOURCE));
    expect((await previewFixtureAction({}, form(FETCH))).error).toBe(
      'That source is not cleared for fetching.',
    );
    expect(
      (await previewFixtureAction({}, form({ ...FETCH, fetchUrl: 'https://other.example.test/x' })))
        .error,
    ).toBe('Fetch refused: url_outside_source.');
    fixtures[SOURCE_URL] = { body: 'gone', status: 404 };
    expect((await previewFixtureAction({}, form(FETCH))).error).toBe('The source answered 404.');
  });
});
