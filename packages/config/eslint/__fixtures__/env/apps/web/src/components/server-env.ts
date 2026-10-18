// Violation: a client component imports the server env.
import { serverEnv } from '@causedeck/config/env';

export const load = serverEnv;
