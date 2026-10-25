// Next.js instrumentation hook: start OpenTelemetry and Sentry once per server process. Both are
// inert without OTEL_EXPORTER_OTLP_ENDPOINT / SENTRY_DSN.
export async function register(): Promise<void> {
  // eslint-disable-next-line no-process-env -- Next.js sets NEXT_RUNTIME; the Node SDKs cannot load on the edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initSentry, initTelemetry } = await import('@causedeck/observability');
  initTelemetry({ service: 'web' });
  initSentry();
  // eslint-disable-next-line no-process-env -- TEMPORARY diag/e2e-556
  if (process.env.E2E_DIAG === '1') (await import('./e2e-diag')).startE2eDiag();
}
