import { Separator } from '@causedeck/ui/separator';
import Link from 'next/link';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '/', label: 'Overview' },
      { href: '/pricing/', label: 'Pricing' },
      { href: '/changelog/', label: 'Changelog' },
    ],
  },
  {
    heading: 'Trust',
    links: [
      { href: '/security/', label: 'Security and privacy' },
      { href: '/about/', label: 'About' },
      { href: '/status/', label: 'Status' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/legal/', label: 'Legal' },
      { href: '/legal/terms/', label: 'Terms of Service' },
      { href: '/legal/privacy/', label: 'Privacy Policy' },
      { href: '/legal/dpa/', label: 'Data Processing Agreement' },
      { href: '/legal/ai-disclosure/', label: 'AI Disclosure' },
      { href: '/legal/sub-processors/', label: 'Sub-processors' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-line bg-surface border-t">
      <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-ink text-sm font-semibold">{column.heading}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="cd-link text-ink-muted hover:text-ink text-sm"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <Separator className="my-8" />
        <p className="text-ink-muted text-sm">
          CauseDeck is software for advocates. Customer data is stored in India.
        </p>
      </div>
    </footer>
  );
}
