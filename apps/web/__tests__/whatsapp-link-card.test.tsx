// @vitest-environment jsdom
// The WhatsApp link card (#681): opt-in before a code is requested, verify, categories limited to
// the ones with an approved template, unlink, error states, and en/ta/kn copy.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WhatsAppLinkActions } from '../components/notifications/whatsapp-link-card.tsx';
import {
  WhatsAppLinkCard,
  WhatsAppLinkError,
} from '../components/notifications/whatsapp-link-card.tsx';

import { catalogs, type TestLocale } from './helpers/intl.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const LINK = {
  maskedNumber: '••••5678',
  verifiedAt: '2026-10-24T10:00:00.000Z',
  consentAt: '2026-10-24T09:59:00.000Z',
  categories: ['court.board'],
};

function fakeActions(): { [K in keyof WhatsAppLinkActions]: ReturnType<typeof vi.fn> } {
  return {
    requestOtp: vi.fn(() => Promise.resolve({ ok: true, data: { expiresAt: 'x' } })),
    verifyOtp: vi.fn(() => Promise.resolve({ ok: true, data: LINK })),
    setCategories: vi.fn(({ categories }: { categories: string[] }) =>
      Promise.resolve({ ok: true, data: { ...LINK, categories } }),
    ),
    unlink: vi.fn(() => Promise.resolve({ ok: true, data: { unlinked: true } })),
  };
}

function show(link: typeof LINK | null, actions = fakeActions(), locale: TestLocale = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      <WhatsAppLinkCard
        workspaceId={WS}
        link={link}
        actions={actions as unknown as WhatsAppLinkActions}
      />
    </NextIntlClientProvider>,
  );
  return actions;
}

const t = catalogs.en.whatsappLink;

afterEach(cleanup);

describe('unlinked', () => {
  it('needs the opt-in before a code is requested', async () => {
    const actions = show(null);
    fireEvent.change(screen.getByLabelText(t.numberLabel), { target: { value: '+919812345678' } });
    fireEvent.click(screen.getByRole('button', { name: t.sendCode }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.error.consent);
    expect(actions.requestOtp).not.toHaveBeenCalled();
  });

  it('requests a code with consent, then verifies it and shows the masked number', async () => {
    const actions = show(null);
    fireEvent.change(screen.getByLabelText(t.numberLabel), {
      target: { value: ' +919812345678 ' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: t.sendCode }));
    await waitFor(() => {
      expect(actions.requestOtp).toHaveBeenCalledWith({
        workspaceId: WS,
        e164: '+919812345678',
        consent: true,
      });
    });
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: t.verify }));
    await waitFor(() => {
      expect(actions.verifyOtp).toHaveBeenCalledWith({ workspaceId: WS, code: '123456' });
    });
    expect(await screen.findByText(t.linked.replace('{number}', '••••5678'))).toBeTruthy();
    expect(screen.queryByText(/9812345678/)).toBeNull();
  });

  it('shows a wrong code as an error and stays unlinked', async () => {
    const actions = fakeActions();
    actions.verifyOtp.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION', message: 'That code is not right' },
    });
    show(null, actions);
    fireEvent.change(screen.getByLabelText(t.numberLabel), { target: { value: '+919812345678' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: t.sendCode }));
    fireEvent.change(await screen.findByLabelText(t.codeLabel), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: t.verify }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.error.invalid);
    expect(screen.queryByRole('button', { name: t.unlink })).toBeNull();
  });
});

describe('linked', () => {
  it('offers only the categories with an approved template and saves a change', async () => {
    const actions = show(LINK);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(screen.getByLabelText(t.categories.statusOrder));
    await waitFor(() => {
      expect(actions.setCategories).toHaveBeenCalledWith({
        workspaceId: WS,
        categories: ['court.board', 'status.order'],
      });
    });
    expect(await screen.findByText(t.saved)).toBeTruthy();
  });

  it('unlinks and returns to the number form', async () => {
    const actions = show(LINK);
    fireEvent.click(screen.getByRole('button', { name: t.unlink }));
    expect(actions.unlink).toHaveBeenCalledWith({ workspaceId: WS });
    expect(await screen.findByText(t.unlinked)).toBeTruthy();
    expect(screen.getByLabelText(t.numberLabel)).toBeTruthy();
  });

  it('reports a thrown action as a generic error', async () => {
    const actions = fakeActions();
    actions.unlink.mockRejectedValue(new Error('offline'));
    show(LINK, actions);
    fireEvent.click(screen.getByRole('button', { name: t.unlink }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.error.generic);
  });
});

describe('copy', () => {
  it.each(['ta', 'kn'] as const)('renders in %s', (locale) => {
    show(LINK, fakeActions(), locale);
    expect(screen.getByRole('button', { name: catalogs[locale].whatsappLink.unlink })).toBeTruthy();
  });

  it('has a load error message', () => {
    render(
      <NextIntlClientProvider locale="en" messages={catalogs.en}>
        <WhatsAppLinkError />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('alert').textContent).toBe(t.loadError);
  });
});
