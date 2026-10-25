// Liveness probe: the process is up. Never touches dependencies; proxy.ts does not run here.
import { withRequestLogging } from '@causedeck/observability';

import { health, logger } from '../../lib/health.ts';

export const dynamic = 'force-dynamic';

export const GET = withRequestLogging(logger, health.healthz, { route: '/healthz' });
