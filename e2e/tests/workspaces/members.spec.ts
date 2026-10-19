// Members settings page (#181): `/w/<slug>/settings/members` lists members (cards on phones, a
// table from 768, plus the Roles panel from 1280) with role-gated actions: owners invite, change
// roles, transfer ownership and remove; advocates invite; everyone else reads. Invitations use the
// dev mailer, so the toast offers `Copy link`. States: loading, error, empty, offline. `@a11y`
// tests also run axe (zero serious or critical violations) on the page they end on. Every test
// starts from the reset e2e seed, so mutations never leak between tests.
import type { Locator, Page } from '@playwright/test';

import { E2E_WORKSPACES, e2eUser, expect, test, type E2eRole } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';
import { layoutOf, SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const PATH = 'settings/members';
const WORKSPACE = E2E_WORKSPACES[SHELL_WORKSPACE];

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Members' });

/** Sign in as `role` of `chennai-solo` and open its members page, hydrated. */
async function openMembers(page: Page, asUser: AsUser, role: E2eRole = 'owner', query = '') {
  await asUser(role, { path: `${PATH}${query}` });
  await expect(heading(page)).toBeVisible();
  // Viewers have no Settings nav item, so there is no active indicator to wait on.
  if (role !== 'viewer') await shellReady(page);
}

/** The list for this viewport: cards on phones, the table from 768 px. */
function list(page: Page): Locator {
  return layoutOf(page) === 'phone'
    ? page.locator('[data-slot="members"] ul').first()
    : page.getByRole('table');
}

function row(page: Page, text: string): Locator {
  const selector = layoutOf(page) === 'phone' ? 'li' : 'tr';
  return list(page).locator(selector).filter({ hasText: text });
}

function inviteButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Invite member' }).locator('visible=true');
}

