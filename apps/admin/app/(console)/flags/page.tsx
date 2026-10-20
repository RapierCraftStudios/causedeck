import type { Metadata } from 'next';

import { PlaceholderPage } from '../../../components/placeholder-page.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Flags' };

export default async function FlagsPage() {
  await requireStaff('flags');
  return (
    <PlaceholderPage
      title="Flags"
      description="Global and workspace flag management arrives with #311."
    />
  );
}
