// Sums the memory limits of the services in a rendered compose config and checks a budget (#883).
//   docker compose -f compose.prod.yml --env-file <env> config --format json \
//     | node preset-budget.mjs <name> <max-total-MiB> [min-postgres-MiB]
// Counts every service that is active in the render (profiles init, backup, migrate are not), each
// limit times its replicas. The sum is a ceiling, not actual use.
import { readFileSync } from 'node:fs';

const MIB = 1024 * 1024;

/** Memory limit in bytes from compose's normalised form (bytes) or a human size such as 768m. */
export function toBytes(value) {
  if (typeof value === 'number') return value;
  const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(String(value).trim());
  if (!m) throw new Error(`unparseable memory limit: ${value}`);
  const unit = { '': 1, k: 1024, m: MIB, g: 1024 * MIB }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * unit);
}

export function totals(config) {
  const perService = {};
  for (const [name, svc] of Object.entries(config.services ?? {})) {
    const limit = svc.deploy?.resources?.limits?.memory;
    if (limit === undefined) throw new Error(`${name} has no memory limit`);
    const replicas = Number(svc.deploy?.replicas ?? 1);
    perService[name] = { replicas, mib: toBytes(limit) / MIB };
  }
  const totalMiB = Object.values(perService).reduce((sum, s) => sum + s.mib * s.replicas, 0);
  return { perService, totalMiB };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [name, max, minPostgres] = process.argv.slice(2);
  const { perService, totalMiB } = totals(JSON.parse(readFileSync(0, 'utf8')));
  console.log(`preset ${name}: memory limits total ${totalMiB} MiB (budget ${max} MiB)`);
  if (totalMiB > Number(max)) {
    console.error(`preset ${name} exceeds its memory budget: ${totalMiB} > ${max} MiB`);
    process.exit(1);
  }
  if (minPostgres && perService.postgres.mib < Number(minPostgres)) {
    console.error(`preset ${name}: postgres limit ${perService.postgres.mib} MiB < ${minPostgres}`);
    process.exit(1);
  }
}
