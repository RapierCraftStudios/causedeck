// ZAP guard rails (#104): `assertAllowedTarget` refuses every base URL except the allow-listed
// staging-like compose stack, and `unsuppressedAlerts` picks the medium-or-higher alerts of a ZAP JSON
// report that no unexpired entry of suppressions.tsv covers. ZAP never scans production or a
// third-party host (spike §6; PRD: no court scraping).
//
//   node check-target.mjs target <base-url>
//   node check-target.mjs alerts <zap-report.json> [suppressions.tsv]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Origins the CI compose stack answers on (DOMAIN=localhost, Caddy on :80). Add a staging origin only after review. */
export const ALLOWED_TARGETS = ['http://localhost', 'http://app.localhost'];

export function assertAllowedTarget(value, allowlist = ALLOWED_TARGETS) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ZAP target "${value}" is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ZAP target ${value}: only http(s) is allowed`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`ZAP target ${value}: credentials in the URL are not allowed`);
  }
  if (!allowlist.includes(url.origin)) {
    throw new Error(
      `ZAP target ${value}: ${url.origin} is not in the allow-list (${allowlist.join(', ')})`,
    );
  }
  return url.origin;
}

/** Rows of `<pluginid> TAB <reason> TAB <YYYY-MM-DD expiry>`; `#` lines and blanks are skipped. */
export function parseSuppressions(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line, index) => {
      const [id, reason, expires] = line.split('\t').map((part) => part?.trim());
      if (!id || !reason || !/^\d{4}-\d{2}-\d{2}$/.test(expires ?? '')) {
        throw new Error(`suppressions.tsv row ${index + 1}: need pluginid, reason and expiry date`);
      }
      return { id, reason, expires };
    });
}

/** Alerts with riskcode 2 (medium) or 3 (high) that are not suppressed on `today` (YYYY-MM-DD). */
export function unsuppressedAlerts(report, suppressions, today) {
  const active = new Set(suppressions.filter((row) => row.expires >= today).map((row) => row.id));
  return (report.site ?? [])
    .flatMap((site) => site.alerts ?? [])
    .filter((alert) => Number(alert.riskcode) >= 2 && !active.has(String(alert.pluginid)))
    .map((alert) => ({
      id: String(alert.pluginid),
      name: alert.name ?? alert.alert,
      risk: alert.riskdesc,
    }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, first, second] = process.argv.slice(2);
  try {
    if (mode === 'target') {
      console.log(assertAllowedTarget(first ?? ''));
    } else if (mode === 'alerts') {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      const rows = parseSuppressions(
        readFileSync(second ?? path.join(dir, 'suppressions.tsv'), 'utf8'),
      );
      const found = unsuppressedAlerts(
        JSON.parse(readFileSync(first ?? '', 'utf8')),
        rows,
        new Date().toISOString().slice(0, 10),
      );
      for (const alert of found)
        console.error(`ZAP ${alert.risk}: ${alert.name} (plugin ${alert.id})`);
      if (found.length > 0) process.exit(1);
      console.log('no new medium or higher ZAP alerts');
    } else {
      throw new Error(
        'usage: check-target.mjs target <url> | alerts <report.json> [suppressions.tsv]',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
