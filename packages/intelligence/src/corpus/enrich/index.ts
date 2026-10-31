// Corpus enrichment (#894, ADR 0051 §Enrichment): statute references with the IPC/BNS, CrPC/BNSS and
// IEA/BSA mapping, case citations, subject areas and the outcome, each carrying the version of the
// rules or model that produced it.
export * from './citations.ts';
export * from './code-map.ts';
export * from './gateway-subjects.ts';
export * from './outcome.ts';
export * from './statutes.ts';
export * from './subjects.ts';

/** Bump when a rule, the code map or the vocabulary changes: the enrich job rebuilds older rows. */
export const ENRICH_VERSION = 1;

/** The ruleset label stored on statute and citation rows built at `version`. */
export function rulesetVersion(version: number = ENRICH_VERSION): string {
  return `enrich-${String(version)}`;
}
