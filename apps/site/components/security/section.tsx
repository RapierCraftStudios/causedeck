import type { ReactNode } from 'react';

/** A security page section with a stable anchor id (the landing page links to these). */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <h2 id={`${id}-title`}>
        <a href={`#${id}`} className="no-underline hover:underline">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}
