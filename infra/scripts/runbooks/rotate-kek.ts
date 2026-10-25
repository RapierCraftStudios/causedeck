// KEK rotation entry (#103): re-wraps every live workspace DEK under the new KEK with `rewrapAll`.
// Run through rotate-kek.sh, which validates the environment. Keys come from env vars only and are
// never printed. Relative imports because infra/ is not a workspace package.
import { Secret } from '../../../packages/config/src/env/index.ts';
import { createDb } from '../../../packages/db/src/client.ts';
import {
  EnvKeyProvider,
  kekFromBase64,
  pendingRewrap,
  rewrapAll,
} from '../../../packages/storage/src/index.ts';

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

const newId = process.env['KEK_NEW_ID'] ?? 'kek-2';
const oldId = process.env['KEK_OLD_ID'] ?? 'kek-1';
if (newId === oldId) throw new Error('KEK_NEW_ID and KEK_OLD_ID must differ');
const dryRun = process.argv.includes('--dry-run');

// The new KEK is first (current); the old one stays until `remaining` is 0.
const provider = new EnvKeyProvider([
  kekFromBase64(newId, need('KEK_NEW_BASE64')),
  kekFromBase64(oldId, need('KEK_OLD_BASE64')),
]);
const db = createDb({ url: new Secret(need('DATABASE_URL')), role: 'app', max: 2 });

try {
  if (dryRun) {
    const pending = await pendingRewrap(db, newId);
    console.log(JSON.stringify({ dryRun: true, newKekId: newId, pending: pending.length }));
  } else {
    const result = await rewrapAll(db, provider, newId);
    console.log(JSON.stringify({ newKekId: newId, ...result }));
    if (result.remaining !== 0) process.exitCode = 1;
  }
} finally {
  await db.$client.end({ timeout: 5 });
}