async function openRowMenu(page: Page, name: string) {
  await row(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
}

test.describe('members page', () => {
  test(
    'the owner sees every member with role, status and the Roles panel',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openMembers(page, asUser);
      await expect(
        page.getByText(`People in ${WORKSPACE.name} and what they can do.`),
      ).toBeVisible();
      for (const role of ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const) {
        await expect(row(page, e2eUser(role).name)).toBeVisible();
      }
      await expect(row(page, e2eUser('owner').name)).toContainText('(You)');
      const panel = page.getByRole('complementary', { name: 'Roles' });
      if (layoutOf(page) === 'desktop') {
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Clerks never see strategy notes or matter memory');
      } else {
        await expect(panel).toBeHidden();
      }
      if (layoutOf(page) === 'phone') {
        await expect(page.getByRole('table')).toBeHidden();
      } else {
        const headers = page.getByRole('table').getByRole('columnheader');
        await expect(headers).toHaveText(['Member', 'Role', 'Status', 'Last active', 'Actions']);
        await expect(row(page, e2eUser('clerk').name).locator('[data-status]')).toHaveText(
          'Active',
        );
      }
      await expect(inviteButton(page)).toBeVisible();
    },
  );

  test(
    'invites pasted addresses as chips; the toast offers Copy link; the row shows Invited',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openMembers(page, asUser);
      await inviteButton(page).click();
      const dialog = page.getByRole('dialog', { name: 'Invite members' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radio')).toHaveCount(4);
      await dialog.getByRole('radio', { name: /Clerk/ }).click();

      const emails = dialog.getByRole('textbox', { name: /Email addresses/ });
      await emails.focus();
      await page.evaluate(() => {
        const input = document.activeElement as HTMLInputElement;
        const data = new DataTransfer();
        data.setData('text/plain', 'new.clerk@e2e.test, second.clerk@e2e.test');
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      });
      await expect(dialog.locator('[data-chip]')).toHaveCount(2);
      await dialog.getByRole('button', { name: 'Send invitation' }).click();

      await expect(dialog).toBeHidden();
      const toast = page.getByText('Invitation sent to new.clerk@e2e.test');
      await expect(toast).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy link' }).first()).toBeVisible();
      const invited = row(page, 'new.clerk@e2e.test');
      await expect(invited).toBeVisible();
      await expect(invited.locator('[data-status="invited"]')).toHaveText('Invited');
      await expect(invited.locator('[data-role="clerk"]')).toHaveText('Clerk');
    },
  );

  test('resends and revokes a pending invitation', async ({ page, asUser }) => {
    await openMembers(page, asUser);
    await inviteButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Invite members' });
    await dialog.getByRole('textbox', { name: /Email addresses/ }).fill('pending@e2e.test');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(row(page, 'pending@e2e.test')).toBeVisible();

    await openRowMenu(page, 'pending@e2e.test');
    await page.getByRole('menuitem', { name: 'Resend invitation' }).click();
    await expect(page.getByText('Invitation sent again to pending@e2e.test')).toBeVisible();

    await openRowMenu(page, 'pending@e2e.test');
    await page.getByRole('menuitem', { name: 'Revoke' }).click();
    await expect(page.getByText('Invitation to pending@e2e.test revoked')).toBeVisible();
    await expect(row(page, 'pending@e2e.test')).toHaveCount(0);
  });

  test('changes a role', async ({ page, asUser }) => {
    await openMembers(page, asUser);
    const junior = e2eUser('junior').name;
    await openRowMenu(page, junior);
    await page.getByRole('menuitem', { name: 'Change role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change role' });
    await dialog.getByRole('combobox', { name: `Role for ${junior}` }).click();
    await page.getByRole('option', { name: 'Advocate' }).click();
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${junior} is now Advocate.`)).toBeVisible();
    await expect(row(page, junior).locator('[data-role="advocate"]')).toHaveText('Advocate');
  });

  test('the last owner cannot demote themselves', async ({ page, asUser }) => {
    await openMembers(page, asUser);
    const owner = e2eUser('owner').name;
    await openRowMenu(page, owner);
    await page.getByRole('menuitem', { name: 'Change role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change role' });
    await dialog.getByRole('combobox', { name: `Role for ${owner}` }).click();
    await page.getByRole('option', { name: 'Advocate' }).click();
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'A workspace always needs an owner. Transfer ownership first.',
    );
  });

  test('transfers ownership in two steps', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openMembers(page, asUser);
    const advocate = e2eUser('advocate').name;
    await openRowMenu(page, advocate);
    await page.getByRole('menuitem', { name: 'Transfer ownership' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();

    const confirm = page.getByRole('dialog', { name: `Transfer ownership to ${advocate}?` });
    await expect(confirm).toContainText('You become an advocate');
    const submit = confirm.getByRole('button', { name: 'Transfer ownership' });
    await expect(submit).toBeDisabled();
    await confirm
      .getByRole('textbox', { name: `Type ${SHELL_WORKSPACE} to confirm` })
      .fill(SHELL_WORKSPACE);
    await submit.click();
    await expect(page.getByText(`${advocate} now owns ${WORKSPACE.name}.`)).toBeVisible();
    await expect(row(page, advocate).locator('[data-role="owner"]')).toHaveText('Owner');
  });

  test(
    'removes a member after confirming the consequences',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openMembers(page, asUser);
      const clerk = e2eUser('clerk').name;
      await openRowMenu(page, clerk);
      await page.getByRole('menuitem', { name: 'Remove from workspace' }).click();
      const dialog = page.getByRole('alertdialog', {
        name: `Remove ${clerk} from ${WORKSPACE.name}?`,
      });
      await expect(dialog).toContainText('Their sessions in this workspace end.');
      await dialog.getByRole('button', { name: 'Remove from workspace' }).click();
      await expect(page.getByText(`${clerk} was removed from ${WORKSPACE.name}.`)).toBeVisible();
      await expect(row(page, clerk)).toHaveCount(0);
    },
  );

  test('an advocate can invite but not manage members', async ({ page, asUser }) => {
    await openMembers(page, asUser, 'advocate');
    await expect(page.getByText('Only owners can change roles or remove members.')).toBeVisible();
    await expect(
      row(page, e2eUser('junior').name).getByRole('button', { name: /Actions for/ }),
    ).toHaveCount(0);
    await inviteButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Invite members' });
    // Advocates invite below themselves: junior, clerk, viewer.
    await expect(dialog.getByRole('radio')).toHaveCount(3);
    await expect(dialog.getByRole('radio', { name: /Advocate/ })).toHaveCount(0);
  });

  for (const role of ['junior', 'clerk'] as const) {
    test(`a ${role} sees the list read-only`, { tag: '@a11y' }, async ({ page, asUser }) => {
      await openMembers(page, asUser, role);
      await expect(page.getByText('Only owners can change roles or remove members.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
      await expect(list(page).getByRole('button', { name: /Actions for/ })).toHaveCount(0);
    });
  }

  test(
    'a viewer can view members but not change them',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openMembers(page, asUser, 'viewer');
      await expect(page.getByText('You can view members but not change them.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
      await expect(row(page, e2eUser('owner').name)).toBeVisible();
    },
  );

  test('a non-member gets not found', async ({ page, asUser }) => {
    // The chennai-solo junior has no membership in bengaluru-chamber.
    await asUser('junior');
    await page.goto(`/w/bengaluru-chamber/${PATH}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('loading state: six skeleton rows', { tag: '@a11y' }, async ({ page, asUser }) => {
    await asUser('owner', { path: `${PATH}?__state=loading` });
    await expect(page.locator('[data-slot="members-skeleton"] > div')).toHaveCount(6);
  });

  test(
    'error state: Could not load members, with Try again',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await asUser('owner', { path: `${PATH}?__state=error` });
      // Next.js's route announcer is also role=alert; target the error state itself.
      await expect(page.locator('[data-pattern-state="error"]')).toContainText(
        'Could not load members.',
      );
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  );

  test(
    'offline: read-only, invite needs a connection',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openMembers(page, asUser);
      await page.context().setOffline(true);
      await expect(page.getByText(/You are offline/).first()).toBeVisible();
      await expect(inviteButton(page)).toBeDisabled();
      await expect(page.getByText('Needs a connection').locator('visible=true')).toBeVisible();
      await page.context().setOffline(false);
    },
  );

  test('empty state for a new workspace', { tag: '@a11y' }, async ({ page, asUser }) => {
    await asUser('viewer');
    await page.goto('/onboarding');
    await page.getByRole('textbox', { name: /Workspace name/ }).fill('Solo Members Check');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/w\/solo-members-check\/today$/);
    await page.goto(`/w/solo-members-check/${PATH}`);
    await expect(
      page.getByText(
        'It is just you for now. Invite juniors, clerks or co-counsel when you are ready.',
      ),
    ).toBeVisible();
  });

  test('keyboard: arrow keys move between rows, Enter opens the menu, Esc closes it', async ({
    page,
    asUser,
  }) => {
    test.skip(layoutOf(page) === 'phone', 'the table (and its keyboard model) starts at 768 px');
    await openMembers(page, asUser);
    const rows = page.getByRole('table').locator('tbody tr');
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Change role' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
  });
});
