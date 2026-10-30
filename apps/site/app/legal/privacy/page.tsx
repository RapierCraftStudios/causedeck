import { LegalLayout, legalMdxComponents } from '../../../components/legal/legal-layout.tsx';
import { legalMetadata, loadLegalPage } from '../../../lib/legal.ts';

export const generateMetadata = () => legalMetadata('privacy');

export default async function PrivacyPage() {
  const page = await loadLegalPage('privacy', legalMdxComponents);
  return <LegalLayout page={page} />;
}
