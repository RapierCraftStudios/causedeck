// Helpers over the validators block tree: walk, validate, and collect slots and narratives.
import { BlockTreeSchema, type Block, type SlotResolver } from '@causedeck/validators/drafting';

export type SlotBlock = Extract<Block, { type: 'slot' }>;
export type NarrativeBlock = Extract<Block, { type: 'narrative' }>;

export interface BlockVisit {
  block: Block;
  /** Stable key: the block's own id, else its position path such as `b.1.0`. */
  key: string;
}

export type BlockTreeResult =
  { ok: true; blocks: Block[] } | { ok: false; issues: { path: string; message: string }[] };

export function walkBlocks(
  blocks: readonly Block[],
  visit: (entry: BlockVisit) => void,
  prefix = 'b',
): void {
  blocks.forEach((block, index) => {
    const key = block.id ?? `${prefix}.${String(index)}`;
    visit({ block, key });
    if (block.type === 'section' || block.type === 'list') {
      walkBlocks(block.children, visit, `${prefix}.${String(index)}`);
    }
  });
}

export function validateBlockTree(input: unknown): BlockTreeResult {
  const parsed = BlockTreeSchema.safeParse(input);
  if (parsed.success) return { ok: true, blocks: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export function collectSlots(blocks: readonly Block[]): { key: string; block: SlotBlock }[] {
  const found: { key: string; block: SlotBlock }[] = [];
  walkBlocks(blocks, ({ block, key }) => {
    if (block.type === 'slot') found.push({ key, block });
  });
  return found;
}

export function collectNarratives(
  blocks: readonly Block[],
): { key: string; block: NarrativeBlock }[] {
  const found: { key: string; block: NarrativeBlock }[] = [];
  walkBlocks(blocks, ({ block, key }) => {
    if (block.type === 'narrative') found.push({ key, block });
  });
  return found;
}

export function blockKeys(blocks: readonly Block[]): string[] {
  const keys: string[] = [];
  walkBlocks(blocks, ({ key }) => keys.push(key));
  return keys;
}

export type { Block, SlotResolver };
