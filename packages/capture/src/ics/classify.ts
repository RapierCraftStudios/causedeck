// Hearing-like detection (#53; PRD CA-5): a score from case-number patterns, keywords, location and
// time of day. Events that score under the threshold are ignored and only counted; events that look
// personal and sensitive (medical, family) are flagged so the importer drops them before anything
// is stored (CA-10). Deterministic and pure: no model is involved.
import { caseCandidatesOf, type CaseCandidate } from './match.ts';
import type { IcsEvent } from './parse.ts';

export const HEARING_SCORE_THRESHOLD = 0.5;

const KEYWORDS =
  /\b(hearing|hc|high court|court|list(?:ed|ing)?|mention(?:ing)?|posted|adjourned|bench|nclt|tribunal|judge|arguments|cause list|w\.?\s?p|crl\.?\s?o\.?\s?p)\b/i;
const STRONG_KEYWORDS = /\b(hearing|high court|listed|posted for|cause list|nclt)\b/i;
const COURT_LOCATION =
  /\b(court|hall|bench|high court|tribunal|nclt|chamber|registry|sessions|magistrate)\b/i;
const SENSITIVE =
  /\b(doctor|dr\.?|hospital|clinic|dentist|surgery|therapy|therapist|medical|medicine|checkup|check-up|diagnos\w*|prescription|pregnan\w*|chemo\w*|psychiatr\w*|counsell?ing|funeral|divorce counsell?ing|lab test|vaccin\w*)\b/i;

export interface Classification {
  score: number;
  hearingLike: boolean;
  /** Looks like a personal, sensitive event: never persisted. */
  sensitive: boolean;
  candidates: CaseCandidate[];
}

/** Court hours in IST, 09:00 to 17:30. */
function courtHours(time: string | null): boolean {
  if (time === null) return false;
  return time >= '09:00' && time <= '17:30';
}

export function classifyEvent(
  event: Pick<IcsEvent, 'summary' | 'description' | 'location' | 'time'>,
): Classification {
  const candidates = caseCandidatesOf(event);
  const text = `${event.summary} ${event.description}`;
  let score = 0;
  if (candidates.length > 0) score += 0.55;
  if (STRONG_KEYWORDS.test(text)) score += 0.3;
  else if (KEYWORDS.test(text)) score += 0.15;
  if (COURT_LOCATION.test(event.location)) score += 0.2;
  if (courtHours(event.time)) score += 0.05;
  const capped = Math.min(1, Math.round(score * 100) / 100);
  const hearingLike = capped >= HEARING_SCORE_THRESHOLD;
  // A case number outranks a medical-sounding word ("Dr. Rao v State"): only drop what scores low
  // or names no case at all.
  const sensitive = SENSITIVE.test(`${event.summary} ${event.location}`) && candidates.length === 0;
  return { score: capped, hearingLike: hearingLike && !sensitive, sensitive, candidates };
}
