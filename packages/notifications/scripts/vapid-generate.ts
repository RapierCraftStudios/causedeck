// `pnpm --filter @causedeck/notifications vapid:generate` (#197): print a fresh VAPID key pair as
// env lines. Nothing is written to disk; paste the lines into your env or secret store.
import { generateVapidKeys } from '../src/push/vapid.ts';

const { publicKey, privateKey } = generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
