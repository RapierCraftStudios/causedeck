'use client';

// Integrations loading state (#287): skeleton cards for the intake address and the feed URL. The
// route's `loading.tsx`; the page's Suspense fallback uses the same `IntegrationsSkeleton`.
import { IntegrationsSkeleton } from './integration-card.tsx';

export default function IntegrationsLoading() {
  return <IntegrationsSkeleton />;
}
