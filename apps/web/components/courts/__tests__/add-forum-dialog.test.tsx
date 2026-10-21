// @vitest-environment jsdom
// Add-forum dialog (#402): the suggested code and the website's hostname, the client-side block on a
// code already in the index, the mapped action input with a refresh after success, the server's
// CONFLICT on the code field, and `Esc` closing the dialog with focus back on `Add forum`.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Result } from '../../../lib/safe-action.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const { catalogs } = await import('../../../__tests__/helpers/intl.ts');
const { renderWithIntl, stubResizeObserver } = await import('../../shell/__tests__/helpers.tsx');
const { suggestForumCode, websiteHost } = await import('../../../lib/forum-input.ts');
const { AddForumDialog } = await import('../add-forum-dialog.tsx');

const en = catalogs.en.courts.addForum;
const WS = '00000000-0000-4000-8000-000000000001';
const TAKEN = ['in.ka.bengaluru.city-civil', 'ws.chennai.my-forum'];

type ActionResult = Result<{ code: string; court: string }>;
const action = vi.fn<(input: unknown) => Promise<ActionResult>>();

beforeEach(() => {
  stubResizeObserver();
  action.mockReset();
  router.refresh.mockReset();
  toast.mockReset();
});

afterEach(cleanup);

function open() {
  const trigger = screen.getByRole('button', { name: en.trigger });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const field = (label: string) => screen.getByLabelText(new RegExp(`^${escape(label)}`));
const type = (label: string, value: string) => {
  fireEvent.change(field(label), { target: { value } });
};
const submit = () => {
  fireEvent.click(
    screen
      .getAllByRole('button', { name: en.submit })
      .find((button) => button.getAttribute('type') === 'submit') as HTMLElement,
  );
};

describe('forum input helpers (#402)', () => {
  it('suggests a ws. code from city and name, or nothing without Latin letters', () => {
    expect(suggestForumCode('Chennai', 'City Civil Court')).toBe('ws.chennai.city-civil-court');
    expect(suggestForumCode('', 'Family Court')).toBe('ws.family-court');
    expect(suggestForumCode('Bengaluru', '  Café   Tribunal! ')).toBe('ws.bengaluru.cafe-tribunal');
    expect(suggestForumCode('சென்னை', 'குடும்ப நீதிமன்றம்')).toBe('');
  });

  it('takes an https URL or a bare host, and refuses anything else', () => {
    expect(websiteHost('https://Districts.ECourts.gov.in/chennai')).toBe(
      'districts.ecourts.gov.in',
    );
    expect(websiteHost('hcmadras.tn.gov.in')).toBe('hcmadras.tn.gov.in');
    expect(websiteHost('http://hcmadras.tn.gov.in')).toBeNull();
    expect(websiteHost('javascript:alert(1)')).toBeNull();
    expect(websiteHost('https://court.example.in:8443/')).toBeNull();
    expect(websiteHost('https://user:pw@court.example.in/')).toBeNull();
    expect(websiteHost('localhost')).toBeNull();
    expect(websiteHost('   ')).toBeNull();
  });
});

describe('AddForumDialog (#402)', () => {
  it('blocks a code already in the index without calling the server', () => {
    renderWithIntl(<AddForumDialog workspaceId={WS} takenCodes={TAKEN} action={action} />);
    open();
    type(en.name.label, 'My Forum');
    type(en.city.label, 'Chennai');
    expect((field(en.code.label) as HTMLInputElement).value).toBe('ws.chennai.my-forum');
    submit();
    expect(screen.getByText(en.errors.codeTaken)).toBeTruthy();
    type(en.code.label, 'in.ka.bengaluru.city-civil');
    submit();
    expect(screen.getByText(en.errors.codeTaken)).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it('requires name and city and an https website', () => {
    renderWithIntl(<AddForumDialog workspaceId={WS} takenCodes={TAKEN} action={action} />);
    open();
    type(en.website.label, 'http://court.example.in');
    submit();
    expect(screen.getAllByText(en.errors.required).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(en.errors.websiteInvalid)).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it('sends the mapped input, then closes, confirms and refreshes the page', async () => {
    action.mockResolvedValue({
      ok: true,
      data: { code: 'ws.coimbatore.district-court', court: 'District Court' },
    });
    renderWithIntl(<AddForumDialog workspaceId={WS} takenCodes={TAKEN} action={action} />);
    open();
    type(en.name.label, 'District Court');
    type(en.city.label, 'Coimbatore');
    fireEvent.change(field(en.courtType.label), { target: { value: 'district' } });
    fireEvent.change(field(en.primaryLanguage), { target: { value: 'ta' } });
    fireEvent.click(screen.getByRole('checkbox', { name: en.languages.en }));
    type(en.website.label, 'https://districts.ecourts.gov.in/coimbatore');
    submit();
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
    expect(action).toHaveBeenCalledWith({
      workspaceId: WS,
      code: 'ws.coimbatore.district-court',
      name: 'District Court',
      jurisdictionKind: 'district',
      city: 'Coimbatore',
      primaryLanguage: 'ta',
      secondaryLanguages: ['en'],
      website: 'https://districts.ecourts.gov.in/coimbatore',
    });
    expect(toast).toHaveBeenCalledWith('District Court added to your courts.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the server’s CONFLICT on the code field and stays open', async () => {
    action.mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT', message: 'This code belongs to a catalogue forum' },
    });
    renderWithIntl(<AddForumDialog workspaceId={WS} takenCodes={[]} action={action} />);
    open();
    type(en.name.label, 'Madras High Court');
    type(en.city.label, 'Chennai');
    type(en.code.label, 'in.tn.madras-hc.principal.original');
    submit();
    expect(await screen.findByText(en.errors.codeTaken)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to Add forum', async () => {
    renderWithIntl(<AddForumDialog workspaceId={WS} takenCodes={TAKEN} action={action} />);
    const trigger = open();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});
