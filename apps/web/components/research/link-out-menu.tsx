'use client';
// The research link-out menu (#80, D-048): quiet text links to public (or the workspace's own)
// research sites, built by core `buildResearchLinks` from the matter's statute, section, issue
// words and court only. Arrow keys move, Enter opens, Esc closes (Radix menu). Each item shows the
// exact URL it opens and says the site is not ours; links open in a new window with
// `rel="noopener noreferrer"`. Nothing is framed, proxied or fetched.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@causedeck/ui/dropdown-menu';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface LinkOutLink {
  providerKey: string;
  label: string;
  url: string;
  host: string;
}

export function LinkOutMenu({ links }: { links: LinkOutLink[] }) {
  const t = useTranslations('research.linkOut');
  if (links.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-slot="link-out-empty">
        {t('empty')}
      </p>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 text-sm underline">
        {t('button')}
        <ExternalLink aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={t('menuLabel')}
        align="start"
        className="max-w-[min(32rem,calc(100vw-1rem))]"
      >
        {links.map((link) => (
          <DropdownMenuItem key={link.providerKey} asChild>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{link.label}</span>
              <span className="text-muted-foreground w-full text-xs break-all">
                {t('preview', { url: link.url })}
              </span>
              <span className="text-muted-foreground text-xs">{t('hint')}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
