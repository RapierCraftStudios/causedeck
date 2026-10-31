// The task registry: every model call in the product is one of these ids. Concrete prompts and the
// pipelines that call them live in later issues (#45, #46, #51, #52, #56).
import { UnknownTaskError } from '../errors.ts';
import { TASK_IDS, type TaskDef, type TaskId } from '../types.ts';
import { classifyDocument } from './classify-document.ts';
import { draftNarrative } from './draft-narrative.ts';
import { extractIssueTags } from './extract-issue-tags.ts';
import { extractOrder } from './extract-order.ts';
import { ocr } from './ocr.ts';
import { outwardUpdate } from './outward-update.ts';
import { answerResearchQuery } from './answer-research-query.ts';
import { parseListA0 } from './parse-list-a0.ts';
import { parseOrderA0 } from './parse-order-a0.ts';
import { planResearchQuery } from './plan-research-query.ts';
import { structureChat } from './structure-chat.ts';
import { structureDiary } from './structure-diary.ts';
import { structureHearing } from './structure-hearing.ts';
import { summarise } from './summarise.ts';
import { tagNews } from './tag-news.ts';
import { tagJudgmentSubject } from './tag-judgment-subject.ts';
import { tagNotice } from './tag-notice.ts';
import { transcribe } from './transcribe.ts';
import { translate } from './translate.ts';

export const TASKS: Readonly<Record<TaskId, TaskDef>> = {
  classify_document: classifyDocument,
  extract_order: extractOrder,
  ocr: ocr,
  transcribe: transcribe,
  structure_hearing: structureHearing,
  structure_diary: structureDiary,
  structure_chat: structureChat,
  parse_list_a0: parseListA0,
  parse_order_a0: parseOrderA0,
  translate: translate,
  summarise: summarise,
  tag_news: tagNews,
  tag_notice: tagNotice,
  tag_judgment_subject: tagJudgmentSubject,
  plan_research_query: planResearchQuery,
  answer_research_query: answerResearchQuery,
  extract_issue_tags: extractIssueTags,
  draft_narrative: draftNarrative,
  outward_update: outwardUpdate,
};

export function getTask(id: string): TaskDef {
  if (!(TASK_IDS as readonly string[]).includes(id)) throw new UnknownTaskError(id);
  return TASKS[id as TaskId];
}
