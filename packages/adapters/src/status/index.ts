// Case-status page parsers (#590, part 2 of #483): pure functions from a saved result page to one
// `ParsedCaseStatus`. Nothing here requests a URL; the device and the server paths both call them.
import { parseDrtStatus } from './drt.ts';
import { parseEcourtsDistrictStatus } from './ecourts-district.ts';
import { parseKarnatakaHcStatus } from './karnataka-hc.ts';
import { parseMadrasHcStatus } from './madras-hc.ts';
import { parseNcltStatus } from './nclt.ts';
import type { CaseStatusTemplate, ParsedCaseStatus } from './types.ts';

export * from './drt.ts';
export * from './ecourts-district.ts';
export * from './karnataka-hc.ts';
export * from './madras-hc.ts';
export * from './nclt.ts';
export * from './types.ts';

const PARSERS: Record<CaseStatusTemplate, (html: string) => ParsedCaseStatus> = {
  'ecourts-district': parseEcourtsDistrictStatus,
  'madras-hc': parseMadrasHcStatus,
  'karnataka-hc': parseKarnatakaHcStatus,
  drt: parseDrtStatus,
  nclt: parseNcltStatus,
};

export function parseCaseStatus(template: CaseStatusTemplate, html: string): ParsedCaseStatus {
  return PARSERS[template](html);
}
