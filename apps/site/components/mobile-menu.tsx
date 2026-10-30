'use client';

import Link from 'next/link';
import { useRef } from 'react';

interface Item {
  href: string;
  label: string;
}

/**
 * Phone navigation: a native `<details>` panel instead of a Radix sheet, which keeps the dialog,
 * focus-trap and scroll-lock runtime out of every page's JavaScript. A link or Escape closes it.
 */
export function MobileMenu({ items, signInHref }: { items: readonly Item[]; signInHref: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    ref.current?.removeAttribute('open');
  };
  return (
    <details
      ref={ref}
      className="group relative md:hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label="Open menu"
        className="text-ink hover:bg-surface-sunken inline-flex h-8 cursor-pointer list-none items-center rounded-md px-3 text-sm font-medium select-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"
      >
        Menu
      </summary>
      <nav
        aria-label="Mobile"
        className="border-line bg-surface absolute end-0 top-full z-50 mt-2 flex w-56 flex-col gap-1 rounded-md border p-3 shadow-md"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={close}
            className="text-ink block rounded-md px-2 py-2 text-base"
          >
            {item.label}
          </Link>
        ))}
        <a href={signInHref} className="text-ink block rounded-md px-2 py-2 text-base">
          Sign in
        </a>
      </nav>
    </details>
  );
}
