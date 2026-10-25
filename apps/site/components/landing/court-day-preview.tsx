'use client';

// Non-interactive, illustrative Court-Day Board (#90): halls as columns, item chips, a Stage Badge
// per chip, a Provenance Chip over a quoted order line, and a brief sheet behind. Built from the
// real @causedeck/ui patterns with fictional data. It is hidden from assistive tech and inert; the
// adjacent text description (hero.tsx) carries the meaning.
import { CourtItemChip, ProvenanceChip } from '@causedeck/ui/patterns';

import {
  SAMPLE_BOARD,
  SAMPLE_LABEL,
  landingCopy,
  type LandingLocale,
} from '../../content/landing.ts';

export function CourtDayPreview({ locale = 'en' }: { locale?: LandingLocale }) {
  const copy = landingCopy(locale);
  return (
    <figure className="cd-board relative m-0" data-testid="court-day-preview">
      <div aria-hidden="true" inert className="relative">
        <div className="cd-board-brief border-line bg-surface-sunken absolute inset-x-6 -top-3 -bottom-3 rounded-2xl border" />
        <div className="cd-board-layer border-line bg-surface-raised relative rounded-2xl border p-4 shadow-sm">
          <div className="cd-snap-strip flex gap-4 md:grid md:grid-cols-2">
            {SAMPLE_BOARD.map((column) => (
              <section key={column.court} className="cd-snap-item min-w-[17rem] flex-1 space-y-3">
                <h3 className="text-ink-muted text-xs font-medium tracking-wide uppercase">
                  {column.court}
                </h3>
                {column.items.map((item) => (
                  <div
                    key={item.itemNo}
                    className={`border-line bg-surface space-y-2 rounded-xl border p-3 ${
                      item.changed === true ? 'cd-changed' : ''
                    }`}
                  >
                    <CourtItemChip
                      itemNo={item.itemNo}
                      hall={item.hall}
                      stage={item.stage}
                      time={item.time}
                    />
                    <p className="text-ink font-serif text-sm font-medium">{item.parties}</p>
                    <p className="text-ink-muted text-xs tabular-nums">{item.caseNo}</p>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <div className="cd-board-quote border-line bg-surface mt-4 flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <p className="text-ink min-w-0 flex-1 font-serif text-sm">
              &ldquo;{copy.provenance.quote}&rdquo;
            </p>
            <ProvenanceChip
              tabIndex={-1}
              source={{
                kind: 'document',
                label: copy.provenance.source,
                quote: copy.provenance.quote,
                page: 2,
                state: 'confirmed',
              }}
            />
          </div>
        </div>
      </div>
      <figcaption className="text-ink-subtle mt-3 text-xs">{SAMPLE_LABEL}</figcaption>
    </figure>
  );
}
