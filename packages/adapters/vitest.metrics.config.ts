import { defineProject } from 'vitest/config';

// `test:metrics` (#401, #408): the Madras HC and Karnataka HC golden metrics on seeded generated
// data. CI runs it in the `rest` shard after `gen:fixtures --adapter madras|karnataka --seed 7`.
// No database globalSetup, so the run needs no Docker; the default `test` run includes these too.
export default defineProject({
  test: {
    name: '@causedeck/adapters:metrics',
    include: [
      'src/madras-hc/generated-metrics.test.ts',
      'src/karnataka-hc/generated-metrics.test.ts',
    ],
    testTimeout: 120_000,
  },
});
