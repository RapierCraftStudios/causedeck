// Error-boundary reporting hook. Sentry (#13) attaches here; until then dev builds log to the console.
export interface ReportContext {
  boundary: 'route' | 'global';
  digest?: string | undefined;
}

export type ErrorReporter = (error: unknown, context: ReportContext) => void;

const consoleReporter: ErrorReporter = (error, context) => {
  console.error(`[${context.boundary}-error]`, context.digest ?? '', error);
};

let reporter: ErrorReporter = consoleReporter;

/** Swap the reporter (Sentry in #13, a spy in tests). */
export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function reportError(error: unknown, context: ReportContext): void {
  try {
    reporter(error, context);
  } catch {
    // Reporting must never break the error screen itself.
  }
}
