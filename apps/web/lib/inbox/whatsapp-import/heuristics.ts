// Heuristics that catch a client conversation the user called internal (#527, PRD CA-6). They only
// ever hold an import back; the user's own answer on the chat-type step is the first gate.
const CLIENT_NAME = /^(?:mr|mrs|ms|miss|shri|smt|sri|client)\b\.?(?:\s|$)/i;
const NAME_WORDS = /[\p{L}\p{N}]+/gu;

/** A sender whose name reads as a client: an honorific without a professional title, or `client`. */
export function clientParticipants(senders: readonly string[]): string[] {
  return senders.filter(
    (s) => CLIENT_NAME.test(s.trim()) || /\bclient\b/i.test(s) || /^\+?[\d\s-]{8,}$/.test(s.trim()),
  );
}

function sameName(a: string, b: string): boolean {
  const words = (s: string) => (s.toLowerCase().match(NAME_WORDS) ?? []).join(' ');
  const [x, y] = [words(a), words(b)];
  return x !== '' && y !== '' && (x === y || x.includes(y) || y.includes(x));
}

export type ChatWarning =
  { kind: 'client_participants'; names: string[] } | { kind: 'two_person_non_member' };

/**
 * `client_participants` stops the import; `two_person_non_member` (two senders, neither the signed-in
 * member) asks the user to confirm the chat is internal.
 */
export function chatWarning(senders: readonly string[], memberName: string): ChatWarning | null {
  const names = clientParticipants(senders);
  if (names.length > 0) return { kind: 'client_participants', names };
  if (senders.length === 2 && !senders.some((s) => sameName(s, memberName))) {
    return { kind: 'two_person_non_member' };
  }
  return null;
}
