// Console navigation (#309): Overview, Adapters, Sources, Data Ops, Coverage, Flags, Workspaces, Support sessions, Audit, Business (admin only), Growth, Migrations,
// filtered by the staff role matrix. 240 px left nav at desktop widths, an icon rail at 768, a
// wrapping row on phones (360).
import {
  Activity,
  BarChart3,
  Building2,
  Grid3x3,
  CircleDollarSign,
  ClipboardCheck,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  ToggleLeft,
  UploadCloud,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { canStaff, type StaffCapability, type StaffRole } from '../lib/roles.ts';

export interface ConsoleNavItem {
  capability: StaffCapability;
  href:
    | '/'
    | '/adapters'
    | '/sources'
    | '/data-ops'
    | '/review'
    | '/coverage'
    | '/flags'
    | '/workspaces'
    | '/support'
    | '/audit'
    | '/business'
    | '/growth'
    | '/migrations';
  label: string;
  icon: LucideIcon;
}

export const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  { capability: 'overview', href: '/', label: 'Overview', icon: LayoutDashboard },
  { capability: 'adapters', href: '/adapters', label: 'Adapters', icon: Activity },
  { capability: 'sources', href: '/sources', label: 'Sources', icon: Globe },
  { capability: 'data-ops', href: '/data-ops', label: 'Data Ops', icon: BarChart3 },
  { capability: 'data-ops', href: '/review', label: 'Review queue', icon: ClipboardCheck },
  { capability: 'coverage', href: '/coverage', label: 'Coverage', icon: Grid3x3 },
  { capability: 'flags', href: '/flags', label: 'Flags', icon: ToggleLeft },
  { capability: 'workspaces', href: '/workspaces', label: 'Workspaces', icon: Building2 },
  { capability: 'support', href: '/support', label: 'Support sessions', icon: LifeBuoy },
  { capability: 'audit', href: '/audit', label: 'Audit', icon: ScrollText },
  { capability: 'business', href: '/business', label: 'Business', icon: CircleDollarSign },
  { capability: 'growth', href: '/growth', label: 'Growth', icon: TrendingUp },
  { capability: 'migrations', href: '/migrations', label: 'Migrations', icon: UploadCloud },
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
