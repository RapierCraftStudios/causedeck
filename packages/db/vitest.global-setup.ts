// One Testcontainers Postgres per `vitest run`, shared by every worker (see src/testing).
export { default } from './src/testing/global-setup.ts';
