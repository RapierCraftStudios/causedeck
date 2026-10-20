'use client';

// Privacy loading state (#286): skeleton cards for the AI processing and the editable settings.
// The route's `loading.tsx`; the page's Suspense fallback uses the same `PrivacySkeleton`.
import { PrivacySkeleton } from './privacy-form.tsx';

export default function PrivacyLoading() {
  return <PrivacySkeleton />;
}
