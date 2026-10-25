// Schema validation of provider output with one repair attempt. Nothing is returned to callers
// without passing the task's zod schema, and a second failure returns no partial data.
import type { z } from 'zod';

import { OutputInvalidError } from './errors.ts';
import type { ProviderResult, TaskDef, Usage } from './types.ts';

/** Models sometimes wrap JSON in a code fence or prose; take the outermost object. */
export function coerceJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return raw;
  }
}

/** Issue paths and codes only: never the offending values, which may be document text. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
    .join('; ');
}

export function addUsage(a: Usage, b: Usage): Usage {
  const sum: Usage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  for (const key of ['seconds', 'pages', 'chars'] as const) {
    const value = (a[key] ?? 0) + (b[key] ?? 0);
    if (a[key] !== undefined || b[key] !== undefined) sum[key] = value;
  }
  return sum;
}

export interface Validated {
  output: unknown;
  usage: Usage;
  model: string;
  modelVersion?: string | null | undefined;
}

/**
 * Validate `first`; on failure call `repair` once with the issue summary and validate that. A
 * second failure throws `OutputInvalidError`. Usage of both attempts is summed.
 */
export async function validateWithRepair(
  task: TaskDef,
  first: ProviderResult,
  repair: (issues: string) => Promise<ProviderResult>,
): Promise<Validated> {
  const parsed = task.output.safeParse(coerceJson(first.output));
  if (parsed.success) {
    return {
      output: parsed.data,
      usage: first.usage,
      model: first.model,
      modelVersion: first.modelVersion,
    };
  }
  const second = await repair(describeIssues(parsed.error));
  const retried = task.output.safeParse(coerceJson(second.output));
  if (!retried.success) throw new OutputInvalidError(task.id);
  return {
    output: retried.data,
    usage: addUsage(first.usage, second.usage),
    model: second.model,
    modelVersion: second.modelVersion,
  };
}
