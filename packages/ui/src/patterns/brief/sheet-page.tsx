import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface SheetPageProps extends ComponentProps<'article'> {
  /** Language of the sheet content, for Tamil and Kannada party names and passages. */
  children: ReactNode;
}

/**
 * The A4-proportioned paper of the Brief Sheet: an `article` that is the same document on screen and
 * in print (ink on white regardless of theme, 794 px wide on screen, 14 mm margins in print).
 */
export function SheetPage({ className, children, ...rest }: SheetPageProps) {
  return (
    <article
      data-slot="sheet-page"
      className={cn(
        'border-border bg-card text-card-foreground mx-auto w-full max-w-[794px] border px-5 py-6 font-serif text-[15px] leading-normal sm:px-10 sm:py-10',
        '[&_:lang(ta)]:font-sans [&_:lang(ta)]:leading-[1.7] [&_:lang(kn)]:font-sans [&_:lang(kn)]:leading-[1.7]',
        'print:max-w-none print:border-0 print:bg-white print:p-0 print:text-[10.5pt] print:text-black',
        className,
      )}
      {...rest}
    >
      {children}
    </article>
  );
}

export interface SectionLabelProps extends Omit<ComponentProps<'h2'>, 'children'> {
  children: ReactNode;
}

/** A section heading: small caps in muted ink, kept with the text that follows in print. */
export function SectionLabel({ className, children, ...rest }: SectionLabelProps) {
  return (
    <h2
      data-slot="section-label"
      className={cn(
        'text-muted-foreground font-sans text-xs font-medium tracking-[0.08em] uppercase [font-variant-caps:all-small-caps] print:break-after-avoid print:text-black',
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}
