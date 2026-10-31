'use client';
// The matter's "Find authorities" action (#896): asks the server for the query seeded from the
// matter's research facts (confirmed statutes and sections, the court, issue words for roles that may
// read strategy; never a party name or the CNR) and opens the search page with it filled in. The
// search itself runs only when the member presses Search.
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

export interface FindAuthoritiesButtonProps {
  workspaceId: string;
  workspaceSlug: string;
  matterId: string;
  action: (raw: unknown) => Promise<{ ok: true; data: { query: string } } | { ok: false }>;
}

export function FindAuthoritiesButton({
  workspaceId,
  workspaceSlug,
  matterId,
  action,
}: FindAuthoritiesButtonProps) {
  const t = useTranslations('research.search.matter');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  function open(): void {
    start(async () => {
      const result = await action({ workspaceId, matterId });
      setFailed(!result.ok);
      if (result.ok) {
        const q = result.data.query === '' ? '' : `?q=${encodeURIComponent(result.data.query)}`;
        router.push(`/w/${encodeURIComponent(workspaceSlug)}/research${q}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button type="button" variant="outline" disabled={pending} onClick={open}>
          {t('button')}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t('hint')}</p>
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          {t('failed')}
        </p>
      ) : null}
    </div>
  );
}
