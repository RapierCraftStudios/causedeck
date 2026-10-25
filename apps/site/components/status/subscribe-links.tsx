export function SubscribeLinks() {
  return (
    <nav aria-label="Subscribe to status updates" className="text-sm">
      <span className="text-ink-muted">Subscribe: </span>
      <a className="cd-link" href="/status/feed.xml">
        RSS
      </a>
      {' · '}
      <a className="cd-link" href="/status/atom.xml">
        Atom
      </a>
    </nav>
  );
}
