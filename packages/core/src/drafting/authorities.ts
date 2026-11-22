// Authority insertion (#1142, part 1 of #1118; ADR 0045, ADR 0051). `proposeAuthorities` asks the
// grounded copilot about one block of a draft (metered as one `copilot.questions` unit, capped on
// Junior, no model call for a sensitive matter) and returns only corpus candidates whose quote also
// verifies against the judgment's stored redacted text; it writes nothing to the draft.
// `insertAuthority` re-verifies the candidate at insert time (a client-altered quote, judgment id or
// pinpoint gives VALIDATION and nothing is saved), takes the title and citation from the stored
// judgment, adds the canonical paragraph `"<quote>" — <masked title>, <citation>, para N` after the
// named block, saves it as the next immutable version and audits `draft.authority.inserted` with ids
// and the text's sha256 only. Nothing is sent or shared; nothing here logs.
import { createHash, randomUUID } from 'node:crypto';

import {
  formatAuthorityParagraph,
  walkBlocks,
  type Block,
  type AuthorityParagraphInput,
} from '@causedeck/drafting';
import { schema, type Queryable } from '@causedeck/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../audit/index.ts';
import { verifyPinpoint } from '../citations/index.ts';
import {
  askCopilot,
  COPILOT_QUESTION_MAX_CHARS,
  type CopilotDeps,
  type CopilotUsage,
} from '../copilot/index.ts';
import { conflict, invalid } from '../shared/errors.ts';

import { asDraftMember, requireDraft, type DraftActor } from './policy.ts';
import {
  checkBlocksFor,
  insertVersion,
  type DraftingDeps,
  type DraftVersionSummary,
} from './service.ts';

const { draftVersion, judgment } = schema;

/** What the client sends back to insert a candidate: the judgment, the quote and the pinpoint. */
export interface AuthorityCandidateRef {
  judgmentId: string;
  quote: string;
  para?: number;
  page?: number;
}

export interface AuthorityCandidate {
  candidateRef: AuthorityCandidateRef;
  /** The stored (masked) case title. */
  title: string | null;
  neutralCitation: string | null;
  court: string | null;
  /** The corpus record the candidate links to, from the stored judgment. */
  sourceUrl: string | null;
  page: number | null;
  paragraph: number | null;
}

export interface ProposeAuthoritiesResult {
  candidates: AuthorityCandidate[];
  /** No candidate verified against the stored text: "no authority found". */
  noAuthority: boolean;
  /** The matter is sensitive: no model call was made and nothing was counted. */
  aiBlocked: boolean;
  usage: CopilotUsage;
}

export interface InsertAuthorityResult {
  version: DraftVersionSummary;
  /** The id of the inserted paragraph block. */
  blockId: string;
}

