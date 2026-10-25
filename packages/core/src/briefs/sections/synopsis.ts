// The synopsis section (#60): the M3 synopsis through the memory port, behind `memory.read` (checked
// by the caller); the strategy line only for a role that holds `strategy.read`, left out otherwise.
import type { SynopsisSection } from '@causedeck/validators';

import { toBriefLine, withProvenance, type MemoryProvider, type MemoryQuery } from '../assemble.ts';

export async function synopsisSection(
  memory: MemoryProvider,
  query: MemoryQuery,
  canStrategy: boolean,
): Promise<SynopsisSection | null> {
  const synopsis = await memory.synopsis(query);
  if (synopsis === null) return null;
  const [line] = withProvenance([toBriefLine(synopsis.line)]);
  if (line === undefined) return null;
  const [strategy] =
    canStrategy && synopsis.strategy !== null
      ? withProvenance([toBriefLine(synopsis.strategy)])
      : [];
  return { line, strategy: strategy ?? null };
}
