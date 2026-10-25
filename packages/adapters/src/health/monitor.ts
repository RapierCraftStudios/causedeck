// Parse-health monitor (#372, ADR 0015). Every parse of a supplied list is reduced to metrics
// (counts and hall numbers, never row text) and judged against thresholds:
// - `zero_rows`: nothing was emitted;
// - `yield_drop`: fewer rows than `yieldDropRatio` of the median of the last `yieldWindow` runs for
//   the same forum (no check without history);
// - `unmapped_heading_ratio`: unmapped headings over distinct headings seen, above the limit;
// - `unknown_case_type_ratio`: rows with an unknown case type over rows emitted, above the limit;
// - `missing_hall_headers`: a hall heading was unreadable, or rows sat under no hall heading.
// `failed` on zero rows, `degraded` on any other flag, `ok` otherwise. A list the parser read as
// genuinely empty (`status: 'empty'`, a "no cases" list, #396) is not a zero-row failure. Pure: `recordParseRun`
// (server entry) stores the metrics and reads the history.
import type { ParsedCauseList } from '../types.ts';

export const PARSE_HEALTH_THRESHOLDS = {
  yieldDropRatio: 0.5,
  yieldWindow: 7,
  maxUnmappedHeadingRatio: 0.2,
  maxUnknownCaseTypeRatio: 0.1,
} as const;

export type ParseHealthThresholds = { [K in keyof typeof PARSE_HEALTH_THRESHOLDS]: number };

export const PARSE_HEALTH_FLAGS = [
  'zero_rows',
  'yield_drop',
  'unmapped_heading_ratio',
  'unknown_case_type_ratio',
  'missing_hall_headers',
] as const;
export type ParseHealthFlag = (typeof PARSE_HEALTH_FLAGS)[number];

export type ParseHealthStatus = 'ok' | 'degraded' | 'failed';

/** What one parse is reduced to; `adapter_parse_run` stores all but the two derived counts. */
export interface ParseRunMetrics {
  adapterId: string;
  adapterVersion: string;
  forumCode: string;
  /** Candidate rows: emitted rows plus rows dropped for want of an anchor. */
  rowsParsed: number;
  rowsAnchored: number;
  /** Distinct headings no `stageMap` pattern matched. */
  unmappedHeadings: number;
  /** Emitted rows whose case type is unknown to the adapter config. */
  unknownCaseTypes: number;
  hallsSeen: string[];
  hallsUnreadable: string[];
  /** Distinct stage headings seen, mapped or not (the unmapped ratio's denominator). */
  headingsSeen: number;
  /** Emitted rows that sat under no hall heading. */
  rowsWithoutHall: number;
  /** The parser read a list with nothing listed (`status: 'empty'`), not an unreadable one. */
  declaredEmpty?: boolean;
}

export interface ParseHealth {
  status: ParseHealthStatus;
  flags: ParseHealthFlag[];
  /** Halls the flags concern, sorted: unreadable ones, or every hall seen when nothing parsed. */
  affectedHalls: string[];
}

export interface EvaluateParseHealthOptions {
  /** `rowsAnchored` of the earlier runs for the same forum, newest first. */
  history?: readonly number[];
  thresholds?: Partial<ParseHealthThresholds>;
}

/** Reduce a parse to its metrics; no quote, party or case number survives. */
export function parseRunMetrics(parsed: ParsedCauseList): ParseRunMetrics {
  const { rows, diagnostics } = parsed;
  const unknownRaw = new Set(diagnostics.unknownCaseTypes);
  const headings = new Set(diagnostics.unmappedHeadings);
  for (const row of rows) if (row.stageRaw !== null) headings.add(row.stageRaw);
  return {
    adapterId: parsed.adapterId,
    adapterVersion: parsed.adapterVersion,
    forumCode: parsed.forumCode,
    rowsParsed: rows.length + diagnostics.rowsSkippedNoAnchor,
    rowsAnchored: rows.length,
    unmappedHeadings: diagnostics.unmappedHeadings.length,
    unknownCaseTypes: rows.filter((row) => row.caseType === null || unknownRaw.has(row.caseTypeRaw))
      .length,
    hallsSeen: [...diagnostics.hallsSeen],
    hallsUnreadable: [...diagnostics.hallsUnreadable],
    headingsSeen: headings.size,
    rowsWithoutHall: rows.filter((row) => row.hallNo === undefined || row.hallNo === '').length,
    ...(parsed.status === 'empty' && rows.length === 0 ? { declaredEmpty: true } : {}),
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function evaluateParseHealth(
  metrics: ParseRunMetrics,
  { history = [], thresholds = {} }: EvaluateParseHealthOptions = {},
): ParseHealth {
  const limits = { ...PARSE_HEALTH_THRESHOLDS, ...thresholds };
  const flags: ParseHealthFlag[] = [];
  const zeroRows = metrics.rowsAnchored === 0 && metrics.declaredEmpty !== true;
  if (zeroRows) flags.push('zero_rows');
  const window = history.slice(0, limits.yieldWindow);
  if (window.length > 0 && metrics.rowsAnchored < limits.yieldDropRatio * median(window)) {
    flags.push('yield_drop');
  }
  if (
    metrics.headingsSeen > 0 &&
    metrics.unmappedHeadings / metrics.headingsSeen > limits.maxUnmappedHeadingRatio
  ) {
    flags.push('unmapped_heading_ratio');
  }
  if (
    metrics.rowsAnchored > 0 &&
    metrics.unknownCaseTypes / metrics.rowsAnchored > limits.maxUnknownCaseTypeRatio
  ) {
    flags.push('unknown_case_type_ratio');
  }
  if (metrics.hallsUnreadable.length > 0 || metrics.rowsWithoutHall > 0) {
    flags.push('missing_hall_headers');
  }
  const affected = zeroRows
    ? [...metrics.hallsSeen, ...metrics.hallsUnreadable]
    : metrics.hallsUnreadable;
  return {
    status: zeroRows ? 'failed' : flags.length > 0 ? 'degraded' : 'ok',
    flags,
    affectedHalls: [...new Set(affected)].sort(),
  };
}
