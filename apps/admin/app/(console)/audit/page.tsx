import type { Metadata } from 'next';

import { PlaceholderPage } from '../../../components/placeholder-page.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Audit' };

export default async function AuditPage() {
  await requireStaff('audit');
  return (
    <PlaceholderPage title="Audit" description="The platform staff audit arrives with #310." />
  );
}
