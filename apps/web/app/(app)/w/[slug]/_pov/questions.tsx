// The five standard questions of the context test (#86), ids from the validators, copy from the
// `pov.test.questions` catalog.
import { CONTEXT_TEST_QUESTIONS } from '@causedeck/validators';
import type { ContextQuestion } from '@causedeck/ui/patterns';

export function questionList(
  label: (id: string) => string,
  marks: Readonly<Record<string, boolean>>,
): ContextQuestion[] {
  return CONTEXT_TEST_QUESTIONS.map((id) => ({ id, label: label(id), mark: marks[id] ?? null }));
}
