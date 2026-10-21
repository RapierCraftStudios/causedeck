import { defineProject } from 'vitest/config';

// `test:metrics` (#401): the Madras HC golden metrics on seeded generated data. CI runs it in the
// `rest` shard after `gen:fixtures --adapter madras --seed 7`. No database globalSetup, so the run
// needs no Docker; the default `test` run includes this file too.
export default defineProject({
  test: {
    name: '@causedeck/adapters:metrics',
    include: ['src/madras-hc/generated-metrics.test.ts'],
    testTimeout: 120_000,
  },
});
