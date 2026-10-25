'use client';
// The matter header (#390, #40 design spec): (1) the serif title, clamped to two lines on phones,
// then the client chips, the status (a word, never colour alone), the owner and the `Sensitive`
// lock badge. Sticky under the topbar, with a breadcrumb back to the list from 1280 px. The matter
// menu exists only when the role has an action in it: today the sensitive toggle for owners and
// advocates (`matter.restrict`); viewers and clerks get no menu at all.
import { Badge } from '@causedeck/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@causedeck/ui/dropdown-menu';
import { Lock, LockOpen, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { MatterOverviewView } from '../../lib/matters/workspace.ts';

import { SensitiveBadge } from './matter-card.tsx';
import { useOnline } from './matters-offline-banner.tsx';
import { SensitiveDialog, type SetSensitiveAction } from './sensitive-toggle.tsx';

export interface MatterHeaderProps {
  matter: Pick<MatterOverviewView, 'id' | 'title' | 'status' | 'sensitive' | 'owner' | 'clients'>;
  workspaceId: string;
  listHref: string;
  /** `matter.restrict` (owners, advocates): the sensitive toggle. */
  canRestrict: boolean;
  setSensitiveAction: SetSensitiveAction;
}

// Indigo is kept for the next date and the primary action (design language: one accent), so the
// status is a neutral chip with its word.
const STATUS_TONE = { active: 'neutral', disposed: 'outline', archived: 'outline' } as const;

export function MatterHeader({
  matter,
  workspaceId,
  listHref,
  canRestrict,
  setSensitiveAction,
}: MatterHeaderProps) {
  const t = useTranslations('matters.workspace');
  const online = useOnline();
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <header
      data-slot="matter-header"
      className="bg-surface z-sticky sticky top-0 flex flex-col gap-2 py-2"
    >
      <nav aria-label={t('breadcrumb')} className="max-xl:hidden">
        <Link href={listHref} className="text-ink-muted text-sm underline-offset-4 hover:underline">
          {t('breadcrumb')}
        </Link>
      </nav>
      <div className="flex items-start justify-between gap-3">
        <h1
          data-matter-title=""
          className="font-serif text-2xl font-medium wrap-break-word max-md:line-clamp-2"
        >
          {matter.title}
        </h1>
        {canRestrict ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                aria-label={t('menu.label')}
                data-matter-menu=""
                className="focus-visible:outline-ring hover:bg-surface-sunken flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:outline-2"
              >
                <MoreHorizontal aria-hidden="true" className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-sensitive-toggle=""
                onSelect={() => {
                  setDialogOpen(true);
                }}
              >
                {matter.sensitive ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
                {matter.sensitive ? t('menu.removeSensitive') : t('menu.markSensitive')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Badge tone={STATUS_TONE[matter.status]} data-matter-status={matter.status}>
          {t(`status.${matter.status}`)}
        </Badge>
        {matter.sensitive ? <SensitiveBadge /> : null}
        {matter.clients.length === 0 ? null : (
          <span className="flex flex-wrap items-center gap-1.5" aria-label={t('clients')}>
            {matter.clients.map((client) => (
              <Badge key={client.id} tone="neutral" data-matter-client="">
                {client.name}
              </Badge>
            ))}
          </span>
        )}
        <span className="text-ink-muted">
          {matter.owner === null ? t('noOwner') : t('owner', { name: matter.owner })}
        </span>
      </div>
      {canRestrict ? (
        <SensitiveDialog
          workspaceId={workspaceId}
          matterId={matter.id}
          sensitive={matter.sensitive}
          action={setSensitiveAction}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          offline={!online}
          returnFocus={() => triggerRef.current}
        />
      ) : null}
    </header>
  );
}
