// `/w/[slug]/settings/audit` (#232): the settings entry for the audit log, which lives on the
// Activity page's security and audit tab. The tab checks `audit.read` itself.
import { redirect } from 'next/navigation';

export default async function AuditSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/w/${encodeURIComponent(slug)}/activity?tab=security`);
}
