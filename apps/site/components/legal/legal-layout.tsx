import type { ComponentProps, ReactNode } from 'react';

import { headingId, type LegalPage } from '../../lib/legal.ts';
import { legalChrome } from '../../lib/legal-chrome.ts';
import { mdxComponents } from '../prose.tsx';

import { DraftBanner } from './draft-banner.tsx';
import { VersionHistory } from './version-history.tsx';

function text(children: ReactNode): string {
  return typeof children === 'string' ? children : '';
}

function anchored(Tag: 'h2' | 'h3') {
  return function Heading({ children, ...props }: ComponentProps<'h2'>) {
    const id = headingId(text(children));
    return (
      <Tag id={id} className="scroll-mt-20" {...props}>
        <a href={`#${id}`} className="no-underline hover:underline">
          {children}
        </a>
      </Tag>
    );
  };
}

/** MDX element overrides for legal bodies: the shared ones plus anchor-linked headings. */
export const legalMdxComponents = { ...mdxComponents, h2: anchored('h2'), h3: anchored('h3') };

// Print: A4, serif, page numbers, no site chrome. Plain inline CSS (style-src allows it).
const PRINT_CSS = `@page { size: A4; margin: 20mm; @bottom-center { content: counter(page); } }
@media print {
  body { background: #fff; color: #000; }
  body > a, header, footer, .legal-doc aside { display: none !important; }
  .legal-doc { display: block; }
  .legal-doc article { max-width: none; font-size: 11pt; line-height: 1.5; }
  .legal-doc a { color: inherit; text-decoration: none; }
}`;

/**
 * Title and version metadata, table of contents (collapsible below 1280 px, sticky from there), a
 * 680 px reading measure and, in print, A4 serif without the site chrome.
 */
export function LegalLayout({
  page,
  children,
  afterBody,
}: {
  page: LegalPage;
  children?: ReactNode;
  afterBody?: ReactNode;
}) {
  const chrome = legalChrome();
  const { legal } = page;
  const toc = page.headings.length > 0 && (
    <nav aria-label={chrome.contents}>
      <ol className="space-y-2 text-sm">
        {page.headings.map((heading) => (
          <li key={heading.id}>
            <a href={`#${heading.id}`} className="cd-link text-ink-muted hover:text-ink">
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
  return (
    <div className="legal-doc xl:grid xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-12">
      <style>{PRINT_CSS}</style>
      <aside className="mb-8 xl:mb-0 print:hidden">
        {toc === false ? null : (
          <>
            <details className="border-line rounded-md border p-3 xl:hidden">
              <summary className="cursor-pointer font-medium">{chrome.contents}</summary>
              <div className="mt-3">{toc}</div>
            </details>
            <div className="sticky top-20 hidden xl:block">
              <p className="mb-3 text-sm font-semibold">{chrome.contents}</p>
              {toc}
            </div>
          </>
        )}
      </aside>
      <article className="max-w-[680px] font-serif text-[17px] leading-[1.7] md:text-[18px] [&_a]:underline [&_a]:underline-offset-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-xl [&_li]:mt-1 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:ps-6">
        {legal.status === 'draft' ? <DraftBanner /> : null}
        <header>
          <h1>{page.frontmatter.title}</h1>
          <dl className="text-ink-muted mt-3 flex flex-wrap gap-x-6 gap-y-1 font-sans text-sm">
            <div className="flex gap-2">
              <dt>{chrome.version}</dt>
              <dd>{legal.version}</dd>
            </div>
            <div className="flex gap-2">
              <dt>{chrome.effectiveDate}</dt>
              <dd>{legal.effectiveDate ?? chrome.effectiveDatePending}</dd>
            </div>
          </dl>
          <p className="text-ink-muted mt-3 font-sans text-sm">{chrome.languageNote}</p>
        </header>
        {children}
        <div className="mt-6">{page.content}</div>
        {afterBody}
        <VersionHistory history={legal.history} />
      </article>
    </div>
  );
}
