/** pg-boss background workers (#15). The process entry point is `src/main.ts`. */
export const appName: string = '@causedeck/worker';

export { closeServer, startHealthServer, workerChecks } from './health.ts';
export { registerSchedules, SCHEDULE_TIMEZONE } from './schedules.ts';
export {
  createWorker,
  DB_CLOSE_TIMEOUT_SEC,
  DLQ_RETENTION_SECONDS,
  ensureQueue,
  handleShutdownSignals,
  SHUTDOWN_TIMEOUT_MS,
  type CreateWorkerOptions,
  type ShutdownHooks,
  type Worker,
} from './worker.ts';
