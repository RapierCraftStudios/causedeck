'use server';
// Research tab server actions (#497, D-048). Each goes through `workspaceAction`: zod input,
// session, membership and `matter.write`; the research services decide again per matter and return
// NOT_FOUND or FORBIDDEN through `toActionError`. A tag the lawyer adds is confirmed at once;
// proposed tags (AI) become alert sources only through `confirmTagAction`.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Result } from '../../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../../lib/workspace-action.ts';

function actorOf(ctx: WorkspaceActionCtx) {
  return { workspaceId: ctx.workspaceId, userId: ctx.userId };
}

function revalidateResearch(): void {
  revalidatePath('/w/[slug]/matters/[id]/research', 'page');
}

export interface TagResult {
  id: string;
  status: string;
}

const AddTag = WorkspaceScoped.extend({
  matterId: z.uuid(),
  statute: z.string().trim().min(1).max(200),
  section: z.string().trim().max(50).optional(),
  issue: z.string().trim().max(500).optional(),
});

const add = workspaceAction(
  AddTag,
  async (input, ctx) => {
    const { addTag } = await import('@causedeck/core/research');
    const row = await addTag(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      statute: input.statute,
      ...(input.section === undefined ? {} : { section: input.section }),
      ...(input.issue === undefined ? {} : { issue: input.issue }),
    });
    revalidateResearch();
    return { id: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function addTagAction(raw: unknown): Promise<Result<TagResult>> {
  return add(raw);
}

const TagRef = WorkspaceScoped.extend({ matterId: z.uuid(), tagId: z.uuid() });

const confirm = workspaceAction(
  TagRef,
  async (input, ctx) => {
    const { confirmTag } = await import('@causedeck/core/research');
    const row = await confirmTag(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      tagId: input.tagId,
    });
    revalidateResearch();
    return { id: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function confirmTagAction(raw: unknown): Promise<Result<TagResult>> {
  return confirm(raw);
}

const dismiss = workspaceAction(
  TagRef,
  async (input, ctx) => {
    const { dismissTag } = await import('@causedeck/core/research');
    const row = await dismissTag(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      tagId: input.tagId,
    });
    revalidateResearch();
    return { id: row.id, status: row.status };
  },
  { action: 'matter.write' },
);

export async function dismissTagAction(raw: unknown): Promise<Result<TagResult>> {
  return dismiss(raw);
}

// Research notes (#80). `memory.write` at the action; the core service checks `memory.write` and
// matter visibility again. A pinned authority is data only: no action here touches a draft.
export interface NoteResult {
  id: string;
}

const NoteRef = WorkspaceScoped.extend({ matterId: z.uuid(), noteId: z.uuid() });
const AuthorityRef = NoteRef.extend({ index: z.number().int().min(0) });

const createNote = workspaceAction(
  WorkspaceScoped.extend({
    matterId: z.uuid(),
    title: z.string().max(200),
    body: z.string().max(20_000).optional(),
  }),
  async (input, ctx): Promise<NoteResult> => {
    const { createNote: create } = await import('@causedeck/core/research');
    const row = await create(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      title: input.title,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    revalidateResearch();
    return { id: row.id };
  },
  { action: 'memory.write' },
);

export async function createNoteAction(raw: unknown): Promise<Result<NoteResult>> {
  return createNote(raw);
}

const updateNote = workspaceAction(
  NoteRef.extend({ title: z.string().max(200), body: z.string().max(20_000) }),
  async (input, ctx): Promise<NoteResult> => {
    const { updateNote: update } = await import('@causedeck/core/research');
    const row = await update(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      noteId: input.noteId,
      title: input.title,
      body: input.body,
    });
    revalidateResearch();
    return { id: row.id };
  },
  { action: 'memory.write' },
);

export async function updateNoteAction(raw: unknown): Promise<Result<NoteResult>> {
  return updateNote(raw);
}

const deleteNote = workspaceAction(
  NoteRef,
  async (input, ctx): Promise<{ removed: true }> => {
    const { deleteNote: remove } = await import('@causedeck/core/research');
    await remove(ctx.tx, actorOf(ctx), { matterId: input.matterId, noteId: input.noteId });
    revalidateResearch();
    return { removed: true };
  },
  { action: 'memory.write' },
);

export async function deleteNoteAction(raw: unknown): Promise<Result<{ removed: true }>> {
  return deleteNote(raw);
}

const addAuthority = workspaceAction(
  NoteRef.extend({
    label: z.string().max(300),
    citation: z.string().max(300).optional(),
    url: z.string().max(500).optional(),
  }),
  async (input, ctx): Promise<NoteResult> => {
    const { addAuthority: add } = await import('@causedeck/core/research');
    const row = await add(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      noteId: input.noteId,
      authority: {
        label: input.label,
        ...(input.citation ? { citation: input.citation } : {}),
        ...(input.url ? { url: input.url } : {}),
      },
    });
    revalidateResearch();
    return { id: row.id };
  },
  { action: 'memory.write' },
);

export async function addAuthorityAction(raw: unknown): Promise<Result<NoteResult>> {
  return addAuthority(raw);
}

const removeAuthority = workspaceAction(
  AuthorityRef,
  async (input, ctx): Promise<NoteResult> => {
    const { removeAuthority: remove } = await import('@causedeck/core/research');
    const row = await remove(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      noteId: input.noteId,
      index: input.index,
    });
    revalidateResearch();
    return { id: row.id };
  },
  { action: 'memory.write' },
);

export async function removeAuthorityAction(raw: unknown): Promise<Result<NoteResult>> {
  return removeAuthority(raw);
}

const pinAuthority = workspaceAction(
  AuthorityRef.extend({ pinned: z.boolean() }),
  async (input, ctx): Promise<NoteResult> => {
    const { setAuthorityPinned } = await import('@causedeck/core/research');
    const row = await setAuthorityPinned(ctx.tx, actorOf(ctx), {
      matterId: input.matterId,
      noteId: input.noteId,
      index: input.index,
      pinned: input.pinned,
    });
    revalidateResearch();
    return { id: row.id };
  },
  { action: 'memory.write' },
);

export async function setAuthorityPinnedAction(raw: unknown): Promise<Result<NoteResult>> {
  return pinAuthority(raw);
}

const FindAuthorities = WorkspaceScoped.extend({ matterId: z.uuid() });

const findAuthorities = workspaceAction(
  FindAuthorities,
  async (input, ctx) => {
    const { getResearchFacts, researchQueryParts } = await import('@causedeck/core/research');
    // The facts the actor may see (confirmed statutes and sections, the court, and the lawyer's issue
    // words only with `strategy.read`): never the matter id, the CNR or a party name. Another
    // workspace's matter is NOT_FOUND here.
    const facts = await getResearchFacts(ctx.tx, actorOf(ctx), input.matterId);
    const query = facts
      .map((f) => researchQueryParts(f).join(' '))
      .filter((part) => part !== '')
      .join('; ')
      .slice(0, 1000);
    return { query };
  },
  { action: 'matter.read' },
);

/** The search query seeded from the matter's research facts (#896); the search page runs it on the member's say-so. */
export async function findAuthoritiesAction(raw: unknown): Promise<Result<{ query: string }>> {
  return findAuthorities(raw);
}
