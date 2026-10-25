import { LegalLayout, legalMdxComponents } from '../../../components/legal/legal-layout.tsx';
import { legalMetadata, loadLegalPage } from '../../../lib/legal.ts';

export const generateMetadata = () => legalMetadata('terms');

export default async function TermsPage() {
  const page = await loadLegalPage('terms', legalMdxComponents);
  return <LegalLayout page={page} />;
}
