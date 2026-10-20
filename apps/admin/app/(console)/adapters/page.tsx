import type { Metadata } from 'next';

import { PlaceholderPage } from '../../../components/placeholder-page.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Adapters' };

export default async function AdaptersPage() {
  await requireStaff('adapters');
  return (
    <PlaceholderPage title="Adapters" description="Adapter registry and health arrive with #312." />
  );
}
