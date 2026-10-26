import { LegalLayout, legalMdxComponents } from '../../../components/legal/legal-layout.tsx';
import { legalMetadata, loadLegalPage } from '../../../lib/legal.ts';

export const generateMetadata = () => legalMetadata('dpa');

export default async function DpaPage() {
  const page = await loadLegalPage('dpa', legalMdxComponents);
  return <LegalLayout page={page} />;
}
