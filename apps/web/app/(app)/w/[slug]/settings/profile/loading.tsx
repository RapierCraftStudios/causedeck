'use client';

// Profile loading state (#284): skeleton rows in the section card. The route's `loading.tsx`; the
// page's Suspense fallback uses the same `ProfileSkeleton`.
import { ProfileSkeleton } from './profile-form.tsx';

export default function ProfileLoading() {
  return <ProfileSkeleton />;
}
