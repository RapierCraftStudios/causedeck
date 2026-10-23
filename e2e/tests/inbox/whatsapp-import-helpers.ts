// Shared by the WhatsApp import specs (#527): turn `capture.whatsapp-import` on for the shell
// workspace and build synthetic chat exports. Fictional data only.
import postgres from 'postgres';

import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE } from '../shell/helpers.ts';

export const IMPORT_PATH = 'inbox/import/whatsapp';

export async function enableWhatsAppImport(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into workspace_feature_flag (workspace_id, key, enabled, updated_by)
      select o.id, 'capture.whatsapp-import', true, m.user_id
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
}

/** An Android-format export of `count` messages between two fictional chambers members. */
export function syntheticChat(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const minute = String(i % 60).padStart(2, '0');
    const sender = i % 2 === 0 ? 'Asha Rao' : 'Ravi';
    lines.push(`${day}/10/2026, 10:${minute} - ${sender}: Filing update number ${String(i + 1)}`);
  }
  return lines.join('\n');
}

export const CHAT_FILE = 'WhatsApp Chat with Chambers.txt';

export const PII_CHAT = [
  '16/10/2026, 09:00 - Asha Rao: Client Aadhaar 2345 6789 0123 for the affidavit',
  '16/10/2026, 09:01 - Ravi: PAN ABCDE1234F',
  '16/10/2026, 09:02 - Ravi: Filing is done',
  '16/10/2026, 09:03 - Asha Rao: Thanks, listing is on Monday',
].join('\n');
