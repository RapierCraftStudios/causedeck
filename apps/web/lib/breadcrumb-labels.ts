// Route-supplied breadcrumb labels (#1132). The topbar breadcrumb (components/shell/breadcrumbs.tsx)
// sits above the route segments and only sees the path, so a route that knows a friendlier name for
// one of its segments (the matter layout: the matter's title for its id) publishes it here through
// `<BreadcrumbLabel>`. A segment without a label keeps its decoded path text. Pure: no React import;
// the breadcrumb reads it with `useSyncExternalStore`.

type Labels = ReadonlyMap<string, string>;

const EMPTY: Labels = new Map();
let labels: Labels = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Show `label` for the path segment `segment`. Returns a remover that forgets only this label. */
export function setBreadcrumbLabel(segment: string, label: string): () => void {
  const next = new Map(labels);
  next.set(segment, label);
  labels = next;
  emit();
  return () => {
    if (labels.get(segment) !== label) return;
    const rest = new Map(labels);
    rest.delete(segment);
    labels = rest.size === 0 ? EMPTY : rest;
    emit();
  };
}

export function subscribeBreadcrumbLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current labels; the same reference until a label changes. */
export function breadcrumbLabels(): Labels {
  return labels;
}

/** The server render has no labels: the segment text shows until the client registers them. */
export function serverBreadcrumbLabels(): Labels {
  return EMPTY;
}

/** Tests only: forget every label. */
export function resetBreadcrumbLabels(): void {
  labels = EMPTY;
  emit();
}
