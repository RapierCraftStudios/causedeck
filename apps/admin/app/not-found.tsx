// Same wording as the gate's generic 404 (lib/not-found-response.ts); nothing about the console.
export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid max-w-md gap-2 px-6 py-24">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-ink-muted">Not found.</p>
    </main>
  );
}
