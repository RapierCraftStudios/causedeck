import { redirect } from 'next/navigation';

/** Settings opens on its first section. The sections themselves arrive in #25. */
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/w/${encodeURIComponent(slug)}/settings/profile`);
}
