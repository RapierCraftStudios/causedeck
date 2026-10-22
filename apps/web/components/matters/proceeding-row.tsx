'use client';
// One row of the proceedings tree (#392, #40 part 4): the formatted case number
// (`W.P. No. 12345 of 2026`), or the case type with an `Unnumbered` badge while it is at the SR/FR
// stage; the forum, the stage (`StageBadge`), the state as a word, the SR/FR/diary/filing/CNR
// chips (the CNR has a copy button), the next date and its links (appeal from, connected, lower
// court; a link into another matter the member may read opens it). Members who may write get
// `Edit` and the state-transition menu; in split mode a checkbox selects the row. Only the active
// row's controls are in the tab order (the tree's roving tabindex).
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import { ChevronDown, ChevronRight, Copy, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type {
  ProceedingLinkRowView,
  ProceedingRowView,
} from '../../lib/matters/proceedings-view.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';
import { MatterStage } from './matter-card.tsx';
import { StateTransitionMenu, type TransitionProceedingAction } from './state-transition-menu.tsx';

export interface ProceedingRowProps {
  row: ProceedingRowView;
  workspaceId: string;
  slug: string;
  /** The tree's active row: its controls are tabbable. */
  active: boolean;
  offline: boolean;
  /** `matter.write`: Edit and the state menu. */
  canWrite: boolean;
  transition: TransitionProceedingAction;
  onEdit?: (row: ProceedingRowView) => void;
  /** Split mode: the row's checkbox. */
  selecting?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** A row with children: whether they show, and the expand/collapse control's handler. */
  expanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
}

function useLinkLabel() {
  const t = useTranslations('matters.workspace.proceedingsTab.links');
  return (link: ProceedingLinkRowView) => {
    const label = link.otherLabel ?? t('anotherMatter');
    switch (link.kind) {
      case 'appeal_from':
        return link.direction === 'from' ? t('appealFrom', { label }) : t('appealedIn', { label });
      case 'lower_court':
        return link.direction === 'from'
          ? t('lowerCourt', { label })
          : t('lowerCourtOf', { label });
      case 'parent_of':
        return t('parentOf', { label });
      default:
        return t('connected', { label });
    }
  };
}

export function ProceedingRow({
  row,
  workspaceId,
  slug,
  active,
  offline,
  canWrite,
  transition,
  onEdit,
  selecting = false,
  selected = false,
  onSelectedChange,
  expanded,
  onToggle,
}: ProceedingRowProps) {
  const t = useTranslations('matters.workspace');
  const announce = useMatterAnnounce();
  const linkLabel = useLinkLabel();
  const tabIndex = active ? 0 : -1;
  // An unnumbered row shows its case type alone (muted); the `Unnumbered` badge says the rest.
  const title =
    row.caseNumber === null ? row.caseType : t('proceedings.caseNumber', { ...row.caseNumber });
  // Accent is kept for the next date and primary actions; only the states that need the
  // lawyer's attention (defects to cure, a re-presentation pending) are tinted, always with a word.
  const stateTone = row.state === 'defects' || row.state === 're_presented' ? 'warning' : 'neutral';
  const chips = [
    row.srNo === null
      ? null
      : { key: 'sr', text: t('proceedingsTab.chips.sr', { value: row.srNo }) },
    row.frNo === null
      ? null
      : { key: 'fr', text: t('proceedingsTab.chips.fr', { value: row.frNo }) },
    row.diaryNo === null
      ? null
      : { key: 'diary', text: t('proceedingsTab.chips.diary', { value: row.diaryNo }) },
    row.filingNo === null
      ? null
      : { key: 'filing', text: t('proceedingsTab.chips.filing', { value: row.filingNo }) },
  ].filter((chip) => chip !== null);

  async function copyCnr(cnr: string) {
    try {
      await navigator.clipboard.writeText(cnr);
      announce(t('proceedingsTab.chips.copied'));
    } catch {
      // No clipboard (insecure context): the CNR stays selectable text.
    }
  }

  return (
    <div
      data-proceeding-row={row.id}
      data-state={row.state}
      data-selected={selecting && selected ? '' : undefined}
      className={`flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md ${
        selecting && selected ? 'bg-accent-soft' : ''
      }`}
    >
      {onToggle === undefined ? (
        // Children-less rows keep their case numbers aligned with the ones that have a toggle.
        <span aria-hidden="true" className="w-8 shrink-0" />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={tabIndex}
          data-toggle-children={row.id}
          aria-label={
            expanded === true
              ? t('proceedingsTab.collapse', { label: row.label })
              : t('proceedingsTab.expand', { label: row.label })
          }
          onClick={onToggle}
          className="shrink-0 px-2"
        >
          {expanded === true ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          )}
        </Button>
      )}
      {selecting ? (
        <Checkbox
          data-split-select={row.id}
          tabIndex={tabIndex}
          checked={selected}
          aria-label={t('proceedingsTab.selectRow', { label: row.label })}
          onCheckedChange={(value) => onSelectedChange?.(value === true)}
          className="mt-1"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1 max-md:basis-[calc(100%-3rem)]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-case-number=""
            className={row.caseNumber === null ? 'text-ink-muted' : 'font-medium tabular-nums'}
          >
            {title}
          </span>
          {row.unnumbered ? (
            <Badge tone="warning" data-unnumbered="">
              {t('proceedingsTab.unnumbered')}
            </Badge>
          ) : null}
          <Badge tone={stateTone} data-state-badge={row.state}>
            {t(`proceedings.states.${row.state}`)}
          </Badge>
          <MatterStage stage={row.stage} />
        </div>
        <p className="text-ink-muted text-sm">{row.forum}</p>
        <p
          data-row-next-date=""
          className={
            row.nextDate === null ? 'text-ink-muted text-sm' : 'text-sm font-medium tabular-nums'
          }
        >
          {row.nextDate === null
            ? t('proceedingsTab.noNextDate')
            : t('proceedingsTab.nextDate', {
                date: `${row.nextDate.text} (${row.nextDate.relative})`,
              })}
        </p>
        {chips.length > 0 || row.cnr !== null ? (
          <ul className="flex flex-wrap items-center gap-1.5" data-chips="">
            {chips.map((chip) => (
              <li key={chip.key}>
                <Badge tone="neutral" className="tabular-nums">
                  {chip.text}
                </Badge>
              </li>
            ))}
            {row.cnr === null ? null : (
              <li className="inline-flex items-center gap-0.5">
                <Badge tone="neutral" className="font-mono tabular-nums select-all">
                  {t('proceedingsTab.chips.cnr', { value: row.cnr })}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  tabIndex={tabIndex}
                  data-copy-cnr={row.cnr}
                  aria-label={t('proceedingsTab.chips.copyCnr', { value: row.cnr })}
                  onClick={() => void copyCnr(row.cnr ?? '')}
                >
                  <Copy aria-hidden="true" className="size-3.5" />
                </Button>
              </li>
            )}
          </ul>
        ) : null}
        {row.links.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" data-links="">
            {row.links.map((link) => (
              <li key={`${link.linkId}-${link.direction}`} data-link-kind={link.kind}>
                {link.otherMatterId === null ? (
                  <span className="text-ink-muted text-sm">{linkLabel(link)}</span>
                ) : (
                  <Link
                    tabIndex={tabIndex}
                    href={`/w/${encodeURIComponent(slug)}/matters/${encodeURIComponent(link.otherMatterId)}/proceedings`}
                    className="text-accent inline-flex items-center text-sm underline underline-offset-2 pointer-coarse:min-h-11"
                    aria-label={`${linkLabel(link)}. ${t('proceedingsTab.links.openMatter')}`}
                  >
                    {linkLabel(link)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {canWrite && !selecting ? (
        <div className="flex items-center gap-1 max-md:ms-10" data-row-actions="">
          {onEdit === undefined ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tabIndex={tabIndex}
              data-edit-proceeding={row.id}
              aria-label={t('proceedingsTab.edit', { label: row.label })}
              disabled={offline}
              onClick={() => {
                onEdit(row);
              }}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </Button>
          )}
          <StateTransitionMenu
            workspaceId={workspaceId}
            proceedingId={row.id}
            label={row.label}
            state={row.state}
            transitions={row.transitions}
            action={transition}
            offline={offline}
            tabIndex={tabIndex}
          />
        </div>
      ) : null}
    </div>
  );
}
