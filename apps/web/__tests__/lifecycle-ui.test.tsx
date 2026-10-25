// @vitest-environment jsdom
// Lifecycle UI (#305, #31 design spec): the export card polls every 3 s while an export builds and
// names the build step, offers Download and Copy SHA-256 when ready and Try again when it failed,
// and asks `Confirm it is you` when the server wants a fresh step-up, then retries. The deletion
// dialog enables Delete only after the export reminder, step-up and the exact workspace name. The
// cool-off banner names the date for every member and links owners to the cancel. Account deletion
// needs step-up and the typed email. Offline, the actions are disabled with `Needs a connection`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportJobView } from '../app/(app)/w/[slug]/settings/export/export-history.tsx';
import type { Result } from '../lib/safe-action.ts';

import { catalogs, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const { ExportCard, EXPORT_POLL_MS } =
  await import('../app/(app)/w/[slug]/settings/export/export-card.tsx');
const { DeleteWorkspace, CancelDeletion } =
  await import('../app/(app)/w/[slug]/settings/danger/delete-workspace-dialog.tsx');
const { CooloffBanner } = await import('../app/(app)/w/[slug]/settings/danger/cooloff-banner.tsx');
const { DeleteAccount } = await import('../app/(app)/account/danger/delete-account.tsx');

const lc = catalogs.en.lifecycle;
const WS = '00000000-0000-4000-8000-00000000a001';
const JOB = '00000000-0000-4000-8000-0000000e0001';
const NOW = Date.parse('2026-10-20T10:00:00Z');

const missing: string[] = [];
const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={catalogs[locale]}
      timeZone="Asia/Kolkata"
      onError={(error: IntlError) => {
        missing.push(error.message);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );

const ok = <T,>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true as const, data });
const stepUpRequired = (): Promise<Result<never>> =>
  Promise.resolve({
    ok: false,
    error: { code: 'FORBIDDEN', message: '', fieldErrors: { stepUp: ['required'] } },
  });

function job(overrides: Partial<ExportJobView> = {}): ExportJobView {
  return {
    id: JOB,
    status: 'running',
    progress: 10,
    phase: 'collecting',
    sizeBytes: null,
    sha256: null,
    createdAt: '2026-10-20T09:59:00.000Z',
    expiresAt: null,
    ...overrides,
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
  vi.useRealTimers();
  vi.clearAllMocks();
  expect(missing).toEqual([]);
});

function exportCard(props: Partial<Parameters<typeof ExportCard>[0]> = {}) {
  const requestExport = vi.fn(() => ok(job({ status: 'queued', progress: 0, phase: null })));
  const listExports = vi.fn(() => ok([job()]));
  const verifyCode = vi.fn(() => ok({ enabled: true as const }));
  withIntl(
    <ExportCard
      workspaceId={WS}
      initialJobs={[]}
      initialNow={NOW}
      twoFactorEnabled
      requestExport={requestExport}
      listExports={listExports}
      verifyCode={verifyCode}
      {...props}
    />,
  );
  return { requestExport, listExports, verifyCode };
}

