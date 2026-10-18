/** Same marker as `Secret` from `@causedeck/config/env`. */
export const REDACTED = '[REDACTED]';

/** Every fragment of a connection URL that must never reach a log line or an error message. */
function sensitiveParts(url: string): string[] {
  const parts = [url];
  try {
    const parsed = new URL(url);
    if (parsed.password) parts.push(parsed.password, decodeURIComponent(parsed.password));
    parts.push(parsed.href);
  } catch {
    // Unparseable: only the raw string is known.
  }
  return [...new Set(parts.filter((part) => part.length >= 4))].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, urls: readonly string[]): string {
  let out = text;
  for (const part of urls.flatMap(sensitiveParts)) out = out.split(part).join(REDACTED);
  return out;
}

/** Thrown in place of any driver error that could carry a connection string or password. */
export class DatabaseConnectionError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DatabaseConnectionError';
    this.code = code;
  }
}

/**
 * Rebuild `error` as a `DatabaseConnectionError` with every URL fragment removed. The original
 * error is dropped, not attached as `cause`, because drivers keep connection options on it.
 */
export function redactError(error: unknown, urls: readonly string[]): DatabaseConnectionError {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  return new DatabaseConnectionError(redactText(message, urls), code);
}
