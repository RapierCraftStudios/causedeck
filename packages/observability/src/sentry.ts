// Sentry error reporting (spike §1). Inert without a DSN: the SDK is never initialised, so it makes
// no network calls. Events are scrubbed of cookies, headers, bodies and user email before sending.
import { serverEnv } from '@causedeck/config/env';
import * as Sentry from '@sentry/node';
import type { ErrorEvent, NodeOptions } from '@sentry/node';

import { runtimeInfo } from './logger.ts';
import { scrubSecretsInString } from './redact.ts';

export interface InitSentryOptions {
  /** Defaults to `SENTRY_DSN` when `SENTRY_ENABLED=true`. Sentry stays off when unset. */
  readonly dsn?: string | undefined;
  readonly environment?: string;
  /** Defaults to `GIT_SHA`. */
  readonly release?: string;
  /** Test hook: a stub transport so no network is used. */
  readonly transport?: NodeOptions['transport'];
}

function configuredDsn(): string | undefined {
  try {
    const env = serverEnv();
    return env.SENTRY_ENABLED ? env.SENTRY_DSN : undefined;
  } catch {
    return undefined;
  }
}

/** Strip request data, cookies, headers and user email; scrub credentials from messages. */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request !== undefined) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    if (event.request.query_string !== undefined) delete event.request.query_string;
  }
  if (event.user !== undefined) {
    delete event.user.email;
    delete event.user.ip_address;
  }
  if (event.message !== undefined) event.message = scrubSecretsInString(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = scrubSecretsInString(exception.value);
  }
  return event;
}

/** Initialise Sentry. Returns `false`, doing nothing at all, when no DSN is configured. */
export function initSentry(options: InitSentryOptions = {}): boolean {
  const dsn = 'dsn' in options ? options.dsn : configuredDsn();
  if (dsn === undefined || dsn === '') return false;

  const runtime = runtimeInfo();
  const sentryOptions: NodeOptions = {
    dsn,
    environment: options.environment ?? runtime.env,
    release: options.release ?? runtime.version,
    // Our own OpenTelemetry pipeline owns tracing (see otel.ts).
    enableOpenTelemetrySetup: false,
    tracesSampleRate: 0,
    // `sendDefaultPii: false` equivalent in Sentry 11: collect no user, cookie, header or body data.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    beforeSend,
  };
  if (options.transport !== undefined) sentryOptions.transport = options.transport;
  Sentry.init(sentryOptions);
  return true;
}
