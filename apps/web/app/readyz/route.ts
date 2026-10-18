// Readiness probe: 200 only when every registered check passes, 503 otherwise. Must bypass auth
// middleware.
import { withRequestLogging } from '@causedeck/observability';

import { health, logger } from '../../src/health.ts';

export const dynamic = 'force-dynamic';

export const GET = withRequestLogging(logger, health.readyz, { route: '/readyz' });
