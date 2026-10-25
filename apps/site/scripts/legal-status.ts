// Production gate (#95): the build fails while any legal page is still `status: draft`, unless
// ALLOW_DRAFT_LEGAL=1 (staging and preview only). Runs first in `build`.
//   tsx scripts/legal-status.ts
import { pathToFileURL } from 'node:url';

import { draftSlugs, loadAllLegalPages } from '../lib/legal.ts';

export function checkLegalStatus(
  drafts: string[],
  allowDraft: string | undefined,
): { ok: boolean; message: string } {
  if (drafts.length === 0) return { ok: true, message: 'All legal pages are final.' };
  if (allowDraft === '1') {
    return {
      ok: true,
      message: `Draft legal pages allowed (ALLOW_DRAFT_LEGAL=1): ${drafts.join(', ')}`,
    };
  }
  return {
    ok: false,
    message: `Legal pages still marked draft: ${drafts.join(', ')}. Counsel must approve them, or set ALLOW_DRAFT_LEGAL=1 for staging and preview builds only.`,
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // eslint-disable-next-line no-process-env -- build-time switch, set only in staging and preview.
  const allowDraft = process.env.ALLOW_DRAFT_LEGAL;
  const result = checkLegalStatus(draftSlugs(await loadAllLegalPages()), allowDraft);
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
