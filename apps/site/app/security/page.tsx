import path from 'node:path';

import { ControlsTable } from '../../components/security/controls-table.tsx';
import { DataFlowDiagram } from '../../components/security/data-flow-diagram.tsx';
import { Section } from '../../components/security/section.tsx';
import { mdxComponents } from '../../components/prose.tsx';
import { SECURITY_SECTIONS, securityCopy } from '../../content/security.ts';
import { loadMdxFile, CONTENT_DIR } from '../../lib/mdx.ts';
import { pageMetadata } from '../../lib/seo.ts';

const copy = securityCopy();

export const metadata = pageMetadata({
  title: copy.metaTitle,
  description: copy.metaDescription,
  path: 'security',
});

export default async function SecurityPage() {
  const page = await loadMdxFile(path.join(CONTENT_DIR, 'security.mdx'), {
    ...mdxComponents,
    Section,
    DataFlowDiagram: () => <DataFlowDiagram copy={copy} />,
    ControlsTable: () => <ControlsTable copy={copy} />,
  });
  return (
    <div className="xl:grid xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-12">
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <nav aria-label={copy.tocLabel}>
          <p className="text-ink text-sm font-semibold">{copy.tocLabel}</p>
          <ol className="mt-2 space-y-1.5 text-sm">
            {SECURITY_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="cd-link text-ink-muted hover:text-ink">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <article className="text-ink mt-8 max-w-[68ch] xl:mt-0 [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-12 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-semibold [&_li]:mt-2 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:ps-6">
        <h1 className="font-serif text-4xl font-semibold text-balance md:text-5xl">{copy.title}</h1>
        <p className="text-ink-muted mt-4 text-lg">{copy.intro}</p>
        {page.content}
      </article>
    </div>
  );
}
