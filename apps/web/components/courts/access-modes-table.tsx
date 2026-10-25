'use client';

// The access modes of a forum's adapter (#400, #42; ADR 0015): one row per resource from the
// access-mode registry with its mode and counsel's note. A row without a note is tagged "Legal
// review pending"; a `user_supplied` row says what the lawyer does ("Share the list or forward the
// court email"). Notes are counsel-authored text, shown as written.
import type { ForumAccessMode } from '@causedeck/core/court';
import { Badge } from '@causedeck/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { useTranslations } from 'next-intl';

/** Registry resources with a label; any other resource shows as stored. */
const KNOWN_RESOURCES = [
  'cause_list',
  'case_status',
  'orders',
  'display_board',
  'a2_retrieval',
  'live_tracking',
  'sanctioned_push',
] as const;

type KnownResource = (typeof KNOWN_RESOURCES)[number];

/** `case-status` and `case_status` are the same resource; the label key uses underscores. */
export function resourceKey(resource: string): KnownResource | null {
  const key = resource.trim().toLowerCase().replaceAll('-', '_');
  return (KNOWN_RESOURCES as readonly string[]).includes(key) ? (key as KnownResource) : null;
}

export interface AccessModesTableProps {
  modes: readonly ForumAccessMode[];
}

export function AccessModesTable({ modes }: AccessModesTableProps) {
  const t = useTranslations('courts.detail.accessModes');
  return (
    <section data-slot="access-modes" className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{t('title')}</h2>
      {modes.length === 0 ? (
        <p className="text-ink-muted text-sm" data-access-modes-empty="">
          {t('empty')}
        </p>
      ) : (
        <Table>
          <TableCaption>{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('resource')}</TableHead>
              <TableHead scope="col">{t('mode')}</TableHead>
              <TableHead scope="col">{t('note')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modes.map((row) => {
              const key = resourceKey(row.resource);
              return (
                <TableRow key={row.resource} data-access-resource={row.resource}>
                  <TableHead scope="row" className="font-normal">
                    {key === null ? row.resource : t(`resources.${key}`)}
                  </TableHead>
                  <TableCell data-access-mode={row.mode}>
                    <span className="flex flex-col gap-0.5">
                      <span>{t(`modes.${row.mode}`)}</span>
                      {row.mode === 'user_supplied' ? (
                        <span className="text-ink-muted text-xs" data-access-help="">
                          {t('userSuppliedHelp')}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.legalReviewPending ? (
                      <Badge tone="warning" data-legal-review-pending="">
                        {t('legalReviewPending')}
                      </Badge>
                    ) : (
                      <span className="whitespace-pre-line">{row.counselNote}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
