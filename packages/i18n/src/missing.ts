// Missing-key behaviour (#174), wired into next-intl's `onError` / `getMessageFallback` on the
// server (`getRequestConfig`) and the client (`NextIntlClientProvider`):
// - development: the UI shows the dotted key and a warning is logged, so gaps are obvious;
// - production: the English string is shown (or, failing that, the key) and the gap is reported to
//   the logger. Never an empty string.
// Structural types keep this module free of next-intl imports.
import { getPath, type Catalog } from './catalog';

export type MissingKeyMode = 'development' | 'production';

/** The fields of next-intl's `IntlError` this module reads. */
export interface IntlErrorLike {
  code: string;
  message: string;
  originalMessage?: string | undefined;
}

export interface MissingKeyReport {
  code: string;
  message: string;
}

export interface MissingKeyOptions {
  mode: MissingKeyMode;
  /** The English catalog (production fallback). Omit it on the client: server loading fills gaps. */
  fallback?: Catalog | undefined;
  /** Production sink (the logger). */
  report: (info: MissingKeyReport) => void;
  /** Development sink; defaults to `console.warn`. */
  warn?: ((message: string) => void) | undefined;
}

const MISSING_MESSAGE = 'MISSING_MESSAGE';

export function messageId(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}.${key}` : key;
}

export function createMissingKeyHandlers(options: MissingKeyOptions) {
  const warn =
    options.warn ??
    ((message: string) => {
      console.warn(message);
    });

  function onError(error: IntlErrorLike): void {
    const message = error.originalMessage ?? error.message;
    if (options.mode === 'development') {
      warn(`[i18n] ${error.code}: ${message}`);
      // Formatting and config errors are bugs in any mode, not just catalog gaps.
      if (error.code === MISSING_MESSAGE) return;
    }
    options.report({ code: error.code, message });
  }

  function getMessageFallback({
    namespace,
    key,
    error,
  }: {
    namespace?: string | undefined;
    key: string;
    error: IntlErrorLike;
  }): string {
    const id = messageId(namespace, key);
    if (options.mode === 'production' && error.code === MISSING_MESSAGE && options.fallback) {
      const english = getPath(options.fallback, id);
      if (typeof english === 'string' && english !== '') return english;
    }
    return id;
  }

  return { onError, getMessageFallback };
}
