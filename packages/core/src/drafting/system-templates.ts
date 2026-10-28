// Seeds the system drafting templates (#76): the registry from `@causedeck/drafting`, written by the
// owner role through `@causedeck/db/seed/system-templates` (db may not import drafting; core may import
// both). Run by `scripts/seed-system-templates.ts` after the migrations, on every deploy. Not part of
// the domain's public surface: no request path may write a system template.
import { SYSTEM_TEMPLATES } from '@causedeck/drafting';
import type { Database } from '@causedeck/db';
import {
  seedSystemTemplates,
  type SystemTemplateSeedResult,
} from '@causedeck/db/seed/system-templates';

export function seedDraftingSystemTemplates(ownerDb: Database): Promise<SystemTemplateSeedResult> {
  return seedSystemTemplates(ownerDb, SYSTEM_TEMPLATES);
}
