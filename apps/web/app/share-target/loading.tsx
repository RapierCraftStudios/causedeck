import { Skeleton } from '@causedeck/ui/skeleton';

/** Share-target loading: file-row skeletons, never a spinner-only screen. */
export default function ShareTargetLoading() {
  return (
    <main
      id="main"
      aria-busy="true"
      className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-4 px-4 py-6"
    >
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-11 w-40" />
    </main>
  );
}
