import type { Block, SlotResolver } from '@causedeck/validators/drafting';

import { exportBlockers, type Facts } from '../slots';

/** Text of one narrative block, with whether a model wrote it and a human has since rewritten it. */
export interface NarrativeText {
  text: string;
  modelDrafted: boolean;
  rewritten: boolean;
}

export interface RenderOptions {
  /** Narrative text by block key. */
  narratives?: Readonly<Record<string, NarrativeText>>;
  /** `true`, or the resolvers the user accepted as missing. */
  acknowledgeMissing?: boolean | readonly SlotResolver[];
  /** A visible notice printed above the document, e.g. the scaffold banner of an unreviewed template. */
  banner?: string;
  /** Content language: Tamil and Kannada switch the DOCX complex-script font (PDF follows the script). */
  locale?: 'en' | 'kn' | 'ta';
}

/** Shown on every export of a system template until its `reviewed_by` is set. */
export const SCAFFOLD_BANNER = 'Scaffold: review before use';

export class MissingSlotsError extends Error {
  constructor(readonly slots: readonly { key: string; resolver: SlotResolver }[]) {
    super(`export blocked by unresolved slots: ${slots.map((s) => s.resolver).join(', ')}`);
    this.name = 'MissingSlotsError';
  }
}

export function assertExportable(
  blocks: readonly Block[],
  facts: Facts,
  opts: RenderOptions,
): void {
  const blockers = exportBlockers(blocks, facts, opts.acknowledgeMissing ?? false);
  if (blockers.length > 0) throw new MissingSlotsError(blockers);
}

/** True only when a model-drafted narrative block is still unrewritten. */
export function isAiAssisted(blocks: readonly Block[], opts: RenderOptions): boolean {
  const used = new Set<string>();
  const collect = (list: readonly Block[], prefix: string): void => {
    list.forEach((b, i) => {
      const key = b.id ?? `${prefix}.${String(i)}`;
      if (b.type === 'narrative') used.add(key);
      if (b.type === 'section' || b.type === 'list') collect(b.children, `${prefix}.${String(i)}`);
    });
  };
  collect(blocks, 'b');
  return [...used].some((key) => {
    const n = opts.narratives?.[key];
    return n !== undefined && n.modelDrafted && !n.rewritten;
  });
}
