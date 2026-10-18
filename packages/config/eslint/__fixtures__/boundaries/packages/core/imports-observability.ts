// Allowed: core jobs use observability for spans and job logs (#15).
import { observabilityName } from '../observability';

export const name: string = observabilityName;
