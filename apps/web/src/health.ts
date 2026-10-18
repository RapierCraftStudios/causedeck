// Shared observability for apps/web: one logger and one health registry. Readiness checks (db,
// storage, migrations) register themselves here as those packages land.
import { createHealthHandlers, createLogger } from '@causedeck/observability';

export const logger = createLogger({ service: 'web' });

export const health = createHealthHandlers();
