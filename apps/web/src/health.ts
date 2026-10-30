// Shared observability for apps/web: one logger and one health registry. Readiness checks (db,
// storage, migrations) register themselves here as those packages land.
import { createHealthHandlers, createLogger } from '@causedeck/observability';
import { clockDriftCheckFromEnv } from '@causedeck/observability/health';

export const logger = createLogger({ service: 'web' });

const clock = clockDriftCheckFromEnv();

export const health = createHealthHandlers(clock === undefined ? {} : { checks: { clock } });
