// The v1 system template registry (#76): stable code, semantic version, checksum and block tree per
// template. The db seed upserts these as `template` rows with a null `workspace_id`.
import type { SystemTemplateSeed } from '@causedeck/validators/drafting';

import { adjournmentNoteA0 } from './generic-a0/adjournment-note';
import { counselCoveringLetterA0 } from './generic-a0/counsel-covering-letter';
import { clientCoveringLetterA0 } from './generic-a0/client-covering-letter';
import { counselCoveringLetterKarnataka } from './karnataka-hc/counsel-covering-letter';
import { certifiedCopyApplicationKarnataka } from './karnataka-hc/certified-copy-application';
import { clientCoveringLetterKarnataka } from './karnataka-hc/client-covering-letter';
import { earlyListingMemoKarnataka } from './karnataka-hc/early-listing-memo';
import { memoOfAppearanceKarnataka } from './karnataka-hc/memo-of-appearance';
import { mentionMemoKarnataka } from './karnataka-hc/mention-memo';
import { counselCoveringLetterMadras } from './madras-hc/counsel-covering-letter';
import { certifiedCopyApplicationMadras } from './madras-hc/certified-copy-application';
import { clientCoveringLetterMadras } from './madras-hc/client-covering-letter';
import { earlyListingMemoMadras } from './madras-hc/early-listing-memo';
import { memoOfAppearanceMadras } from './madras-hc/memo-of-appearance';
import { mentionMemoMadras } from './madras-hc/mention-memo';

export const SYSTEM_TEMPLATES: readonly SystemTemplateSeed[] = [
  mentionMemoMadras,
  earlyListingMemoMadras,
  memoOfAppearanceMadras,
  certifiedCopyApplicationMadras,
  clientCoveringLetterMadras,
  counselCoveringLetterMadras,
  mentionMemoKarnataka,
  earlyListingMemoKarnataka,
  memoOfAppearanceKarnataka,
  certifiedCopyApplicationKarnataka,
  clientCoveringLetterKarnataka,
  counselCoveringLetterKarnataka,
  adjournmentNoteA0,
  clientCoveringLetterA0,
  counselCoveringLetterA0,
];

export function systemTemplate(code: string): SystemTemplateSeed | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.code === code);
}
