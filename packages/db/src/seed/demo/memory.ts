// Memory of the demo seed (#985): the items M1 to M5 (and a little M6 and M7) each demo lawyer
// "has", with provenance, a few proposals waiting for a decision and the usage that shows where
// an item influenced a brief. The values are plain here: `memory_item.value_ciphertext` is
// envelope-encrypted under the workspace key, which `@causedeck/db` cannot reach, so
// `@causedeck/core` (`seed:demo:content`, and the nightly reset) seals and writes these rows.
// Nothing describes a judge or a bench (the memory guard would refuse it), and all content is fictional.
import { isStrategyKey, type MemoryScope, type MemoryValue } from '@causedeck/validators';

import { demoMember } from './people.ts';
import { addDays, demoId, ID_KIND } from './shared.ts';
import type { DemoWorkspaceSpec } from './workspaces.ts';

export interface DemoMemoryItem {
  id: string;
  layer: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7';
  key: string;
  scope: MemoryScope;
  matterId: string | null;
  personId: string | null;
  ownerUserId: string;
  value: MemoryValue;
  sourceType: 'manual' | 'edit' | 'correction' | 'capture' | 'ai';
  sourceRef: string;
  confidence: number | null;
  confirmationState: 'confirmed' | 'corrected';
  strategy: boolean;
  sharedWithChamber: boolean;
  createdAt: Date;
}

export interface DemoMemoryProposal {
  id: string;
  layer: DemoMemoryItem['layer'];
  key: string;
  scope: MemoryScope;
  matterId: string | null;
  personId: string | null;
  ownerUserId: string;
  value: MemoryValue;
  evidence: Record<string, string | number | boolean>;
  patternKey: string;
  sourceType: 'edit' | 'correction' | 'ai';
  confidence: number;
  status: 'proposed' | 'dismissed' | 'observing';
  proposedAt: Date;
  decidedAt: Date | null;
}

export interface DemoMemory {
  items: DemoMemoryItem[];
  proposals: DemoMemoryProposal[];
  /** `itemId` is one of `items`; the output is a brief of that day. */
  usages: {
    id: string;
    itemId: string;
    userId: string;
    usedIn: 'brief' | 'draft';
    outputRef: string;
    usedAt: Date;
  }[];
}

const AREAS: Record<DemoWorkspaceSpec['key'], string[]> = {
  'chennai-solo': ['Writs', 'Bail', 'Civil suits', 'Arbitration'],
  'bengaluru-chamber': ['Civil suits', 'Commercial arbitration', 'Writs', 'Family'],
};
const COURTS: Record<DemoWorkspaceSpec['key'], string[]> = {
  'chennai-solo': ['High Court of Madras'],
  'bengaluru-chamber': [
    'High Court of Karnataka',
    'City Civil Court Bengaluru',
    'Mayo Hall Court Complex',
  ],
};

