// A forum's official pages (#400, #42; ADR 0014): plain anchors that open the court's own page in a
// new window (`target="_blank"`, `rel="noopener noreferrer"`), never framed, embedded or fetched.
// Each says so in visible text; a captcha-gated page also carries the captcha notice, because the
// lawyer solves the court's captcha themselves and CauseDeck never does.
import type { ForumDeepLink } from '@causedeck/core/court';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface DeepLinkListProps {
  links: readonly ForumDeepLink[];
}

export function DeepLinkList({ links }: DeepLinkListProps) {
  const t = useTranslations('courts.detail.links');
  return (
    <section data-slot="deep-links" className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{t('title')}</h2>
      {links.length === 0 ? (
        <p className="text-ink-muted text-sm" data-deep-links-empty="">
          {t('empty')}
        </p>
      ) : (
        <ul className="border-line divide-line flex flex-col divide-y rounded-md border">
          {links.map(({ kind, link, captchaGated }) => (
            <li key={kind} data-deep-link={kind} className="flex flex-col gap-1 px-4 py-3">
              <a
                href={link.url}
                target={link.target}
                rel={link.rel}
                className="text-accent focus-visible:outline-ring flex min-h-8 flex-col rounded-sm outline-offset-2 focus-visible:outline-2"
              >
                <span className="inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline">
                  {t(`kinds.${kind}`)}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </span>
                <span className="text-ink-muted text-xs">{t('newWindow')}</span>
              </a>
              {captchaGated ? (
                <p
                  data-captcha-notice=""
                  className="text-ink-muted inline-flex items-start gap-1.5 text-xs"
                >
                  <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t('captcha')}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
