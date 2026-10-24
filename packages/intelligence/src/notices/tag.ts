// Notice tagging (#585, D-048): the notice kind and forum codes. Title keywords settle most
// notices; the gateway task `tag_notice` is asked only when they leave the kind open, and only for
// kind and forum tagging. The model output is validated against the kinds in the schema and the
// forum codes the source may name; anything else falls back to the rules, never to an error.
import type { AiGateway, RunContext } from '@causedeck/ai';
import { NOTICE_KINDS, type NoticeKind } from '@causedeck/db/schema';
import { z } from 'zod';

export const NoticeTagSchema = z.object({
  kind: z.enum(NOTICE_KINDS),
  forumCodes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export interface NoticeTag {
  kind: NoticeKind;
  forumCodes: string[];
  /** Where the tag came from: title rules, the model, or the fallback after a failed model call. */
  via: 'rules' | 'model' | 'fallback';
}

export interface TagNoticeInput {
  title: string;
  /** Optional leading text of the notice document. */
  text?: string;
  sourceId: string;
  url: string;
  kindHint: NoticeKind | null;
  /** Forum codes read by the parser (the court's defaults when the title names none). */
  forumCodes: readonly string[];
}

export interface TagNoticeDeps {
  gateway: AiGateway;
  /** Notices are global: the caller passes its system scope. */
  scope: Pick<RunContext, 'workspaceId' | 'userId'>;
  /** Forum codes the source may name; model codes outside it are dropped. */
  allowedForumCodes: readonly string[];
}

/** Characters of document text sent to the model. */
export const NOTICE_TEXT_CHARS = 4000;

export async function tagNotice(deps: TagNoticeDeps, notice: TagNoticeInput): Promise<NoticeTag> {
  const rulesCodes = notice.forumCodes.filter((code) => deps.allowedForumCodes.includes(code));
  if (notice.kindHint !== null) {
    return { kind: notice.kindHint, forumCodes: rulesCodes, via: 'rules' };
  }
  const fallback: NoticeTag = { kind: 'other', forumCodes: rulesCodes, via: 'fallback' };
  try {
    const result = await deps.gateway.run(
      'tag_notice',
      {
        title: notice.title,
        ...(notice.text === undefined ? {} : { text: notice.text.slice(0, NOTICE_TEXT_CHARS) }),
        sourceId: notice.sourceId,
      },
      {
        ...deps.scope,
        purpose: 'notices.tag',
        idempotencyKey: `notice-tag:${notice.sourceId}:${notice.url}`,
      },
    );
    const parsed = NoticeTagSchema.safeParse(result.output);
    if (!parsed.success) return fallback;
    const named = [...new Set(parsed.data.forumCodes)].filter((code) =>
      deps.allowedForumCodes.includes(code),
    );
    return {
      kind: parsed.data.kind,
      forumCodes: named.length > 0 ? named : rulesCodes,
      via: 'model',
    };
  } catch {
    return fallback;
  }
}
