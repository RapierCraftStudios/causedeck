import type { ComponentProps, ReactNode } from 'react';

/** Long-form wrapper for MDX content. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <article className="text-ink mx-auto max-w-[68ch] [&_a]:underline [&_a]:underline-offset-2 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:font-serif [&_h2]:text-2xl [&_li]:mt-1 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:ps-6">
      {children}
    </article>
  );
}

/** Element overrides handed to compileMDX. External links never leak the referrer. */
export const mdxComponents = {
  a: ({ href, ...props }: ComponentProps<'a'>) => (
    <a
      href={href}
      {...(href?.startsWith('http') === true ? { rel: 'noopener noreferrer' } : {})}
      {...props}
    />
  ),
};
