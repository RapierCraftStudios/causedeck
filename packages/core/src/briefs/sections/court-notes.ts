// The court-notes section (#60): the M4 private court notes through the memory port. The caller reads
// them only for a role holding `memory.read` and `strategy.read` (a clerk gets null, server-side). A
// note is author-private unless the chamber shares it.
import type { BriefLine } from '@causedeck/validators';

import { toBriefLine, withProvenance, type MemoryProvider, type MemoryQuery } from '../scope.ts';

export async function courtNotesSection(
  memory: MemoryProvider,
  query: MemoryQuery,
  userId: string,
): Promise<BriefLine[]> {
  // Called only for a role holding `strategy.read`; the port cites each note it returns.
  const notes = await memory.courtNotes({ ...query, canStrategy: true });
  return withProvenance(
    notes.filter((n) => n.shared || n.authorUserId === userId).map((n) => toBriefLine(n.line)),
  );
}
