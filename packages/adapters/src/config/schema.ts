// Versioned adapter config (#369, ADR 0015): everything that differs between courts and changes
// without a code change (case-type aliases, stage headings, the two-digit-year pivot, link kinds,
// health thresholds) lives here; parsers stay generic code. Versions of it are stored in
// `adapter_version` and hot-deployed by `config/loader.ts` and `config/activate.ts` (#372). Stage
// headings are an open enum: `stageMap` maps raw-heading regexes to normalised keys and anything
// unmatched is kept verbatim.
import { z } from 'zod';

const compiles = (pattern: string, flags: string | undefined): boolean => {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
};

export const StageMapEntrySchema = z
  .object({
    /** Regex source matched against the trimmed heading. */
    pattern: z.string().min(1),
    flags: z
      .string()
      .regex(/^[imsu]*$/, 'only the i, m, s and u flags are allowed')
      .optional(),
    /** Normalised stage key, e.g. `admission`, `final_hearing`. */
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'stage keys are snake_case'),
  })
  .strict()
  .refine((entry) => compiles(entry.pattern, entry.flags), {
    message: 'pattern must be a valid regular expression',
    path: ['pattern'],
  });
export type StageMapEntry = z.infer<typeof StageMapEntrySchema>;

export const AdapterConfigSchema = z
  .object({
    nomenclature: z
      .object({
        /** Normalised case-type code -> extra spellings beyond the dotted/spaced variants. */
        caseTypes: z.record(z.string(), z.array(z.string())).default({}),
        /** Seat suffixes the court appends to case types, e.g. `MD` for the Madurai Bench. */
        seatSuffixes: z.array(z.string().regex(/^[A-Z]+$/)).default([]),
      })
      .strict(),
    listing: z
      .object({
        /** Regex source for a hall / court-number heading; capture group 1 is the hall number. */
        hallHeading: z.string().min(1).optional(),
        /** Regex source for a numbered list row; parsers decide the groups. */
        rowPattern: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    orderParser: z
      .object({
        /** Phrases that start a direction cue, lower-case. */
        directionPhrases: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ directionPhrases: [] }),
    calendar: z
      .object({
        timeZone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
        /** Day-first formats the court prints dates in. */
        dateOrder: z.literal('dmy').default('dmy'),
      })
      .strict()
      .default({ timeZone: 'Asia/Kolkata', dateOrder: 'dmy' }),
    languageProfile: z
      .object({
        scripts: z.array(z.string().min(1)).default(['Latn']),
        languages: z.array(z.string().min(2)).default(['en']),
      })
      .strict()
      .default({ scripts: ['Latn'], languages: ['en'] }),
    /** Resource -> the forum deep-link kind (ADR 0014) that opens it officially. */
    links: z.record(z.string(), z.string().min(1)).default({}),
    fixtures: z
      .object({
        /** Path of the fixture manifest, relative to the adapter folder. */
        manifest: z.string().min(1).optional(),
        /** Every fixture is synthetic until real-fixture sign-off (#119). */
        fictional: z.boolean().default(true),
      })
      .strict()
      .default({ fictional: true }),
    health: z
      .object({
        /** Minimum anchored-row ratio before the parse is flagged. */
        minAnchoredRatio: z.number().min(0).max(1).default(0.9),
        /** Maximum unmapped headings per list before the parse is flagged. */
        maxUnmappedHeadings: z.number().int().nonnegative().default(3),
      })
      .strict()
      .default({ minAnchoredRatio: 0.9, maxUnmappedHeadings: 3 }),
    /**
     * Table-format lists (ADR 0020): canonical column key -> header spellings, how many columns a
     * header row must match, and how far (PDF points) a word may sit left of its column's header
     * and still belong to it. Optional with no default, so configs without it keep their checksum.
     */
    table: z
      .object({
        columns: z.record(
          z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'column keys are camelCase'),
          z.array(z.string().min(1)).min(1),
        ),
        minHeaderMatches: z.number().int().min(1).default(5),
        columnTolerancePx: z.number().min(0).default(6),
      })
      .strict()
      .optional(),
    stageMap: z.array(StageMapEntrySchema).default([]),
    /**
     * Two-digit years at or below the pivot are 20YY, above it 19YY (`26` -> 2026 with pivot 50).
     */
    twoDigitYearPivot: z.number().int().min(0).max(99).default(50),
    /**
     * Display-board stage code -> stage key, reserved for the legally gated display-board work
     * (#404). No default, so configs without it keep their checksum.
     */
    stageCodeLegend: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
export type AdapterConfigInput = z.input<typeof AdapterConfigSchema>;

/** Parse and default an adapter config; throws a `ZodError` for an invalid one. */
export function defineAdapterConfig(input: AdapterConfigInput): AdapterConfig {
  return AdapterConfigSchema.parse(input);
}
