export default function Loading() {
  return (
    <main className="mx-auto max-w-xl space-y-3 p-6" aria-busy="true">
      <div className="bg-muted h-6 w-2/3 animate-pulse rounded" />
      <div className="bg-muted h-4 w-full animate-pulse rounded" />
      <div className="bg-muted h-4 w-5/6 animate-pulse rounded" />
    </main>
  );
}