describe('ExportCard', () => {
  it('starts empty with the helper text, Request export and No exports yet.', () => {
    exportCard();
    expect(screen.getByText(lc.export.helper)).toBeTruthy();
    expect(screen.getByText(lc.history.empty)).toBeTruthy();
    expect(screen.getByRole('button', { name: lc.export.action }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('polls every 3 s while building, names each step, and stops once ready', async () => {
    vi.useFakeTimers({ now: NOW });
    const states = [
      job({ phase: 'files', progress: 40 }),
      job({ phase: 'packaging', progress: 90 }),
      job({
        status: 'ready',
        progress: 100,
        phase: 'ready',
        sizeBytes: 3 * 1024 * 1024,
        sha256: 'ab'.repeat(32),
        expiresAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    const listExports = vi.fn(() => ok([states.shift() ?? job()]));
    exportCard({ initialJobs: [job()], listExports });
    expect(screen.getByText(lc.export.steps.collecting)).toBeTruthy();
    expect(screen.getByText(lc.export.leave)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: lc.export.progressLabel })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    });
    expect(screen.getByText(lc.export.steps.files)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    });
    expect(screen.getByText(lc.export.steps.packaging)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    });
    expect(screen.getByText(lc.export.readyTitle)).toBeTruthy();
    expect(screen.getByText(`causedeck-export-${JOB}.zip`)).toBeTruthy();
    expect(screen.getByText(/3\.0 MB · Expires in 24 hours/)).toBeTruthy();
    expect(screen.getByRole('button', { name: lc.export.download })).toBeTruthy();
    expect(screen.getByRole('button', { name: lc.export.copySha })).toBeTruthy();

    // Settled: no more polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS * 3);
    });
    expect(listExports).toHaveBeenCalledTimes(3);
  });

  it('downloads through a signed link from the download route', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { href: window.location.href, assign });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ url: `/api/exports/${JOB}/download?token=t` }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    exportCard({
      initialJobs: [
        job({
          status: 'ready',
          sizeBytes: 2048,
          sha256: 'cd'.repeat(32),
          expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: lc.export.download }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`/api/exports/${JOB}/download?token=t`);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/exports/${JOB}/download`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workspaceId: WS }) }),
    );
    vi.unstubAllGlobals();
  });

  it('treats a ready export past its expiry as expired', () => {
    exportCard({
      initialJobs: [job({ status: 'ready', expiresAt: new Date(NOW - 1000).toISOString() })],
    });
    expect(screen.queryByRole('button', { name: lc.export.download })).toBeNull();
    expect(screen.getByText(lc.history.status.expired)).toBeTruthy();
  });

  it('shows a failed export with Try again', async () => {
    const { requestExport } = exportCard({ initialJobs: [job({ status: 'failed' })] });
    const failed = document.querySelector('[data-slot="export-failed"]') as HTMLElement;
    expect(within(failed).getByText(lc.export.failed)).toBeTruthy();
    fireEvent.click(within(failed).getByRole('button', { name: lc.export.retry }));
    await waitFor(() => {
      expect(requestExport).toHaveBeenCalledWith({ workspaceId: WS });
    });
  });

  it('asks Confirm it is you on a stale step-up, then retries the request', async () => {
    const requestExport = vi
      .fn<() => Promise<Result<ExportJobView>>>()
      .mockImplementationOnce(stepUpRequired)
      .mockImplementation(() => ok(job({ status: 'queued', progress: 0, phase: null })));
    const { verifyCode } = exportCard({ requestExport });
    fireEvent.click(screen.getByRole('button', { name: lc.export.action }));
    expect(await screen.findByText(lc.stepUp.title)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(lc.stepUp.code), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: lc.stepUp.verify }));
    await waitFor(() => {
      expect(requestExport).toHaveBeenCalledTimes(2);
    });
    expect(verifyCode).toHaveBeenCalledWith({ code: '123456' });
    expect(await screen.findByText(lc.export.steps.queued)).toBeTruthy();
    expect(screen.queryByText(lc.stepUp.title)).toBeNull();
  });

  it('confirms with a passkey too', async () => {
    const passkey = vi.fn(() => Promise.resolve(true));
    const requestExport = vi
      .fn<() => Promise<Result<ExportJobView>>>()
      .mockImplementationOnce(stepUpRequired)
      .mockImplementation(() => ok(job({ status: 'queued', progress: 0, phase: null })));
    exportCard({ requestExport, passkey, twoFactorEnabled: false });
    fireEvent.click(screen.getByRole('button', { name: lc.export.action }));
    await screen.findByText(lc.stepUp.title);
    // Without two-factor there is no code option.
    expect(screen.queryByLabelText(lc.stepUp.code)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: lc.stepUp.passkey }));
    await waitFor(() => {
      expect(requestExport).toHaveBeenCalledTimes(2);
    });
    expect(passkey).toHaveBeenCalledTimes(1);
  });

  it('disables Request export offline with Needs a connection', () => {
    exportCard();
    setOnline(false);
    expect(screen.getByRole('button', { name: lc.export.action }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(lc.offline)).toBeTruthy();
  });
});

describe('DeleteWorkspace', () => {
  function open(props: Partial<Parameters<typeof DeleteWorkspace>[0]> = {}) {
    const requestDeletion = vi.fn(() =>
      ok({ jobId: JOB, status: 'pending_cooloff', cooloffUntil: '2026-11-03T10:00:00.000Z' }),
    );
    const verifyCode = vi.fn(() => ok({ enabled: true as const }));
    withIntl(
      <DeleteWorkspace
        workspaceId={WS}
        workspaceName="Demo Chambers"
        exportHref="/w/demo/settings/export"
        twoFactorEnabled
        requestDeletion={requestDeletion}
        verifyCode={verifyCode}
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: lc.danger.action }));
    return { requestDeletion, verifyCode, dialog: screen.getByRole('dialog') };
  }

  it('enables Delete only after the export reminder, step-up and the exact name', async () => {
    const { requestDeletion, dialog } = open();
    expect(within(dialog).getByText('Step 1 of 3')).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: lc.danger.dialog.exportLink }).getAttribute('href'),
    ).toBe('/w/demo/settings/export');
    const next = () => within(dialog).getByRole('button', { name: lc.danger.dialog.next });
    expect(next().hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(next());

    expect(within(dialog).getByText('Step 2 of 3')).toBeTruthy();
    expect(next().hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(lc.stepUp.code), {
      target: { value: '654321' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: lc.stepUp.verify }));
    await within(dialog).findByText(lc.stepUp.verified);
    fireEvent.click(next());

    expect(within(dialog).getByText('Step 3 of 3')).toBeTruthy();
    const remove = within(dialog).getByRole('button', { name: lc.danger.dialog.delete });
    expect(remove.hasAttribute('disabled')).toBe(true);
    const name = within(dialog).getByLabelText(lc.danger.dialog.nameLabel);
    fireEvent.change(name, { target: { value: 'demo chambers' } });
    expect(remove.hasAttribute('disabled')).toBe(true);
    fireEvent.change(name, { target: { value: 'Demo Chambers' } });
    expect(remove.hasAttribute('disabled')).toBe(false);
    fireEvent.click(remove);
    await waitFor(() => {
      expect(requestDeletion).toHaveBeenCalledWith({
        workspaceId: WS,
        confirmName: 'Demo Chambers',
      });
    });
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
    expect(toast).toHaveBeenCalledWith(lc.danger.requested);
  });

  it('goes back to step-up when the server finds it stale', async () => {
    const requestDeletion = vi.fn(stepUpRequired);
    const { dialog } = open({ requestDeletion });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: lc.danger.dialog.next }));
    fireEvent.change(within(dialog).getByLabelText(lc.stepUp.code), {
      target: { value: '654321' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: lc.stepUp.verify }));
    await within(dialog).findByText(lc.stepUp.verified);
    fireEvent.click(within(dialog).getByRole('button', { name: lc.danger.dialog.next }));
    fireEvent.change(within(dialog).getByLabelText(lc.danger.dialog.nameLabel), {
      target: { value: 'Demo Chambers' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: lc.danger.dialog.delete }));
    expect(await within(dialog).findByText(lc.stepUp.title)).toBeTruthy();
    expect(within(dialog).getByText('Step 2 of 3')).toBeTruthy();
  });

  it('is disabled offline', () => {
    withIntl(
      <DeleteWorkspace
        workspaceId={WS}
        workspaceName="Demo Chambers"
        exportHref="/w/demo/settings/export"
        twoFactorEnabled={false}
        requestDeletion={vi.fn()}
        verifyCode={vi.fn()}
      />,
    );
    setOnline(false);
    const button = screen.getByRole('button', { name: lc.danger.action });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBe(lc.offline);
  });
});

describe('CancelDeletion', () => {
  it('asks for step-up, then cancels', async () => {
    const cancelDeletion = vi
      .fn<() => Promise<Result<{ jobId: string; status: string; cooloffUntil: string | null }>>>()
      .mockImplementationOnce(stepUpRequired)
      .mockImplementation(() => ok({ jobId: JOB, status: 'cancelled', cooloffUntil: null }));
    withIntl(
      <CancelDeletion
        workspaceId={WS}
        jobId={JOB}
        twoFactorEnabled
        cancelDeletion={cancelDeletion}
        verifyCode={() => ok({ enabled: true as const })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: lc.danger.cancel }));
    await screen.findByText(lc.stepUp.title);
    fireEvent.change(screen.getByLabelText(lc.stepUp.code), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: lc.stepUp.verify }));
    await waitFor(() => {
      expect(cancelDeletion).toHaveBeenCalledTimes(2);
    });
    expect(cancelDeletion).toHaveBeenLastCalledWith({ workspaceId: WS, jobId: JOB });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(lc.danger.cancelled);
    });
  });
});

describe('CooloffBanner', () => {
  const deletion = { jobId: JOB, cooloffUntil: '2026-04-01T06:00:00.000Z' };

  it('names the date and links an owner to the cancel', () => {
    withIntl(<CooloffBanner deletion={deletion} slug="demo" owner />);
    const banner = document.querySelector('[data-slot="cooloff-banner"]') as HTMLElement;
    expect(banner.textContent).toContain(
      'Scheduled for deletion on Apr 1, 2026. Cancel any time before then.',
    );
    expect(within(banner).getByRole('link', { name: lc.danger.cancel }).getAttribute('href')).toBe(
      '/w/demo/settings/danger',
    );
  });

  it('shows members the date without the cancel link', () => {
    withIntl(<CooloffBanner deletion={deletion} slug="demo" owner={false} />);
    const banner = document.querySelector('[data-slot="cooloff-banner"]') as HTMLElement;
    expect(banner.textContent).toContain('Scheduled for deletion on');
    expect(within(banner).queryByRole('link')).toBeNull();
  });

  it('renders nothing without an active deletion', () => {
    withIntl(<CooloffBanner deletion={null} slug="demo" owner />);
    expect(document.querySelector('[data-slot="cooloff-banner"]')).toBeNull();
  });

  it.each(['ta', 'kn'] as const)('resolves every string in %s', (locale) => {
    withIntl(<CooloffBanner deletion={deletion} slug="demo" owner />, locale);
    expect(document.querySelector('[data-slot="cooloff-banner"]')?.textContent).not.toContain(
      'Scheduled',
    );
  });
});

describe('DeleteAccount', () => {
  it('needs step-up and the typed email, then requests deletion', async () => {
    const requestDeletion = vi.fn(() => ok({ jobId: JOB, status: 'scheduled' }));
    withIntl(
      <DeleteAccount
        email="asha@example.test"
        twoFactorEnabled
        requestDeletion={requestDeletion}
        verifyCode={() => ok({ enabled: true as const })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: lc.account.action }));
    const dialog = screen.getByRole('dialog');
    const remove = within(dialog).getByRole('button', { name: lc.account.delete });
    fireEvent.change(within(dialog).getByLabelText(lc.account.confirmLabel), {
      target: { value: 'asha@example.test' },
    });
    expect(remove.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(lc.stepUp.code), {
      target: { value: '222222' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: lc.stepUp.verify }));
    await within(dialog).findByText(lc.stepUp.verified);
    expect(remove.hasAttribute('disabled')).toBe(false);
    fireEvent.click(remove);
    await waitFor(() => {
      expect(requestDeletion).toHaveBeenCalledWith({});
    });
    expect(await screen.findByText(lc.account.requested)).toBeTruthy();
  });

  it('shows the sole-owner explanation from the server', async () => {
    const message = 'You are the only owner of a workspace: Demo Chambers';
    const requestDeletion = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'CONFLICT' as const, message } }),
    );
    withIntl(
      <DeleteAccount
        email="asha@example.test"
        twoFactorEnabled
        requestDeletion={requestDeletion}
        verifyCode={() => ok({ enabled: true as const })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: lc.account.action }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(lc.stepUp.code), {
      target: { value: '222222' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: lc.stepUp.verify }));
    await within(dialog).findByText(lc.stepUp.verified);
    fireEvent.change(within(dialog).getByLabelText(lc.account.confirmLabel), {
      target: { value: 'ASHA@example.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: lc.account.delete }));
    expect(await within(dialog).findByText(message)).toBeTruthy();
  });
});
