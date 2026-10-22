// Next 16.4 compatibility for @storybook/nextjs-vite 9.1 (main.ts aliases the framework's
// `next/dist/client/components/redirect-boundary` import here). Next 16.4's `useRouter()` reads
// `LayoutRouterContext.parentRenderTree.data.bfcacheId`; the framework's App Router mock provides
// the older context shape without `parentRenderTree`, so its RedirectBoundary and every component
// that calls `useRouter()` threw "Cannot read properties of undefined (reading 'data')". This keeps
// Next's own boundary and adds the missing render tree (bfcache id 0) for everything below it.
import { RedirectBoundary as NextRedirectBoundary } from 'next/dist/client/components/redirect-boundary.js';
import { LayoutRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement, useContext, useMemo, type ContextType, type ReactNode } from 'react';

type LayoutRouter = NonNullable<ContextType<typeof LayoutRouterContext>>;

export function RedirectBoundary({ children }: { children: ReactNode }) {
  const layout = useContext(LayoutRouterContext);
  const value = useMemo(() => {
    if (layout === null) return null;
    const partial = layout as Partial<LayoutRouter>;
    if (partial.parentRenderTree !== undefined) return layout;
    return {
      ...layout,
      parentRenderTree: { data: { bfcacheId: 0 } } as unknown as LayoutRouter['parentRenderTree'],
    };
  }, [layout]);
  // createElement, not JSX: Vite may pre-bundle this with the framework, outside the JSX transform.
  return createElement(
    LayoutRouterContext.Provider,
    { value },
    createElement(NextRedirectBoundary, null, children),
  );
}
