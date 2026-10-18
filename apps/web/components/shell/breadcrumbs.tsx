'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@causedeck/ui/breadcrumb';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';

import { NAV_ITEMS } from '../../lib/nav.ts';
import type { Workspace } from '../../lib/workspace-context.ts';

interface Crumb {
  label: string;
  href: string;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Workspace, then the current destination, then any deeper segment. The last crumb is the page. */
export function Breadcrumbs({ workspace }: { workspace: Workspace }) {
  const t = useTranslations();
  const pathname = usePathname();
  const base = `/w/${encodeURIComponent(workspace.slug)}`;
  const rest = pathname.startsWith(`${base}/`)
    ? pathname
        .slice(base.length + 1)
        .split('/')
        .filter(Boolean)
    : [];

  const crumbs: Crumb[] = [{ label: workspace.name, href: `${base}/today` }];
  const [first, ...deeper] = rest;
  const item = NAV_ITEMS.find((entry) => entry.id === first);
  if (item) {
    crumbs.push({ label: t(item.labelKey), href: `${base}/${item.id}` });
    let href = `${base}/${item.id}`;
    for (const segment of deeper) {
      href = `${href}/${segment}`;
      const label = decode(segment);
      crumbs.push({ label: label.charAt(0).toLocaleUpperCase() + label.slice(1), href });
    }
  }

  return (
    <Breadcrumb
      labels={{ nav: t('shell.breadcrumbs.label'), more: t('shell.breadcrumbs.more') }}
      className="min-w-0"
    >
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${String(index)}:${crumb.href}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className="min-w-0">
                {last ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className="truncate">
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
