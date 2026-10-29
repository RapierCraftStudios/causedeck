import { Badge } from '@causedeck/ui/badge';

import { legalChrome } from '../../lib/legal-chrome.ts';

/** Shown on every page whose status is `draft`; uses the warning role. */
export function DraftBanner() {
  const chrome = legalChrome();
  return (
    <div
      role="note"
      className="border-warning bg-warning-soft text-ink mb-8 flex items-center gap-3 rounded-md border px-4 py-3 print:hidden"
    >
      <Badge tone="warning">{chrome.draftBadge}</Badge>
      <p className="font-medium">{chrome.draftBanner}</p>
    </div>
  );
}
