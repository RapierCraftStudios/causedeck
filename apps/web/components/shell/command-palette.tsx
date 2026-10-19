'use client';

// The command palette dialog. Only ever loaded with `import()` (use-command-palette.ts), on first
// open or at idle, so cmdk stays out of the initial route JS (#11: the shell adds at most 40 KB
// gzip). Motion comes from DialogContent's token durations, which are 0.01ms under
// `prefers-reduced-motion`.
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
  CommandShortcut,
} from '@causedeck/ui/command';
import { Kbd } from '@causedeck/ui/kbd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore } from 'react';

import { commandsSnapshot, getCommands, subscribeCommands } from '../../lib/commands/registry.ts';
import { pushRecent, readRecent } from '../../lib/commands/recent.ts';
import { rankCommands } from '../../lib/commands/search.ts';
import type { Command, CommandGroupId } from '../../lib/commands/types.ts';
import type { FlagKey, Role } from '../../lib/workspace-context.ts';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  role: Role;
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

interface Section {
  key: string;
  heading: string;
  items: { value: string; command: Command }[];
}

export function CommandPalette({ open, onOpenChange, slug, role, isEnabled }: CommandPaletteProps) {
  const t = useTranslations();
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      labels={{
        label: t('palette.title'),
        placeholder: t('palette.placeholder'),
        description: t('palette.description'),
        close: t('palette.close'),
        empty: t('palette.empty'),
      }}
      content={{ className: 'md:max-w-[640px]' }}
    >
      {/* Unmounts on close, so every open starts with an empty query and fresh recents. */}
      <PaletteBody
        slug={slug}
        role={role}
        isEnabled={isEnabled}
        close={() => {
          onOpenChange(false);
        }}
      />
    </CommandDialog>
  );
}

function PaletteBody({
  slug,
  role,
  isEnabled,
  close,
}: Pick<CommandPaletteProps, 'slug' | 'role' | 'isEnabled'> & { close: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const registered = useSyncExternalStore(subscribeCommands, commandsSnapshot, commandsSnapshot);
  const commands = useMemo(
    () => getCommands({ role, isEnabled }, registered),
    [registered, role, isEnabled],
  );
  const [search, setSearch] = useState('');
  const [recent] = useState(() => readRecent(slug));

  // Registry keys are plain strings (commands register at runtime); the catalog has them all.
  const labelOf = (command: Command) => t(command.labelKey as Parameters<typeof t>[0]);
  const heading = (group: CommandGroupId) => t(`palette.groups.${group}`);

  const sections: Section[] = [];
  if (search.trim() === '') {
    const byId = new Map(commands.map((command) => [command.id, command]));
    const recentItems = recent.flatMap((id) => {
      const command = byId.get(id);
      return command ? [{ value: `recent:${id}`, command }] : [];
    });
    if (recentItems.length > 0) {
      sections.push({ key: 'recent', heading: t('palette.recent'), items: recentItems });
    }
  }
  // Groups appear in the order of their best match (group order when the query is empty).
  for (const { command } of rankCommands(commands, search, labelOf)) {
    let section = sections.find((entry) => entry.key === command.group);
    if (!section) {
      section = { key: command.group, heading: heading(command.group), items: [] };
      sections.push(section);
    }
    section.items.push({ value: command.id, command });
  }

  const run = (command: Command) => {
    pushRecent(slug, command.id);
    close();
    void command.perform({
      slug,
      close,
      navigate: (href) => {
        router.push(href);
      },
    });
  };

  return (
    <>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={t('palette.placeholder')}
        className="h-12"
      />
      <CommandEmpty>{t('palette.empty')}</CommandEmpty>
      <CommandList>
        {sections.map((section) => (
          <CommandGroup
            key={section.key}
            heading={section.heading}
            data-palette-group={section.key}
          >
            {section.items.map(({ value, command }) => {
              const Icon = command.icon;
              return (
                <CommandItem
                  key={value}
                  value={value}
                  onSelect={() => {
                    run(command);
                  }}
                  className="min-h-11"
                >
                  {Icon ? <Icon aria-hidden="true" /> : null}
                  <span className="truncate">{labelOf(command)}</span>
                  {command.shortcut ? (
                    <CommandShortcut>
                      <Kbd hotkey={command.shortcut} />
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      <p
        data-palette-hints=""
        className="border-line text-ink-subtle border-t px-3 py-2 text-xs max-md:hidden"
      >
        {t('palette.hints')}
      </p>
    </>
  );
}
