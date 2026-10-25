// @vitest-environment jsdom
// The Storybook RedirectBoundary shim (apps/web/.storybook/redirect-boundary.ts): under the App
// Router context shape that @storybook/nextjs-vite 9.1 provides (no `parentRenderTree`), Next 16.4's
// `useRouter()` threw "Cannot read properties of undefined (reading 'data')" and every web story
// failed. Below the shim, `useRouter()` works and returns the mocked router's methods.
import { cleanup, render, screen } from '@testing-library/react';
import {
  AppRouterContext,
  LayoutRouterContext,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useRouter } from 'next/navigation';
import { Component, createElement, type ContextType, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedirectBoundary } from '../.storybook/redirect-boundary.ts';

type Router = NonNullable<ContextType<typeof AppRouterContext>>;
type Layout = NonNullable<ContextType<typeof LayoutRouterContext>>;

const router = {
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  hmrRefresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
} as unknown as Router;

// What the framework's AppRouterProvider puts in LayoutRouterContext (pre-16.4 shape).
const storybookLayout = {
  childNodes: new Map(),
  tree: ['/', {}],
  parentTree: ['/', {}],
  parentCacheNode: { parallelRoutes: new Map() },
  url: '/',
  loading: null,
} as unknown as Layout;

function UsesRouter() {
  const r = useRouter();
  return createElement('output', null, `${r.bfcacheId} ${String(r.push === router.push)}`);
}

class Catch extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    return this.state.message === null
      ? this.props.children
      : createElement('p', null, this.state.message);
  }
}

const mount = (child: ReturnType<typeof createElement>) =>
  render(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(
        LayoutRouterContext.Provider,
        { value: storybookLayout },
        createElement(Catch, null, child),
      ),
    ),
  );

afterEach(cleanup);

describe('Storybook RedirectBoundary shim (Next 16.4)', () => {
  it('reproduces the crash without the shim', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(createElement(UsesRouter));
    expect(screen.getByText(/reading 'data'/)).toBeTruthy();
    consoleError.mockRestore();
  });

  it('lets useRouter() run below it with the mocked router', () => {
    mount(createElement(RedirectBoundary, null, createElement(UsesRouter)));
    expect(screen.getByRole('status').textContent).toBe('_b_0_ true');
  });
});
