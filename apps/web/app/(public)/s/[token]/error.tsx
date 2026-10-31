'use client';

/** A failed read shows the same generic page: nothing about the link or its matter. */
export default function StatusLinkError() {
  return (
    <main className="mx-auto max-w-xl p-6" role="alert">
      <h1 className="text-xl font-semibold">This link is no longer available</h1>
      <p className="text-muted-foreground mt-2">Ask your advocate for a new link.</p>
    </main>
  );
}
