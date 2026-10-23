// The fixture workbench's actions (#516): each needs the `adapters` capability (support is denied),
// records `staff.read` with actor kind staff, and returns only redacted output: the contributed
// party names and personal data never appear in the built bundle.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { findLeaks } from '@causedeck/adapters/workbench';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  record: vi.fn<(ctx: unknown, event: unknown) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('../lib/staff.ts', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@causedeck/core/runtime', () => ({ db: { tag: 'db' } }));
vi.mock('@causedeck/core/audit', () => ({ record: mocks.record }));

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
