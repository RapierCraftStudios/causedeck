// The Limitation rules console page and its import action (#942): a role without the capability is
// denied before anything is read, rules show their review status (an imported table is a draft),
// and the action imports as the workspace owner and reports the draft outcome.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WORKSPACE_ID = '0192d3b0-0000-7000-8000-000000000942';

const state = vi.hoisted(() => ({
  rules: vi.fn(),
  asOwner: vi.fn(),
  loadRuleTable: vi.fn(),
}));

vi.mock('../lib/data/index.ts', () => ({
  workspaceLimitationRules: state.rules,
  asLimitationOwner: state.asOwner,
}));
vi.mock('@causedeck/core/limitation', () => ({ loadRuleTable: state.loadRuleTable }));
vi.mock('../lib/staff.ts', () => ({
  requireStaff: vi.fn(() => Promise.resolve({ userId: 'staff', role: 'ops' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));

const { default: LimitationRulesPage } = await import('../app/(console)/limitation-rules/page.tsx');
const { importRuleTableAction } = await import('../app/(console)/limitation-rules/actions.ts');
const { requireStaff } = await import('../lib/staff.ts');

const rule = (over: Record<string, unknown>) => ({
  id: 'r1',
  code: 'synthetic.suit',
  title: 'Synthetic suit (FICTIONAL)',
  statute: 'Fictional Act',
  periodValue: 3,
  periodUnit: 'years',
  startEvent: 'cause_of_action',
  condonable: true,
  citation: null,
  tableVersion: 'SYNTHETIC-1',
  reviewed: false,
  draft: true,
  ...over,
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => null,
    (e: unknown) => e as Error & { url?: string },
  );
  if (error?.message !== 'NEXT_REDIRECT') throw error ?? new Error('no redirect');
  return error.url ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rules.mockResolvedValue([
    rule({}),
    rule({ id: 'r2', code: 'synthetic.appeal', reviewed: true, draft: false }),
  ]);
  state.asOwner.mockImplementation(
    (_s: unknown, _p: string, workspaceId: string, fn: (d: unknown, a: unknown) => unknown) =>
      fn({ db: {} }, { workspaceId, userId: 'owner' }),
  );
  state.loadRuleTable.mockResolvedValue({
    version: 'SYNTHETIC-1',
    imported: 2,
    skipped: 0,
    draft: true,
  });
});

describe('Limitation rules page', () => {
  it('denies a role without the capability before reading anything', async () => {
    vi.mocked(requireStaff).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(
      LimitationRulesPage({ searchParams: Promise.resolve({ workspace: WORKSPACE_ID }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(requireStaff).toHaveBeenCalledWith('limitation-rules');
    expect(state.rules).not.toHaveBeenCalled();
  });

  it('asks for a workspace first and reads nothing without one', async () => {
    const html = renderToStaticMarkup(
      await LimitationRulesPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('Workspace id');
    expect(html).not.toContain('Import as draft');
    expect(state.rules).not.toHaveBeenCalled();
  });

  it('shows each rule with its review status', async () => {
    const html = renderToStaticMarkup(
      await LimitationRulesPage({ searchParams: Promise.resolve({ workspace: WORKSPACE_ID }) }),
    );
    expect(html).toContain('Import as draft');
    expect(html).toContain('Draft (unreviewed)');
    expect(html).toContain('Reviewed');
    expect(html).toContain('3 years');
  });

  it('says so when the tracker is not enabled for the workspace', async () => {
    state.rules.mockRejectedValue(new Error('disabled'));
    const html = renderToStaticMarkup(
      await LimitationRulesPage({ searchParams: Promise.resolve({ workspace: WORKSPACE_ID }) }),
    );
    expect(html).toContain('not enabled for this workspace');
  });

  it('reports an import as a draft', async () => {
    const html = renderToStaticMarkup(
      await LimitationRulesPage({
        searchParams: Promise.resolve({ workspace: WORKSPACE_ID, done: 'SYNTHETIC-1:2:0' }),
      }),
    );
    expect(html).toContain('as draft: 2 rules added');
  });
});

describe('importRuleTableAction', () => {
  const table = JSON.stringify({ version: 'SYNTHETIC-1', rules: [] });

  it('imports the table as the workspace owner and redirects with the draft outcome', async () => {
    const url = await redirectOf(importRuleTableAction(form({ workspaceId: WORKSPACE_ID, table })));
    expect(requireStaff).toHaveBeenCalledWith('limitation-rules');
    expect(state.loadRuleTable).toHaveBeenCalledWith(
      { db: {} },
      { workspaceId: WORKSPACE_ID, userId: 'owner' },
      { version: 'SYNTHETIC-1', rules: [] },
    );
    expect(url).toContain('done=SYNTHETIC-1%3A2%3A0');
  });

  it('rejects a bad workspace id and bad JSON without importing', async () => {
    expect(await redirectOf(importRuleTableAction(form({ workspaceId: 'nope', table })))).toContain(
      'error=workspace',
    );
    expect(
      await redirectOf(importRuleTableAction(form({ workspaceId: WORKSPACE_ID, table: '{' }))),
    ).toContain('error=json');
    expect(state.loadRuleTable).not.toHaveBeenCalled();
  });

  it('reports a workspace without an owner and a disabled tracker', async () => {
    state.asOwner.mockResolvedValueOnce(null);
    expect(
      await redirectOf(importRuleTableAction(form({ workspaceId: WORKSPACE_ID, table }))),
    ).toContain('error=no_owner');
    state.asOwner.mockRejectedValueOnce(
      Object.assign(new Error('off'), { name: 'LimitationDisabledError' }),
    );
    expect(
      await redirectOf(importRuleTableAction(form({ workspaceId: WORKSPACE_ID, table }))),
    ).toContain('error=disabled');
  });
});
