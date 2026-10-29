// Non-interactive, illustrative Court-Day Board (#90): halls as columns, item chips, a Stage Badge
// per chip, a source capsule over a quoted order line, and a brief sheet behind. It is a server
// component: the real StageBadge (no client code) plus static markup in the chips' look. The
// interactive CourtItemChip and ProvenanceChip are not used because they pull the popover and
// drawer runtime (about a third of the page's JavaScript) into a board that is inert and
// aria-hidden. The adjacent text description (hero.tsx) carries the meaning.
import { StageBadge } from '@causedeck/ui/patterns/stage-badge';

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
                <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">
                  {column.court}
                </p>
                {column.items.map((item) => (
                  <div
                    key={item.itemNo}
                    className={`border-line bg-surface space-y-2 rounded-xl border p-3 ${
                      item.changed === true ? 'cd-changed' : ''
                    }`}
                  >
                    <div className="border-line bg-surface-raised text-ink-muted inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full border py-1 ps-3 pe-1.5 font-sans text-sm">
                      <span className="text-ink font-medium tabular-nums">Item {item.itemNo}</span>
                      <span className="text-ink-subtle">·</span>
                      <span className="min-w-0 wrap-break-word">{item.hall}</span>
                      <StageBadge stage={item.stage} />
                      <span className="tabular-nums">{item.time}</span>
                    </div>
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
            <span className="border-line bg-surface-sunken text-ink-muted inline-flex min-h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2 font-sans text-xs font-medium">
              <span className="border-seal bg-seal size-1.5 shrink-0 rounded-full border" />
              {copy.provenance.source}, p. 2
            </span>
          </div>
        </div>
      </div>
      <figcaption className="text-ink-subtle mt-3 text-xs">{SAMPLE_LABEL}</figcaption>
    </figure>
  );
}
