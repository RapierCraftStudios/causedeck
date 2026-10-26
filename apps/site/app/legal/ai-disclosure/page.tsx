import { LegalLayout, legalMdxComponents } from '../../../components/legal/legal-layout.tsx';
import { legalMetadata, loadLegalPage } from '../../../lib/legal.ts';

export const generateMetadata = () => legalMetadata('ai-disclosure');

export default async function AiDisclosurePage() {
  const page = await loadLegalPage('ai-disclosure', legalMdxComponents);
  return <LegalLayout page={page} />;
}
