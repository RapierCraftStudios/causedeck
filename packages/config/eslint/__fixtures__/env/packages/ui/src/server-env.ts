// Violation: packages/ui is client code and may not import the server env.
import { serverEnv } from '@causedeck/config/env';

export const load = serverEnv;