export function demoMemory(ws: DemoWorkspaceSpec, today: string): DemoMemory {
  const advocate = demoMember(ws, 'advocate');
  const junior = ws.members.includes('junior') ? demoMember(ws, 'junior') : null;
  const matter = (n: number) => demoId(ID_KIND.matter, n, ws.index);
  const client = (n: number) => demoId(ID_KIND.person, n * 10 + 1, ws.index);
  const id = (n: number) => demoId(ID_KIND.memory, n, ws.index);
  const when = (days: number) => new Date(`${addDays(today, -days)}T10:00:00+05:30`);
  const items: DemoMemoryItem[] = [];
  const add = (
    n: number,
    key: string,
    scope: MemoryScope,
    value: MemoryValue,
    extra: Partial<DemoMemoryItem> = {},
  ): void => {
    items.push({
      id: id(n),
      layer: key.slice(0, 2) as DemoMemoryItem['layer'],
      key,
      scope,
      matterId: null,
      personId: null,
      ownerUserId: advocate.id,
      value,
      sourceType: 'manual',
      sourceRef: 'seed:demo',
      confidence: null,
      confirmationState: 'confirmed',
      strategy: isStrategyKey(key as never),
      sharedWithChamber: false,
      createdAt: when(30 - n),
      ...extra,
    });
  };

  // M1 profile (onboarding answers) and M2 working preferences.
  add(1, 'M1.courts', 'user', COURTS[ws.key]);
  add(2, 'M1.practice_areas', 'user', AREAS[ws.key]);
  add(
    3,
    'M1.languages',
    'user',
    ws.key === 'chennai-solo' ? ['English', 'Tamil'] : ['English', 'Kannada'],
  );
  add(
    4,
    'M1.approach',
    'user',
    'Prefers a short note of the issues on top of every brief, then the orders in date order.',
  );
  add(
    5,
    'M2.brief_format',
    'user',
    'Issues first, orders second, obligations last; one page per matter.',
  );
  add(6, 'M2.always_carry', 'user', [
    'Vakalat',
    'Certified copy of the last order',
    'Memo of citations',
  ]);
  add(7, 'M2.client_update_tone', 'user', 'Plain and formal; no promises about outcomes.');
  add(8, 'M2.settlement_posture', 'user', 'Open to early mediation where the client agrees.');
  // M3 matter memory on three matters, with provenance from a capture and an edit.
  add(
    9,
    'M3.synopsis',
    'matter',
    'Challenge to a licensing refusal; the counter affidavit is the next step.',
    {
      matterId: matter(1),
      sourceType: 'capture',
      sourceRef: 'capture:demo-forward',
      confidence: 0.9,
    },
  );
  add(
    10,
    'M3.client_instruction',
    'matter',
    'Call the client the evening before each hearing; do not email.',
    {
      matterId: matter(2),
      sourceType: 'edit',
      sourceRef: 'edit-pattern:call-before-hearing',
      confirmationState: 'corrected',
    },
  );
  add(
    11,
    'M3.strategy_note',
    'matter',
    'Keep the interim relief prayer narrow; offer an undertaking if asked.',
    { matterId: matter(3) },
  );
  // M4 private court notes: one private, one shared with the chamber.
  add(
    12,
    'M4.hall_note',
    'user',
    'The hall clerk takes mentioning slips before ten; carry two copies.',
  );
  add(
    13,
    'M4.registry_tip',
    'user',
    'File on Monday mornings: the registry clears the queue faster.',
    { sharedWithChamber: true },
  );
  // M5 playbooks and the precedent bank, in workspace scope so the chamber shares them.
  add(
    14,
    'M5.playbook',
    'workspace',
    [
      'name: Writ petition (demo)',
      'court: -',
      'format: writ_petition',
      'prayer: Issue a writ of certiorari quashing the impugned order',
      'prayer: Grant interim stay of the impugned order pending disposal',
      'annexure: Impugned order',
      'annexure: Representation made',
    ],
    { sourceType: 'edit', sourceRef: 'seed:demo' },
  );
  add(
    15,
    'M5.precedent',
    'workspace',
    'The petitioner has no other efficacious remedy and the cause of action arose within the jurisdiction of this Court. (Synthetic passage.)',
  );
  add(
    16,
    'M5.style',
    'user',
    'Number prayers in lower-case roman numerals; salutation "Respectfully submitted".',
  );
  // M6 relationship and M7 recognition.
  add(17, 'M6.client_language', 'user', ws.key === 'chennai-solo' ? 'ta' : 'kn', {
    personId: client(1),
  });
  add(18, 'M6.preferred_contact', 'user', 'Phone after 6 pm.', { personId: client(2) });
  add(19, 'M7.party_alias', 'user', 'Also known as "Sudar Textiles" in the pleadings.');

  const proposal = (
    n: number,
    key: string,
    value: MemoryValue,
    status: DemoMemoryProposal['status'],
    extra: Partial<DemoMemoryProposal> = {},
  ): DemoMemoryProposal => ({
    id: demoId(ID_KIND.memoryProposal, n, ws.index),
    layer: key.slice(0, 2) as DemoMemoryItem['layer'],
    key,
    scope: 'user',
    matterId: null,
    personId: null,
    ownerUserId: advocate.id,
    value,
    evidence: { editCount: 3, outputs: 3 },
    patternKey: `demo-pattern-${String(n)}`,
    sourceType: 'edit',
    confidence: 0.8,
    status,
    proposedAt: when(2),
    decidedAt: status === 'dismissed' ? when(1) : null,
    ...extra,
  });
  const proposals = [
    proposal(
      1,
      'M2.always_carry',
      [
        'Vakalat',
        'Certified copy of the last order',
        'Memo of citations',
        'Spare affidavit copies',
      ],
      'proposed',
    ),
    proposal(
      2,
      'M2.brief_format',
      'Put the next date and the stage in the first line of the brief.',
      'proposed',
      { sourceType: 'correction', evidence: { corrections: 3 } },
    ),
    proposal(3, 'M1.languages', ['English', 'Hindi'], 'dismissed', {
      sourceType: 'ai',
      confidence: 0.55,
    }),
    proposal(4, 'M5.style', 'Open every prayer with "It is therefore prayed that".', 'observing', {
      evidence: { editCount: 2 },
    }),
  ];
  if (junior !== null) {
    proposals.push(
      proposal(
        5,
        'M2.client_update_tone',
        'Short and warm in Kannada for family matters.',
        'proposed',
        { ownerUserId: junior.id },
      ),
    );
  }

  const usages = [1, 2, 6, 9, 14].map((n, k) => ({
    id: demoId(ID_KIND.memoryUsage, k + 1, ws.index),
    itemId: id(n),
    userId: advocate.id,
    usedIn: k % 2 === 0 ? ('brief' as const) : ('draft' as const),
    outputRef: `demo-output-${String(k + 1)}`,
    usedAt: when(k),
  }));
  return { items, proposals, usages };
}
