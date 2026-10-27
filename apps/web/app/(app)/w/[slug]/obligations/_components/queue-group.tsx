'use client';
// One queue group (#68): the sticky header with its count and collapse toggle, then the rows.
// Rows animate their reorder with the pattern's 220 ms layout transition (a short fade under
// reduced motion), so the group only lists them.
import { GroupHeader } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { QueueGroup as GroupName } from '@causedeck/validators/obligation';

export interface QueueGroupProps {
  group: GroupName;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function QueueGroupSection({
  group,
  count,
  collapsed,
  onToggle,
  children,
}: QueueGroupProps) {
  const t = useTranslations('obligations.groups');
  return (
    <section data-slot="obligation-group" data-group={group} className="flex flex-col">
      <GroupHeader
        label={t(group)}
        count={count}
        collapsed={collapsed}
        overdue={group === 'overdue'}
        onClick={onToggle}
      />
      {collapsed ? null : <div className="flex flex-col gap-2 pb-3">{children}</div>}
    </section>
  );
}
