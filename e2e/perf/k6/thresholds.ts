// k6 `options.thresholds` per route group (#105): re-exported from the shared budgets so Lighthouse,
// the bundle budget and the load tests never drift apart.
import { k6Thresholds } from '../thresholds.ts';

export const thresholds = k6Thresholds();
