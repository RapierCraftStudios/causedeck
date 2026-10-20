import { EmptyState } from '@causedeck/ui/empty-state';
import type { Metadata } from 'next';
import Link from 'next/link';

import { searchWorkspaces } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Workspaces' };

interface SearchParams {
  q?: string | string[];
}

/** Workspace metadata lookup (#310): by slug (prefix) or owner email; metadata only, no content. */
export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const staff = await requireStaff('workspaces');
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  const results = q === '' ? [] : await searchWorkspaces(staff, q);
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <h1 id="page-title" className="text-lg font-semibold">
        Workspaces
      </h1>
      <form role="search" method="get" className="flex max-w-lg gap-2">
        <label htmlFor="workspace-q" className="sr-only">
          Slug or owner email
        </label>
        <input
          id="workspace-q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={254}
          placeholder="Slug or owner email"
          className="border-line bg-surface flex-1 rounded-md border px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="border-line bg-surface-raised rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          Search
        </button>
      </form>
      {q === '' ? (
        <EmptyState
          title="Find a workspace."
          description="Search by workspace slug or by the owner's email. Staff see metadata only."
        />
      ) : results.length === 0 ? (
        <EmptyState title="No workspaces found." description={`Nothing matches “${q}”.`} />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 font-medium">Slug</th>
              <th className="py-1 font-medium">Plan</th>
              <th className="py-1 font-medium">Seats</th>
              <th className="py-1 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {results.map((w) => (
              <tr key={w.workspaceId} className="border-line border-t">
                <td className="py-1">
                  <Link href={`/workspaces/${w.workspaceId}`} className="font-mono underline">
                    {w.slug}
                  </Link>
                  {w.deletedAt === null ? null : (
                    <span className="text-ink-muted ml-2 text-xs">deleted</span>
                  )}
                </td>
                <td className="py-1">{w.planId ?? '—'}</td>
                <td className="py-1 tabular-nums">{w.seats ?? '—'}</td>
                <td className="py-1 tabular-nums">{w.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
