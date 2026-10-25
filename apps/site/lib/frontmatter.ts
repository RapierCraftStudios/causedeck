import { z } from 'zod';

const isoDate = z.preprocess(
  // YAML turns an unquoted `2026-01-31` into a Date.
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
);

/** Frontmatter of every `content/**\/*.mdx` page. Unknown keys are rejected. */
export const frontmatterSchema = z.strictObject({
  title: z.string().trim().min(1).max(70),
  description: z.string().trim().min(1).max(200),
  date: isoDate,
  noindex: z.boolean().default(false),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;

/** Validate parsed frontmatter; the error names the file so a failed build points at it. */
export function parseFrontmatter(data: unknown, file: string): Frontmatter {
  const result = frontmatterSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter in ${file}: ${issues}`);
  }
  return result.data;
}
