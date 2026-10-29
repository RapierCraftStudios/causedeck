'use client';
// Print only (#85): the report leaves the screen through the browser's print dialog; no data is sent.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';

export function PrintButton() {
  const t = useTranslations('insights');
  return (
    <Button
      type="button"
      onClick={() => {
        window.print();
      }}
      className="print:hidden"
    >
      {t('report.print')}
    </Button>
  );
}
