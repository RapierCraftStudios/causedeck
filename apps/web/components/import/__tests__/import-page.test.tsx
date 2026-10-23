// @vitest-environment jsdom
// `/w/[slug]/import` (#552): not found for a non-member, permission-denied below `matter.write`,
// the stepper otherwise with the `bulk_import` channel state. The stepper is mocked: its rules are
// covered by file-rules.test.ts and the e2e spec.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs, fakeGetTranslations } from '../../../__tests__/helpers/intl.ts';
import { testWorkspaceContext } from '../../../__tests__/helpers/workspace.ts';
import type { Role, WorkspaceContext } from '../../../lib/workspace-context.ts';

const state = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  channels: [{ channel: 'bulk_import', enabled: true }] as { channel: string; enabled: boolean }[],
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
vi.mock('@causedeck/core/runtime', () => ({
  inWorkspace: (_scope: unknown, run: (tx: unknown) => unknown) => Promise.resolve(run({})),
}));
vi.mock('@causedeck/core/capture', () => ({
  CAPTURE_DISCLOSURE_VERSION: 'v-test',
  listChannels: () => Promise.resolve(state.channels),
}));
vi.mock('../bootstrap-import.tsx', () => ({
  BootstrapImport: (props: Record<string, unknown>) => {
    state.props = props;
    return <div data-stepper-stub="" />;
  },
}));

const { default: Page } = await import('../../../app/(app)/w/[slug]/import/page.tsx');

const open = async (role: Role) => {
  state.context = testWorkspaceContext('demo', role);
  const ui = await Page({ params: Promise.resolve({ slug: 'demo' }) });
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {ui}
    </NextIntlClientProvider>,
  );
};

describe('import page', () => {
  afterEach(() => {
    cleanup();
    state.props = null;
    state.channels = [{ channel: 'bulk_import', enabled: true }];
  });

  it('is not found for a non-member', async () => {
    state.context = null;
    await expect(Page({ params: Promise.resolve({ slug: 'demo' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it.each(['clerk', 'viewer'] as const)('denies a %s', async (role) => {
    await open(role);
    expect(screen.getByText(catalogs.en.bootstrapImport.denied)).toBeTruthy();
    expect(state.props).toBeNull();
  });

  it('gives an advocate the stepper and the means to turn the channel on (workspace.manage)', async () => {
    state.channels = [];
    await open('advocate');
    expect(state.props).toMatchObject({
      channelEnabled: false,
      canEnableChannel: true,
      disclosureVersion: 'v-test',
    });
  });
});
