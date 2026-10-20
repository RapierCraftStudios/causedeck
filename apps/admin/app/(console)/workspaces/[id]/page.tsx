import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { workspaceMetadata } from '../../../../lib/data/index.ts';
import { requireStaff } from '../../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Workspace' };

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${UNITS[unit] ?? 'B'}`;
}

function formatDate(date: Date | null): string {
  return date === null ? '—' : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * One workspace's metadata (#310): plan, seats, storage, dates and flags. No matter, document,
 * memory, party or draft content, and no member data beyond the owner's email.
 */
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff('workspaces');
  const { id } = await params;
  const workspace = await workspaceMetadata(staff, id);
  if (workspace === null) notFound();
  const rows: [string, string][] = [
    ['Plan', workspace.planId ?? '—'],
    [
      'Seats',
      workspace.seats === null
        ? '—'
        : `${String(workspace.seats)} (+${String(workspace.clerkSeats ?? 0)} clerk)`,
    ],
    ['Active members', String(workspace.memberCount)],
    ['Owner email', workspace.ownerEmail ?? '—'],
    ['Storage', formatBytes(workspace.storageBytes)],
    ['Created', formatDate(workspace.createdAt)],
    ['Last active', formatDate(workspace.lastActiveAt)],
    ['Deleted', formatDate(workspace.deletedAt)],
  ];
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <p className="text-sm">
        <Link href="/workspaces" className="underline">
          Workspaces
        </Link>
      </p>
      <h1 id="page-title" className="text-lg font-semibold">
        <span className="font-mono">{workspace.slug}</span>
        <span className="text-ink-muted ml-2 text-sm font-normal">{workspace.kind}</span>
      </h1>
      <dl className="grid max-w-lg grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="flags" className="grid gap-2">
        <h2 id="flags" className="text-base font-medium">
          Flags
        </h2>
        {workspace.flags.length === 0 ? (
          <p className="text-ink-muted text-sm">No workspace flag overrides.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {workspace.flags.map((flag) => (
              <li key={flag.key}>
                <code className="font-mono">{flag.key}</code>: {flag.enabled ? 'on' : 'off'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
