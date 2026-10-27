// M5 playbooks (#901): the lawyer's preferred court format, standard prayers and annexure order,
// stored as one M5 `memory_item` (key `M5.playbook`). Create and update go through the same
// confirm-before-save path as every memory: `proposePlaybook` files a proposal, `confirmPlaybook`
// saves it (and retires the playbook it replaces); nothing is written without that confirmation.
// The value is a list of tagged lines, because a memory value holds only flat strings.
import { Playbook, PlaybookSchema, type MemoryProposal } from '@causedeck/validators';
import { schema } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../../shared/errors.ts';
import { confirmMemory, deleteMemory } from '../confirm.ts';
import { parseMemoryInput, proposeMemory } from '../propose.ts';
import {
  canWriteMemory,
  inScope,
  opener,
  readablePredicate,
  requireRole,
  type MemoryActor,
  type MemoryDeps,
} from '../scope.ts';

const { memoryItem, memoryProposal, memoryEmbedding } = schema;

const TAGS = ['name', 'court', 'format', 'prayer', 'annexure'] as const;

/** A playbook as the flat list of `tag: text` lines a memory value stores. */
export function playbookToValue(playbook: Playbook): string[] {
  return [
    `name: ${playbook.name}`,
    `court: ${playbook.courtId ?? '-'}`,
    `format: ${playbook.format}`,
    ...playbook.standardPrayers.map((p) => `prayer: ${p}`),
    ...playbook.annexureOrder.map((a) => `annexure: ${a}`),
  ];
}

export function playbookFromValue(value: unknown): Playbook {
  if (!Array.isArray(value)) throw invalid('Not a playbook value');
  const lines = new Map<string, string[]>(TAGS.map((t) => [t, []]));
  for (const line of value) {
    const at = typeof line === 'string' ? line.indexOf(': ') : -1;
    const tag = at < 0 ? '' : String(line).slice(0, at);
    if (!lines.has(tag)) throw invalid('Not a playbook value');
    lines.get(tag)?.push(String(line).slice(at + 2));
  }
  const court = lines.get('court')?.[0];
  return PlaybookSchema.parse({
    name: lines.get('name')?.[0],
    courtId: court === undefined || court === '-' ? null : court,
    format: lines.get('format')?.[0],
    standardPrayers: lines.get('prayer'),
    annexureOrder: lines.get('annexure'),
  });
}

export interface PlaybookView extends Playbook {
  itemId: string;
  sharedWithChamber: boolean;
}

/** File a playbook (new or a replacement) for the lawyer to confirm. Null when memory is paused. */
export async function proposePlaybook(
  deps: MemoryDeps,
  actor: MemoryActor,
  input: unknown,
): Promise<MemoryProposal | null> {
  const playbook = parseMemoryInput(PlaybookSchema, input);
  return proposeMemory(deps, actor, {
    key: 'M5.playbook',
    value: playbookToValue(playbook),
    scope: 'user',
    sourceType: 'manual',
    evidence: { playbook: playbook.name },
  });
}

/** Save a playbook proposal; an earlier playbook of the same name and court is retired. */
export async function confirmPlaybook(
  deps: MemoryDeps,
  actor: MemoryActor,
  proposalId: string,
): Promise<PlaybookView> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, async (tx) => {
    const [proposal] = await tx
      .select({ key: memoryProposal.key })
      .from(memoryProposal)
      .where(
        and(
          eq(memoryProposal.workspaceId, actor.workspaceId),
          eq(memoryProposal.id, proposalId),
          eq(memoryProposal.ownerUserId, actor.userId),
        ),
      );
    if (proposal?.key !== 'M5.playbook') throw notFound('Proposal not found');
    const txDeps = { ...deps, db: tx };
    const item = await confirmMemory(txDeps, actor, proposalId);
    const saved = playbookFromValue(item.value);
    const earlier = await tx
      .select({ id: memoryItem.id, ciphertext: memoryItem.valueCiphertext })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.workspaceId, actor.workspaceId),
          eq(memoryItem.key, 'M5.playbook'),
          eq(memoryItem.ownerUserId, actor.userId),
          eq(memoryItem.status, 'active'),
        ),
      );
    for (const row of earlier) {
      if (row.id === item.id || row.ciphertext === null) continue;
      const old = playbookFromValue(open(row.ciphertext));
      if (old.name === saved.name && old.courtId === saved.courtId) {
        await deleteMemory(txDeps, actor, row.id);
      }
    }
    return { ...saved, itemId: item.id, sharedWithChamber: item.sharedWithChamber };
  });
}

/** The playbooks the actor may read (own and chamber-shared). Clerks and viewers are denied. */
export async function listPlaybooks(deps: MemoryDeps, actor: MemoryActor): Promise<PlaybookView[]> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot read playbooks');
  const open = await opener(deps, actor.workspaceId);
  return inScope(deps, actor, async (tx) => {
    const rows = await tx
      .select()
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.workspaceId, actor.workspaceId),
          eq(memoryItem.key, 'M5.playbook'),
          eq(memoryItem.status, 'active'),
          readablePredicate(actor.userId),
        ),
      );
    return rows.flatMap((row) =>
      row.valueCiphertext === null
        ? []
        : [
            {
              ...playbookFromValue(open(row.valueCiphertext)),
              itemId: row.id,
              sharedWithChamber: row.sharedWithChamber,
            },
          ],
    );
  });
}

/** Delete a playbook; its embeddings (none today) go with it. */
export async function deletePlaybook(
  deps: MemoryDeps,
  actor: MemoryActor,
  itemId: string,
): Promise<void> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  await inScope(deps, actor, async (tx) => {
    const [row] = await tx
      .select({ key: memoryItem.key })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.workspaceId, actor.workspaceId),
          eq(memoryItem.id, itemId),
          readablePredicate(actor.userId),
        ),
      );
    if (row?.key !== 'M5.playbook') throw notFound('Playbook not found');
    await deleteMemory({ ...deps, db: tx }, actor, itemId);
    await tx
      .delete(memoryEmbedding)
      .where(
        and(
          eq(memoryEmbedding.workspaceId, actor.workspaceId),
          eq(memoryEmbedding.itemId, itemId),
        ),
      );
  });
}
