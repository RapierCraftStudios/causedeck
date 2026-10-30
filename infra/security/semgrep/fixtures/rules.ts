// Fixtures for rules.yml: `ruleid:` lines must match, `ok:` lines must not (semgrep --test).
declare const db: { execute(query: unknown): Promise<unknown> };
declare const tx: { execute(query: unknown): Promise<unknown> };
declare const sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const withWorkspace: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
declare const created: { uploadUrl: string };
declare const userUrl: string;

export async function rawSql(id: string) {
  // ruleid: causedeck.raw-sql-bypasses-with-workspace
  await db.execute(sql`select * from matter where id = ${id}`);
  // ok: causedeck.raw-sql-bypasses-with-workspace
  await db.execute(sql`select 1`);
  // ok: causedeck.raw-sql-bypasses-with-workspace
  await withWorkspace((inner) => tx.execute(sql`select * from matter where id = ${String(inner)}`));
}

export async function outbound() {
  // ruleid: causedeck.fetch-to-unlisted-host
  await fetch('https://example.com/collect');
  // ruleid: causedeck.fetch-to-unlisted-host
  await fetch(userUrl, { method: 'POST' });
  // ok: causedeck.fetch-to-unlisted-host
  await fetch('/v1/me');
  // ok: causedeck.fetch-to-unlisted-host
  await fetch('https://api.razorpay.com/v1/subscriptions');
  // ok: causedeck.fetch-to-unlisted-host
  await fetch(created.uploadUrl, { method: 'PUT' });
}

export const levels = {
  // ruleid: causedeck.l5-automation-action
  name: 'L5',
  // ok: causedeck.l5-automation-action
  fine: 'L4',
};

export const proposal = {
  // ruleid: causedeck.l5-automation-action
  automationLevel: 5,
};

export const okProposal = {
  // ok: causedeck.l5-automation-action
  automationLevel: 4,
};
