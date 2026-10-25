import { SUBPROCESSORS } from '../../../content/legal/sub-processors.ts';
import { LegalLayout, legalMdxComponents } from '../../../components/legal/legal-layout.tsx';
import { SubprocessorTable } from '../../../components/legal/subprocessor-table.tsx';
import { legalMetadata, loadLegalPage } from '../../../lib/legal.ts';
import { legalChrome } from '../../../lib/legal-chrome.ts';

export const generateMetadata = () => legalMetadata('sub-processors');

export default async function SubProcessorsPage() {
  const page = await loadLegalPage('sub-processors', legalMdxComponents);
  return (
    <LegalLayout
      page={page}
      afterBody={
        <section aria-labelledby="current-sub-processors" className="font-sans">
          <div className="mt-4">
            <SubprocessorTable rows={SUBPROCESSORS} />
          </div>
          <p className="mt-4">
            <a href="/legal/sub-processors/feed.xml" className="underline underline-offset-2">
              {legalChrome().feedLink}
            </a>
          </p>
        </section>
      }
    />
  );
}
