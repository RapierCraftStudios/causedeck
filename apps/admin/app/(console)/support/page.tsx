import type { Metadata } from 'next';

import { PlaceholderPage } from '../../../components/placeholder-page.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Support sessions' };

export default async function SupportPage() {
  await requireStaff('support');
  return (
    <PlaceholderPage
      title="Support sessions"
      description="No support sessions. Requests and read-only view arrive with #314."
    />
  );
}
