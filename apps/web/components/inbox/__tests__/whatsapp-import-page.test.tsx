// @vitest-environment jsdom
// `/w/[slug]/inbox/import/whatsapp` (#527): 404 while the flag is off, permission-denied below
// advocate, the flow for owners and advocates. The flow itself is mocked: it is covered by
// whatsapp-import-lib.test.ts and the e2e spec.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role, WorkspaceContext } from '../../../lib/workspace-context.ts';
import { catalogs, fakeGetTranslations } from '../../../__tests__/helpers/intl.ts';
import { testWorkspaceContext } from '../../../__tests__/helpers/workspace.ts';

const state = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  enabled: true,
  props: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../../../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('@causedeck/flags/server', () => ({ isEnabled: () => Promise.resolve(state.enabled) }));
vi.mock('../whatsapp-import/whatsapp-import-flow.tsx', () => ({
  WhatsAppImportFlow: (props: Record<string, unknown>) => {
    state.props = props;
    return <div data-flow-stub="" />;
  },
}));

const { default: Page } =
  await import('../../../app/(app)/w/[slug]/inbox/import/whatsapp/page.tsx');

const open = async (role: Role) => {
  state.context = testWorkspaceContext('demo', role);
  const ui = await Page({ params: Promise.resolve({ slug: 'demo' }) });
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {ui}
    </NextIntlClientProvider>,
  );
};

describe('WhatsApp import page', () => {
  beforeEach(() => {
    state.enabled = true;
    state.props = null;
  });
  afterEach(cleanup);

  it('is not found while the flag is off, and for a non-member', async () => {
    state.enabled = false;
    state.context = testWorkspaceContext('demo', 'owner');
    await expect(Page({ params: Promise.resolve({ slug: 'demo' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    state.enabled = true;
    state.context = null;
    await expect(Page({ params: Promise.resolve({ slug: 'demo' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it.each(['junior', 'clerk', 'viewer'] as const)('denies a %s', async (role) => {
    await open(role);
    expect(screen.getByText(catalogs.en.whatsappImport.states.denied)).toBeTruthy();
    expect(state.props).toBeNull();
  });

  it.each(['owner', 'advocate'] as const)('gives an %s the flow', async (role) => {
    await open(role);
    expect(state.props).toEqual({
      workspaceId: 'ws-1',
      slug: 'demo',
      memberName: 'Asha Rao',
    });
  });
});
