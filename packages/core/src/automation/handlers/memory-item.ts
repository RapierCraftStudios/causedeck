// `memory_item` (#72): a proposed memory of the lawyer (a rule from a repeated edit, an alias from a
// correction, a preference). Always an L2 proposal: accepting it is the lawyer's confirmation, and
// saves through the memory domain's confirm path (`acceptMemoryDraft`), the only way a proposal
// becomes a `memory_item`. Undo deletes the saved item (its value goes at once).
import { EnvKeyProvider } from '@causedeck/storage';
import { MemoryProposalInput } from '@causedeck/validators';
import { serverEnv } from '@causedeck/config/env';
import type { z } from 'zod';

import { acceptMemoryDraft, deleteMemory, type MemoryDeps } from '../../memory/index.ts';
import { conflict } from '../../shared/errors.ts';
import type { HandlerScope, ProposalHandler } from '../types.ts';

import { parsePayload } from './common.ts';

type Payload = z.output<typeof MemoryProposalInput>;

let keys: EnvKeyProvider | undefined;

function memoryDeps(scope: HandlerScope): MemoryDeps {
  return { db: scope.tx, keys: (keys ??= EnvKeyProvider.fromEnv(serverEnv())), now: scope.now };
}

export const memoryItemHandler: ProposalHandler<Payload> = {
  kind: 'memory_item',
  enabled: true,
  validate: (payload) => parsePayload(MemoryProposalInput, payload),

  async apply(scope, ctx) {
    const actor = { userId: scope.actor.userId, workspaceId: scope.actor.workspaceId };
    const item = await acceptMemoryDraft(memoryDeps(scope), actor, ctx.payload);
    return {
      undoPayload: { itemId: item.id },
      entityRefs: { memoryItemIds: [item.id], matterId: item.matterId },
      summary: 'Saved a memory',
      matterId: item.matterId,
    };
  },

  async undo(scope, activity) {
    const itemId = activity.undoPayload?.['itemId'];
    if (typeof itemId !== 'string') throw conflict('The memory item id is missing');
    const actor = { userId: scope.actor.userId, workspaceId: scope.actor.workspaceId };
    await deleteMemory(memoryDeps(scope), actor, itemId);
  },
};
