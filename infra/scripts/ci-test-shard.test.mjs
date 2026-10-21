import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NAMED_SHARDS, SHARD_NAMES, selectShard, testPackages } from './ci-test-shard.mjs';

const ALL = [
  '@causedeck/db',
  '@causedeck/auth',
  '@causedeck/core',
  '@causedeck/web',
  '@causedeck/admin',
  '@causedeck/api',
  '@causedeck/worker',
  '@causedeck/flags',
  '@causedeck/brand-new',
];

test('every package lands in exactly one shard', () => {
  const seen = SHARD_NAMES.flatMap((shard) => selectShard(ALL, shard));
  assert.deepEqual([...seen].sort(), [...ALL].sort());
});

test('rest picks up packages no named shard lists', () => {
  assert.deepEqual(selectShard(ALL, 'rest'), ['@causedeck/flags', '@causedeck/brand-new']);
});

test('named shards only return packages that are in the run', () => {
  assert.deepEqual(selectShard(['@causedeck/web'], 'db'), []);
  assert.deepEqual(selectShard(['@causedeck/db'], 'db'), ['@causedeck/db']);
  assert.ok(NAMED_SHARDS.services.length === 3);
});

test('unknown shard is an error', () => {
  assert.throws(() => selectShard(ALL, 'nope'), /unknown shard/);
});

test('testPackages drops workspaces without a test script', () => {
  const dry = {
    tasks: [
      { task: 'test', package: 'a', command: 'vitest run' },
      { task: 'test', package: 'b', command: '<NONEXISTENT>' },
      { task: 'lint', package: 'c', command: 'eslint .' },
    ],
  };
  assert.deepEqual(testPackages(dry), ['a']);
});
