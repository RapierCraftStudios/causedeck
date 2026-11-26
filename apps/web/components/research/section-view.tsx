'use client';
// A statute section (#1126, part 4 of #1116; D-053, D-001 amended / ADR 0051): the text in force with
// its synthetic or public-domain label, the version history, the counterpart in the other code (from
// `CODE_MAP` through the statutes service, never guessed) and the judgments that cite it, each
// linking the court PDF at the cited page. Titles are the masked form the corpus serves; no
// editorial text, no AI and no iframe.
import type {
  SectionAuthority,
  SectionHistoryView,
  SectionVersionView,
  SectionView as SectionViewData,
} from '@causedeck/core/statutes';
import { citableReference, courtLabel } from '@causedeck/intelligence/citation-display';
import { useTranslations } from 'next-intl';

export interface SectionViewProps {
  slug: string;
  section: SectionViewData;
  history: SectionHistoryView | null;
  authorities: SectionAuthority[];
}

type Level = 'supreme_court' | 'high_court' | 'other';

function levelOf(level: string | null): Level | null {
  return level === 'supreme_court' || level === 'high_court' || level === 'other' ? level : null;
}

/** The statute page path for an act key or short name and a section key. */
export function statutePath(slug: string, act: string, section: string): string {
  return `/w/${slug}/research/statutes/${encodeURIComponent(act)}/${encodeURIComponent(section)}`;
}

/** `code of criminal procedure` -> `Code Of Criminal Procedure` (counterparts carry only the key). */
function actLabel(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SectionView({ slug, section, history, authorities }: SectionViewProps) {
  const t = useTranslations('research');
  const versions = history?.versions ?? [];
  // A repealed section has no version in force today: show the last text it had, marked as such.
  const latest: SectionVersionView | null = versions.at(-1) ?? null;
  const shown = section.version ?? latest;
  const repealed = section.version === null && latest !== null;

  return (
    <div className="flex flex-col gap-6" data-slot="section-view">
      <section className="flex flex-col gap-2" aria-labelledby="section-text-heading">
        <h2 id="section-text-heading" className="text-lg font-medium">
          {t('statutes.section.textHeading')}
        </h2>
        {shown === null ? (
          <p className="text-muted-foreground text-sm" data-slot="section-no-text">
            {t('statutes.section.noText')}
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <p className="text-muted-foreground text-xs" data-slot="section-label">
              <span className="font-medium">
                {shown.synthetic
                  ? t('statutes.section.syntheticLabel')
                  : t('statutes.section.publicDomainLabel')}
              </span>
              {' · '}
              {shown.sourceNote}
            </p>
            {repealed && shown.validTo !== null ? (
              <p className="text-muted-foreground text-xs" data-slot="section-repealed">
                {t('statutes.section.notInForceSince', { date: shown.validTo })}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t('statutes.section.inForce', { from: shown.validFrom })}
              </p>
            )}
            <p className="whitespace-pre-wrap" data-slot="section-text">
              {shown.text}
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="section-history-heading">
        <h2 id="section-history-heading" className="text-lg font-medium">
          {t('statutes.history.heading')}
        </h2>
        {versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('statutes.history.empty')}</p>
        ) : (
          <ol className="flex flex-col gap-2" data-slot="section-history">
            {versions.map((v) => (
              <li key={v.validFrom} className="border-l-2 pl-2 text-sm">
                <p className="font-medium tabular-nums">
                  {v.validTo === null
                    ? t('statutes.history.current', { from: v.validFrom })
                    : t('statutes.history.range', { from: v.validFrom, to: v.validTo })}
                </p>
                {v.amendedBy === null ? null : (
                  <p className="text-muted-foreground text-xs">
                    {t('statutes.history.amendedBy', { act: v.amendedBy })}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="section-counterpart-heading">
        <h2 id="section-counterpart-heading" className="text-lg font-medium">
          {t('statutes.counterpart.heading')}
        </h2>
        {section.counterpart.kind === 'recorded' ? (
          <ul className="flex flex-col gap-1 text-sm" data-slot="section-counterpart">
            {section.counterpart.counterparts.map((c) => (
              <li key={`${c.statute}:${c.section}`}>
                <a className="underline" href={statutePath(slug, c.statute, c.section)}>
                  {t('statutes.counterpart.link', {
                    act: actLabel(c.statute),
                    section: c.section.toUpperCase(),
                  })}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm" data-slot="section-no-counterpart">
            {t('statutes.counterpart.none')}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="section-authorities-heading">
        <h2 id="section-authorities-heading" className="text-lg font-medium">
          {t('statutes.authorities.heading')}
        </h2>
        {authorities.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-slot="section-authorities-empty">
            {t('statutes.authorities.empty')}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {authorities.map((a) => {
              const level = levelOf(a.courtLevel);
              return (
                <li
                  key={a.judgmentId}
                  className="rounded-md border p-3 text-sm"
                  data-slot="section-authority"
                >
                  <h3 className="font-medium">
                    {a.title === null || a.title === ''
                      ? t('statutes.authorities.maskedTitle')
                      : a.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {[
                      citableReference(a.neutralCitation, a.caseNumbers),
                      courtLabel(a.court),
                      level === null ? null : t(`search.levels.${level}`),
                      a.judgmentDate === null
                        ? null
                        : t('statutes.authorities.decided', { date: a.judgmentDate }),
                      t('statutes.authorities.page', { page: a.page }),
                    ]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(' · ')}
                  </p>
                  {a.sourceUrl === null ? null : (
                    <a
                      className="mt-2 inline-block underline"
                      href={`${a.sourceUrl}#page=${String(a.page)}`}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {t('statutes.authorities.openPdf', { page: a.page })}
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
