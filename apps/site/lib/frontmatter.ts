import { z } from 'zod';

const isoDate = z.preprocess(
  // YAML turns an unquoted `2026-01-31` into a Date.
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
);

const baseShape = {
  title: z.string().trim().min(1).max(70),
  description: z.string().trim().min(1).max(200),
  date: isoDate,
  noindex: z.boolean().default(false),
};

const historyEntry = z.strictObject({
  date: isoDate,
  summary: z.string().trim().min(1),
});

/** Legal keys are optional here and required by `legalFrontmatterSchema` for `content/legal` pages. */
const legalShape = {
  status: z.enum(['draft', 'final']).optional(),
  version: z.string().trim().min(1).optional(),
  effectiveDate: isoDate.optional(),
  history: z.array(historyEntry).optional(),
};

/** Frontmatter of every `content/**\/*.mdx` page. Unknown keys are rejected. */
export const frontmatterSchema = z.strictObject({ ...baseShape, ...legalShape });

/**
 * Legal pages (#95): status, version and a version history are required. The effective date is set
 * only when counsel approves, so a draft must not carry one and a final page must.
 */
export const legalFrontmatterSchema = z
  .strictObject({
    ...baseShape,
    status: z.enum(['draft', 'final']),
    version: z.string().trim().min(1),
    effectiveDate: isoDate.optional(),
    history: z.array(historyEntry).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'draft' && value.effectiveDate !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveDate'],
        message: 'a draft has no effective date until counsel approves',
      });
    }
    if (value.status === 'final' && value.effectiveDate === undefined) {
      ctx.addIssue({ code: 'custom', path: ['effectiveDate'], message: 'a final page needs one' });
    }
  });

export type LegalFrontmatter = z.infer<typeof legalFrontmatterSchema>;

export type Frontmatter = z.infer<typeof frontmatterSchema>;

function fail(file: string, error: z.ZodError): never {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid frontmatter in ${file}: ${issues}`);
}

/** Validate parsed frontmatter; the error names the file so a failed build points at it. */
export function parseFrontmatter(data: unknown, file: string): Frontmatter {
  const result = frontmatterSchema.safeParse(data);
  if (!result.success) fail(file, result.error);
  return result.data;
}

export function parseLegalFrontmatter(data: unknown, file: string): LegalFrontmatter {
  const result = legalFrontmatterSchema.safeParse(data);
  if (!result.success) fail(file, result.error);
  return result.data;
}
