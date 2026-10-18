// Liveness probe: process is up. Never touches dependencies. Must bypass auth middleware.
import { withRequestLogging } from '@causedeck/observability';

import { health, logger } from '../../src/health.ts';

export const dynamic = 'force-dynamic';

export const GET = withRequestLogging(logger, health.healthz, { route: '/healthz' });
