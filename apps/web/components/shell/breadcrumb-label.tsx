'use client';
// Publishes a label for one path segment to the topbar breadcrumb (#1132, lib/breadcrumb-labels.ts):
// the matter layout renders it so the crumb shows the matter's title, not its id. Renders nothing;
// the label goes away when the route unmounts.
import { useEffect } from 'react';

import { setBreadcrumbLabel } from '../../lib/breadcrumb-labels.ts';

export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  useEffect(() => setBreadcrumbLabel(segment, label), [segment, label]);
  return null;
}