export interface ProposeAuthoritiesDeps {
  db: Queryable;
  copilot?: CopilotDeps;
  now?: () => Date;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The author text of a block (paragraph or heading text, section title). */
function blockText(block: Block): string | undefined {
  if (block.type === 'heading' || block.type === 'paragraph') return block.text;
  if (block.type === 'section') return block.title;
  return undefined;
}

function findBlock(blocks: readonly Block[], blockId: string): Block | undefined {
  let found: Block | undefined;
  walkBlocks(blocks, ({ block, key }) => {
    if (found === undefined && key === blockId) found = block;
  });
  return found;
}

/** `blocks` with `inserted` right after the block keyed `afterKey` (keys as `walkBlocks` gives them). */
function insertAfter(
  blocks: readonly Block[],
  afterKey: string,
  inserted: Block,
  prefix = 'b',
): Block[] | null {
  for (const [index, block] of blocks.entries()) {
    const key = block.id ?? `${prefix}.${String(index)}`;
    if (key === afterKey)
      return [...blocks.slice(0, index + 1), inserted, ...blocks.slice(index + 1)];
    if (block.type === 'section' || block.type === 'list') {
      const children = insertAfter(
        block.children,
        afterKey,
        inserted,
        `${prefix}.${String(index)}`,
      );
      if (children !== null) {
        return [...blocks.slice(0, index), { ...block, children }, ...blocks.slice(index + 1)];
      }
    }
  }
  return null;
}

const quoteKey = (quote: string): string => quote.replace(/\s+/g, ' ').trim().toLowerCase();

/** Verified corpus authorities for one block of the draft's latest version; writes nothing. */
export async function proposeAuthorities(
  deps: ProposeAuthoritiesDeps,
  actor: DraftActor,
  input: { draftId: string; blockId: string; requestId?: string },
): Promise<ProposeAuthoritiesResult> {
  const { question, matterId } = await asDraftMember(
    deps.db,
    actor,
    async (tx, reader, settings) => {
      const row = await requireDraft(tx, reader, settings, input.draftId, 'draft.read');
      const [latest] = await tx
        .select({ content: draftVersion.content })
        .from(draftVersion)
        .where(
          and(
            eq(draftVersion.workspaceId, reader.workspaceId),
            eq(draftVersion.draftId, input.draftId),
          ),
        )
        .orderBy(desc(draftVersion.versionNo))
        .limit(1);
      const block = findBlock(checkBlocksFor(latest?.content ?? []), input.blockId);
      const text = block === undefined ? undefined : blockText(block)?.replace(/\s+/g, ' ').trim();
      if (text === undefined || text === '') throw invalid('Choose a block with text');
      return { question: text.slice(0, COPILOT_QUESTION_MAX_CHARS), matterId: row.matterId };
    },
  );

  const answer = await askCopilot(
    deps.db,
    { workspaceId: actor.workspaceId, userId: actor.userId },
    {
      question,
      ...(matterId === null ? {} : { matterId }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    },
    { ...deps.copilot, ...(deps.now === undefined ? {} : { now: deps.now }) },
  );
  if (answer.aiBlocked) {
    return { candidates: [], noAuthority: false, aiBlocked: true, usage: answer.usage };
  }

  const candidates: AuthorityCandidate[] = [];
  const seen = new Set<string>();
  for (const claim of answer.claims) {
    if (claim.kind !== 'seg' || claim.judgmentId === null) continue;
    const { paragraph, page } = claim.pinpoint;
    if (paragraph === null && page === null) continue;
    const ref: AuthorityCandidateRef = {
      judgmentId: claim.judgmentId,
      quote: claim.quote,
      ...(paragraph === null ? { page: page ?? undefined } : { para: paragraph }),
    };
    const key = `${ref.judgmentId}|${String(ref.para ?? '')}|${String(ref.page ?? '')}|${quoteKey(ref.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The copilot checked the quote against the segment; insert checks the stored redacted text.
    const check = await verifyPinpoint(
      ref.judgmentId,
      { para: ref.para, page: ref.page, quote: ref.quote },
      { db: deps.db },
    );
    if (check.status !== 'verified') continue;
    const stored = answer.judgments[ref.judgmentId];
    candidates.push({
      candidateRef: ref,
      title: stored?.title ?? null,
      neutralCitation: stored?.neutralCitation ?? null,
      court: stored?.court ?? null,
      sourceUrl: stored?.sourceUrl ?? null,
      page,
      paragraph,
    });
  }
  return {
    candidates,
    noAuthority: candidates.length === 0,
    aiBlocked: false,
    usage: answer.usage,
  };
}

const pinNo = z.number().int().positive().max(1_000_000);

const InsertAuthorityInput = z
  .object({
    draftId: z.uuid(),
    versionId: z.uuid(),
    afterBlockId: z.string().min(1).max(200),
    candidateRef: z
      .object({
        judgmentId: z.uuid(),
        quote: z.string().trim().min(1).max(2000),
        para: pinNo.optional(),
        page: pinNo.optional(),
      })
      .strict()
      .refine((r) => (r.para === undefined) !== (r.page === undefined), {
        message: 'a paragraph or a page',
      }),
  })
  .strict();

const NEW_BLOCK_ID = () => `auth-${randomUUID().slice(0, 8)}`;

/** Re-verify a proposed authority and save it as a new paragraph in the next version. */
export async function insertAuthority(
  deps: DraftingDeps,
  actor: DraftActor,
  input: {
    draftId: string;
    versionId: string;
    afterBlockId: string;
    candidateRef: AuthorityCandidateRef;
  },
): Promise<InsertAuthorityResult> {
  const parsed = InsertAuthorityInput.safeParse(input);
  if (!parsed.success) throw invalid('This authority cannot be inserted');
  const { draftId, versionId, afterBlockId, candidateRef: ref } = parsed.data;

  const saved = await asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    await requireDraft(tx, reader, settings, draftId, 'draft.write');
    const [latest] = await tx
      .select({ id: draftVersion.id, content: draftVersion.content })
      .from(draftVersion)
      .where(
        and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.draftId, draftId)),
      )
      .orderBy(desc(draftVersion.versionNo))
      .limit(1);
    if (latest?.id !== versionId) throw conflict('The draft changed; reload');
    const blocks = checkBlocksFor(latest.content);
    if (findBlock(blocks, afterBlockId) === undefined)
      throw invalid('That block is not in the draft');

    const [stored] = await tx
      .select({
        caseTitle: judgment.caseTitle,
        neutralCitation: judgment.neutralCitation,
        caseNumbers: judgment.caseNumbers,
      })
      .from(judgment)
      .where(eq(judgment.id, ref.judgmentId))
      .limit(1);
    if (stored === undefined) throw invalid('This authority cannot be inserted');
    const check = await verifyPinpoint(
      ref.judgmentId,
      { para: ref.para, page: ref.page, quote: ref.quote },
      { db: tx },
    );
    if (check.status !== 'verified') throw invalid('This authority cannot be inserted');
    const citation = stored.neutralCitation ?? stored.caseNumbers[0];
    if (citation === undefined || citation.trim() === '') {
      throw invalid('This authority has no citation');
    }

    const format: AuthorityParagraphInput = {
      quote: ref.quote,
      title: stored.caseTitle,
      citation,
      ...(ref.para === undefined ? { page: ref.page } : { para: ref.para }),
    };
    const text = formatAuthorityParagraph(format);
    const keys = new Set<string>();
    walkBlocks(blocks, ({ key }) => keys.add(key));
    let blockId = NEW_BLOCK_ID();
    while (keys.has(blockId)) blockId = NEW_BLOCK_ID();
    const next = insertAfter(blocks, afterBlockId, { type: 'paragraph', id: blockId, text });
    if (next === null) throw invalid('That block is not in the draft');
    const version = await insertVersion(tx, reader, draftId, checkBlocksFor(next));
    await record(
      { db: tx, workspaceId: reader.workspaceId, actor: { userId: reader.userId, kind: 'user' } },
      {
        action: 'draft.authority.inserted',
        target: { kind: 'draft_version', id: version.id },
        metadata: {
          draft_id: draftId,
          base_version_id: versionId,
          version_id: version.id,
          judgment_id: ref.judgmentId,
          text_sha256: sha256(text),
        },
      },
    );
    return { version, blockId };
  });
  await deps.enqueueCitationCheck?.({
    workspaceId: actor.workspaceId,
    draftVersionId: saved.version.id,
  });
  return saved;
}
