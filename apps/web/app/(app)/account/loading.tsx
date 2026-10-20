'use client';

// Account loading state (#289): skeleton section cards. The route's `loading.tsx`; each section's
// Suspense fallback on the page uses the same `AccountSkeleton`.
import { AccountSkeleton } from './profile/profile-form.tsx';

export default function AccountLoading() {
  return <AccountSkeleton />;
}
