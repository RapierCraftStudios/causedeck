import type { Metadata } from 'next';

import { StatusView } from '../../components/status/status-view.tsx';
import { pageMetadata } from '../../lib/seo.ts';

export const metadata: Metadata = pageMetadata({
  title: 'Status',
  description: 'Current status and recent incidents for CauseDeck.',
  path: 'status',
});

export default function StatusPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-ink text-3xl font-semibold">CauseDeck status</h1>
      <StatusView />
    </div>
  );
}
