// Console navigation (#309): Overview, Adapters, Flags, Workspaces, Support sessions, Audit, Growth,
// filtered by the staff role matrix. 240 px left nav at desktop widths, an icon rail at 768, a
// wrapping row on phones (360).
import {
  Activity,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  ToggleLeft,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { canStaff, type StaffCapability, type StaffRole } from '../lib/roles.ts';

export interface ConsoleNavItem {
  capability: StaffCapability;
  href: '/' | '/adapters' | '/flags' | '/workspaces' | '/support' | '/audit' | '/growth';
  label: string;
  icon: LucideIcon;
}

export const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  { capability: 'overview', href: '/', label: 'Overview', icon: LayoutDashboard },
  { capability: 'adapters', href: '/adapters', label: 'Adapters', icon: Activity },
  { capability: 'flags', href: '/flags', label: 'Flags', icon: ToggleLeft },
  { capability: 'workspaces', href: '/workspaces', label: 'Workspaces', icon: Building2 },
  { capability: 'support', href: '/support', label: 'Support sessions', icon: LifeBuoy },
  { capability: 'audit', href: '/audit', label: 'Audit', icon: ScrollText },
  { capability: 'growth', href: '/growth', label: 'Growth', icon: TrendingUp },
];

export function navItemsFor(role: StaffRole): readonly ConsoleNavItem[] {
  return CONSOLE_NAV.filter((item) => canStaff(role, item.capability));
}

export function ConsoleNav({ role }: { role: StaffRole }) {
  return (
    <nav
      aria-label="Console"
      className="border-line md:bg-surface-raised border-b md:w-16 md:shrink-0 md:border-r md:border-b-0 xl:w-60"
    >
      <ul className="flex flex-wrap gap-1 p-2 md:flex-col">
        {navItemsFor(role).map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="text-ink hover:bg-surface-sunken focus-visible:outline-ring flex h-8 items-center gap-2 rounded-md px-2 text-sm focus-visible:outline-2 md:justify-center xl:justify-start"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="md:sr-only xl:not-sr-only">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
