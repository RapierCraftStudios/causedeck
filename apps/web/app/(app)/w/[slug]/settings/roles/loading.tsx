'use client';

// Roles loading state (#285): skeleton cards for the settings and the restricted matters. The
// route's `loading.tsx`; the page's Suspense fallback uses the same `RolesSkeleton`.
import { RolesSkeleton } from './role-settings-form.tsx';

export default function RolesLoading() {
  return <RolesSkeleton />;
}
