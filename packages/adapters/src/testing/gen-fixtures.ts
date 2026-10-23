// `pnpm --filter @causedeck/adapters gen:fixtures --adapter madras --seed 7` (#401; `karnataka`,
// #408): writes an
// adapter's seeded synthetic documents with their truth files to the git-ignored
// `fixtures/generated/<adapterId>/`, replacing what was there. Same seed, same bytes. Files only:
// no network. Runs with `node --experimental-strip-types`, so it imports nothing that needs a
// bundler or the app env (not golden.ts, which reads `@causedeck/config/env`).
import { rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { writeGeneratedFixtures as writeA0 } from '../generic-a0/synthetic/generate.ts';
import { writeGeneratedFixtures as writeKarnataka } from '../karnataka-hc/synthetic/generate.ts';
import { writeGeneratedFixtures as writeMadras } from '../madras-hc/synthetic/generate.ts';

/** Document counts by kind; `emails` only for an adapter that reads emails. */
type Counts = Record<'cause_list' | 'order' | 'registry_notice', number> & { emails?: number };

/** Generators by `--adapter` name. */
const GENERATORS: Record<
  string,
  | { adapterId: string; write: (options: { seed: number; outDir: string }) => Promise<Counts> }
  | undefined
> = {
  madras: { adapterId: 'in.tn.madras-hc.principal', write: writeMadras },
  karnataka: { adapterId: 'in.ka.karnataka-hc.bengaluru', write: writeKarnataka },
  a0: { adapterId: 'generic.a0', write: writeA0 },
};

const GENERATED_ROOT = path.resolve(import.meta.dirname, '../../fixtures/generated');
const USAGE = `usage: gen:fixtures --adapter <${Object.keys(GENERATORS).join('|')}> --seed <integer>`;

const { values } = parseArgs({
  options: { adapter: { type: 'string' }, seed: { type: 'string' } },
  strict: true,
});
const generator = GENERATORS[values.adapter ?? ''];
const seed = Number(values.seed);
if (generator === undefined || values.seed === undefined || !Number.isSafeInteger(seed)) {
  console.error(USAGE);
  process.exit(1);
}

const outDir = path.join(GENERATED_ROOT, generator.adapterId);
rmSync(outDir, { recursive: true, force: true });
const counts = await generator.write({ seed, outDir });
const emails = counts.emails ?? 0;
console.info(
  `${generator.adapterId} seed ${String(seed)}: ${String(counts.cause_list - emails)} lists, ${counts.emails === undefined ? '' : `${String(emails)} emails, `}${String(counts.order)} orders, ${String(counts.registry_notice)} registry notices -> ${path.relative(process.cwd(), outDir)}`,
);
