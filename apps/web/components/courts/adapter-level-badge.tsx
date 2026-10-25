// An adapter level badge for the courts area (#399, #42): the level code with the plain-language
// capability sentence. Only A0 and A1 exist today; A2 and A3 are not shown until they do.
import { Badge } from '@causedeck/ui/badge';
import { useTranslations } from 'next-intl';

export type AdapterLevel = 'A0' | 'A1' | 'A2' | 'A3';

/** Levels shown to users. */
export const SHOWN_LEVELS = ['A0', 'A1'] as const;

type ShownLevel = (typeof SHOWN_LEVELS)[number];

function isShown(level: AdapterLevel): level is ShownLevel {
  return (SHOWN_LEVELS as readonly string[]).includes(level);
}

export interface AdapterLevelBadgeProps {
  level: AdapterLevel;
  /** Show the capability sentence beside the badge, not only as its accessible description. */
  withDescription?: boolean;
}

/** `A0`/`A1` with what CauseDeck can read for the forum; nothing for levels not yet offered. */
export function AdapterLevelBadge({ level, withDescription = false }: AdapterLevelBadgeProps) {
  const t = useTranslations('courts.levels');
  if (!isShown(level)) return null;
  const description = t(level);
  return (
    <span data-adapter-level={level} className="inline-flex items-center gap-2">
      <Badge tone={level === 'A1' ? 'accent' : 'neutral'} title={description}>
        <span aria-hidden="true">{level}</span>
        <span className="sr-only">{t('label', { level })}</span>
      </Badge>
      {withDescription ? (
        <span data-slot="adapter-level-description" className="text-ink-muted text-xs">
          {description}
        </span>
      ) : (
        <span className="sr-only">{description}</span>
      )}
    </span>
  );
}
