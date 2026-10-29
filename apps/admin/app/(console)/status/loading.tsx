export default function StatusLoading() {
  return (
    <section aria-busy="true" aria-label="Loading status incidents" className="grid gap-4">
      <div className="bg-surface-raised h-6 w-40 animate-pulse rounded" />
      <div className="bg-surface-raised h-4 w-3/4 animate-pulse rounded" />
      <div className="bg-surface-raised h-24 animate-pulse rounded" />
      <div className="bg-surface-raised h-24 animate-pulse rounded" />
    </section>
  );
}
