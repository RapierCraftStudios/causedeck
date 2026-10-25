// The Migrations console page (#685): a role without the capability is denied before anything is
// read, and a run's page shows counts, states and issue codes with row numbers, never row content.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WORKSPACE_ID = '0192d3b0-0000-7000-8000-000000000685';
const RUN_ID = '0192d3b0-0000-7000-8000-0000000006a1';

const state = vi.hoisted(() => ({
  runs: vi.fn(),
  progress: vi.fn(),
  report: vi.fn(),
}));

vi.mock('../lib/data/index.ts', () => ({
  workspaceMigrationRuns: state.runs,
  migrationRunProgress: state.progress,
  migrationRunReport: state.report,
}));
vi.mock('@causedeck/core/migration', () => ({ MIGRATION_FIELDS: ['title', 'caseType'] }));
vi.mock('../app/(console)/migrations/actions.ts', () => ({
  startDryRunAction: vi.fn(),
  startImportAction: vi.fn(),
  resumeRunAction: vi.fn(),
  rollbackRunAction: vi.fn(),
}));
vi.mock('../lib/staff.ts', () => ({
  requireStaff: vi.fn(() => Promise.resolve({ userId: 'staff', role: 'ops' })),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

const { default: MigrationsPage } = await import('../app/(console)/migrations/page.tsx');
const { default: RunPage } = await import('../app/(console)/migrations/[id]/page.tsx');
const { requireStaff } = await import('../lib/staff.ts');

const progress = {
  runId: RUN_ID,
  mode: 'dry_run',
  status: 'succeeded',
  totalRows: 5000,
  processedRows: 5000,
  errorRows: 7,
  resumeFrom: 5000,
  chunks: { total: 0, done: 0 },
  rolledBackAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.runs.mockResolvedValue([progress]);
  state.progress.mockResolvedValue(progress);
  state.report.mockResolvedValue({
    runId: RUN_ID,
    mode: 'dry_run',
    issueCounts: { bad_date: 7 },
    issues: [{ row: 12, code: 'bad_date' }],
    missingColumns: [],
  });
});

describe('Migrations pages', () => {
  it('denies a role without the capability before reading anything', async () => {
    vi.mocked(requireStaff).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(
      MigrationsPage({ searchParams: Promise.resolve({ workspace: WORKSPACE_ID }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(requireStaff).toHaveBeenCalledWith('migrations');
    expect(state.runs).not.toHaveBeenCalled();
  });

  it('lists runs with counts only', async () => {
    const html = renderToStaticMarkup(
      await MigrationsPage({ searchParams: Promise.resolve({ workspace: WORKSPACE_ID }) }),
    );
    expect(html).toContain('5000 / 5000');
    expect(html).toContain('Dry run');
    expect(html).toContain(`/migrations/${RUN_ID}`);
  });

  it('shows the report as codes and row numbers, with no row content', async () => {
    const html = renderToStaticMarkup(
      await RunPage({
        params: Promise.resolve({ id: RUN_ID }),
        searchParams: Promise.resolve({ workspace: WORKSPACE_ID }),
      }),
    );
    expect(html).toContain('bad_date: 7');
    expect(html).toContain('Row 12: bad_date');
    expect(html).not.toContain('Roll back');
    expect(html).not.toContain('Fictional');
  });

  it('offers resume for a queued import and rollback once a chunk is done', async () => {
    state.progress.mockResolvedValue({
      ...progress,
      mode: 'import',
      status: 'running',
      chunks: { total: 3, done: 1 },
    });
    const html = renderToStaticMarkup(
      await RunPage({
        params: Promise.resolve({ id: RUN_ID }),
        searchParams: Promise.resolve({ workspace: WORKSPACE_ID }),
      }),
    );
    expect(html).toContain('Resume import');
    expect(html).toContain('Roll back');
  });

  it('answers not found for a run it cannot read', async () => {
    state.progress.mockResolvedValue(null);
    await expect(
      RunPage({
        params: Promise.resolve({ id: RUN_ID }),
        searchParams: Promise.resolve({ workspace: WORKSPACE_ID }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
