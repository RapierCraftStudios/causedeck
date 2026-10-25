// Versions of a draft (#735): a word-level diff and `saveEdit`, which stores the lawyer's text as
// a new `outward_draft_version` and audits `outward.edited`. Tokens split on whitespace only, so a
// Tamil or Kannada word with its combining marks is never cut.
import { schema } from '@causedeck/db';
import { DraftEdit } from '@causedeck/validators/outward-draft';
import { and, desc, eq } from 'drizzle-orm';

import {
  auditOutward,
  inOutwardScope,
  notFoundDraft,
  parseOutwardInput,
  requireOutwardMatter,
  type OutwardActor,
  type OutwardDeps,
} from './context.ts';
import { guardOutward } from './guard.ts';

const { outwardDraft, outwardDraftVersion } = schema;

export interface DiffPart {
  op: 'equal' | 'insert' | 'delete';
  text: string;
}

/** Beyond this many token pairs the diff falls back to one delete and one insert. */
const MAX_CELLS = 4_000_000;

const tokens = (text: string): string[] => text.split(/\s+/u).filter((t) => t.length > 0);

/** Word-level diff of two texts: runs of equal, deleted and inserted words. */
export function diffDraft(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const parts: DiffPart[] = [];
  const push = (op: DiffPart['op'], words: string[]) => {
    if (words.length === 0) return;
    const last = parts[parts.length - 1];
    if (last?.op === op) last.text += ` ${words.join(' ')}`;
    else parts.push({ op, text: words.join(' ') });
  };
  push('equal', a.slice(0, start));
  if (midA.length * midB.length > MAX_CELLS) {
    push('delete', midA);
    push('insert', midB);
  } else {
    // Longest common subsequence table over the changed middle.
    const w = midB.length + 1;
    const lcs = new Uint32Array((midA.length + 1) * w);
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        lcs[i * w + j] =
          midA[i] === midB[j]
            ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
            : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        push('equal', [midA[i] as string]);
        i += 1;
        j += 1;
      } else if (
        j >= midB.length ||
        (i < midA.length && (lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))
      ) {
        push('delete', [midA[i] as string]);
        i += 1;
      } else {
        push('insert', [midB[j] as string]);
        j += 1;
      }
    }
  }
  push('equal', a.slice(endA));
  return parts;
}

export interface SavedEdit {
  versionId: string;
  diff: DiffPart[];
  /** Phrases the guard would have removed; a lawyer's own text is kept and only flagged. */
  warnings: string[];
}

/** Store the lawyer's text as a new version of the draft. */
export async function saveEdit(
  deps: OutwardDeps,
  actor: OutwardActor,
  input: unknown,
): Promise<SavedEdit> {
  const edit = parseOutwardInput(DraftEdit, input);
  return inOutwardScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const [draft] = await tx
      .select()
      .from(outwardDraft)
      .where(
        and(
          eq(outwardDraft.workspaceId, scope.actor.workspaceId),
          eq(outwardDraft.id, edit.draftId),
        ),
      )
      .limit(1)
      .for('update');
    if (draft === undefined) throw notFoundDraft();
    try {
      await requireOutwardMatter(scope, draft.matterId, 'draft.write');
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') throw notFoundDraft();
      throw error;
    }
    const [previous] = await tx
      .select({ body: outwardDraftVersion.body })
      .from(outwardDraftVersion)
      .where(
        and(
          eq(outwardDraftVersion.workspaceId, scope.actor.workspaceId),
          eq(outwardDraftVersion.draftId, draft.id),
        ),
      )
      .orderBy(desc(outwardDraftVersion.createdAt), desc(outwardDraftVersion.id))
      .limit(1);
    const [version] = await tx
      .insert(outwardDraftVersion)
      .values({
        workspaceId: scope.actor.workspaceId,
        draftId: draft.id,
        author: scope.memberId,
        body: edit.body,
        createdAt: scope.now,
      })
      .returning({ id: outwardDraftVersion.id });
    if (version === undefined) throw notFoundDraft();
    if (draft.status === 'drafted') {
      await tx
        .update(outwardDraft)
        .set({ status: 'edited', updatedAt: scope.now })
        .where(
          and(eq(outwardDraft.workspaceId, scope.actor.workspaceId), eq(outwardDraft.id, draft.id)),
        );
    }
    await auditOutward(
      scope,
      'outward.edited',
      { kind: 'outward_draft', id: draft.id },
      {
        versionId: version.id,
      },
    );
    const warnings = guardOutward(edit.body, draft.language).violations.map((v) => v.phrase);
    return { versionId: version.id, diff: diffDraft(previous?.body ?? '', edit.body), warnings };
  });
}
