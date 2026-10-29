import { Button } from '@causedeck/ui/button';
import Link from 'next/link';

import { MobileMenu } from './mobile-menu.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

const NAV = [
  { href: '/', label: 'Product' },
  { href: '/pricing/', label: 'Pricing' },
  { href: '/security/', label: 'Security' },
  { href: '/changelog/', label: 'Changelog' },
  { href: '/about/', label: 'About' },
];

export function SiteHeader({ appUrl }: { appUrl: string }) {
  return (
    <header className="border-line bg-surface sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="text-ink font-serif text-lg font-semibold">
          CauseDeck
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="cd-link text-ink-muted hover:text-ink text-sm"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="secondary" size="sm">
            <a href={`${appUrl}/sign-in`}>Sign in</a>
          </Button>
          <MobileMenu items={NAV} signInHref={`${appUrl}/sign-in`} />
        </div>
      </div>
    </header>
  );
}
