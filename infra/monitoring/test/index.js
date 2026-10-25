// `node --test infra/monitoring/test/` resolves the directory to this file (Node does not walk
// directories), so it imports every suite. Run with --experimental-strip-types.
import './alerts.test.ts';
import './config.test.ts';
import './verify-retention.test.ts';
