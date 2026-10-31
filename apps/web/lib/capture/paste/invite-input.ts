// What the workspace switcher's "Join with invite" field accepts (#1074): an invite link
// (`https://app.example/invite/<token>`, with or without a query or hash) or the bare code (the
// token). The token is 32 random bytes, base64url, so a code is URL-safe characters only. Anything
// else yields `null`; the `/invite/[token]` page itself decides whether a well-formed token is
// still valid.
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** The invitation token in what the member pasted, or `null`. */
export function inviteTokenFrom(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  const marker = text.toLowerCase().lastIndexOf('/invite/');
  if (marker >= 0) {
    const rest = text.slice(marker + '/invite/'.length);
    const token = decodeSegment(rest.split(/[/?#\s]/, 1)[0] ?? '');
    return token !== null && TOKEN.test(token) ? token : null;
  }
  return TOKEN.test(text) ? text : null;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The in-app address of an invitation. */
export const invitePath = (token: string): string => `/invite/${encodeURIComponent(token)}`;
