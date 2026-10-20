// Shared observability for apps/admin: one logger and one health registry (as apps/web/src/health.ts).
import { createHealthHandlers, createLogger } from '@causedeck/observability';

export const logger = createLogger({ service: 'admin' });

export const health = createHealthHandlers();
