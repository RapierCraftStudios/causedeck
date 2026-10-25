// `new_matter` (#47): create a matter with `createMatter`. Undo archives it (a matter is never
// deleted by an undo: documents or people may have been attached since).
import { z } from 'zod';

import { archiveMatter, createMatter } from '../../matter-graph/index.ts';
import { conflict } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { parsePayload } from './common.ts';

const Payload = z.strictObject({
  title: z.string().trim().min(1),
  practiceArea: z.string().trim().min(1).nullable().optional(),
  synopsis: z.string().nullable().optional(),
  sensitive: z.boolean().optional(),
});
type Payload = z.output<typeof Payload>;

export const newMatterHandler: ProposalHandler<Payload> = {
  kind: 'new_matter',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const row = await createMatter(scope.deps, scope.actor, ctx.payload);
    return {
      undoPayload: { matterId: row.id },
      entityRefs: { matterId: row.id },
      summary: 'Created a matter',
      matterId: row.id,
    };
  },

  async undo(scope, activity) {
    const matterId = activity.undoPayload?.['matterId'];
    if (typeof matterId !== 'string') throw conflict('Nothing to undo: the matter id is missing');
    await archiveMatter(scope.deps, scope.actor, { matterId });
  },
};
