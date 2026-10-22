'use client';

// The forum selector of the rosters page (#435, part 2 of #391): below 768 px a `Select` at the top
// that navigates to `?forum=<code>`; from 768 px a 240 px left rail of links, the selected forum
// marked `aria-current="page"`. Only forums the workspace has rosters for are listed.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface RosterForumOption {
  code: string;
  court: string;
  seat: string | null;
}

/** `/w/<slug>/courts/rosters?forum=<code>`, the rosters page with a forum selected. */
export function rostersHref(slug: string, code?: string): string {
  const base = `/w/${encodeURIComponent(slug)}/courts/rosters`;
  return code === undefined ? base : `${base}?forum=${encodeURIComponent(code)}`;
}

export interface RosterForumPickerProps {
  slug: string;
  forums: readonly RosterForumOption[];
  selected: string;
}

const railLink = [
  'focus-visible:outline-ring flex flex-col rounded-md px-3 py-2 text-sm outline-offset-2',
  'transition-colors duration-150 focus-visible:outline-2 motion-reduce:transition-none',
  'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  'aria-[current=page]:bg-surface-sunken aria-[current=page]:text-ink aria-[current=page]:font-medium',
].join(' ');

export function RosterForumPicker({ slug, forums, selected }: RosterForumPickerProps) {
  const t = useTranslations('courtsRosters.forums');
  const router = useRouter();
  return (
    <div data-slot="roster-forum-picker">
      <div className="md:hidden">
        <Select
          value={selected}
          onValueChange={(code) => {
            router.push(rostersHref(slug, code));
          }}
        >
          <SelectTrigger aria-label={t('label')} data-roster-forum-select="" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forums.map((forum) => (
              <SelectItem key={forum.code} value={forum.code}>
                {forum.court}
                {forum.seat === null ? '' : `, ${forum.seat}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label={t('rail')} className="hidden w-60 md:block">
        <ul className="flex flex-col gap-1">
          {forums.map((forum) => (
            <li key={forum.code}>
              <Link
                href={rostersHref(slug, forum.code)}
                data-roster-forum={forum.code}
                aria-current={forum.code === selected ? 'page' : undefined}
                className={railLink}
              >
                <span>
                  {forum.court}
                  {forum.seat === null ? '' : `, ${forum.seat}`}
                </span>
                <span className="text-ink-subtle font-mono text-xs break-all">{forum.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
