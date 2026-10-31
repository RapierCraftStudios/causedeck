import { LegalLayout, legalMdxComponents } from '../../../components/legal/legal-layout.tsx';
import { legalMetadata, loadLegalPage } from '../../../lib/legal.ts';

export const generateMetadata = () => legalMetadata('data-sources');

export default async function DataSourcesPage() {
  const page = await loadLegalPage('data-sources', legalMdxComponents);
  return <LegalLayout page={page} />;
}
