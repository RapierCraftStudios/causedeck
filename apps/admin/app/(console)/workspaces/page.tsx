import type { Metadata } from 'next';

import { PlaceholderPage } from '../../../components/placeholder-page.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Workspaces' };

export default async function WorkspacesPage() {
  await requireStaff('workspaces');
  return (
    <PlaceholderPage
      title="Workspaces"
      description="Workspace metadata lookup arrives with #310."
    />
  );
}
