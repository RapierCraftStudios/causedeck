import type { Metadata } from 'next';

import { StatusView } from '../../../components/status/status-view.tsx';
import { pageMetadata } from '../../../lib/seo.ts';

export const metadata: Metadata = pageMetadata({
  title: 'Status history',
  description: 'Resolved CauseDeck incidents from the last 30 days.',
  path: 'status/history',
});

export default function StatusHistoryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-ink text-3xl font-semibold">Status history</h1>
      <StatusView mode="history" />
    </div>
  );
}
