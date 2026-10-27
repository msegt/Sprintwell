import { expect, test } from '@playwright/test';
import { createTeam, person } from './helpers';

test('a dialog with unsaved changes asks before closing', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl } = await createTeam(ada, 'Ada', 'Guard team');
  await ada.goto(`${teamUrl}/backlog`);
  await ada.getByRole('button', { name: 'New story' }).click();
  const dialog = ada.getByRole('dialog', { name: 'New user story' });
  await expect(dialog).toBeVisible();

  // Nothing typed yet: clicking outside simply closes it.
  await ada.mouse.click(5, 5);
  await expect(dialog).toBeHidden();

  await ada.getByRole('button', { name: 'New story' }).click();
  await dialog.getByLabel('Short name').fill('Draft I must not lose');
  await ada.mouse.click(5, 5);
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByLabel('Short name')).toHaveValue('Draft I must not lose');

  await ada.keyboard.press('Escape');
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(dialog).toBeHidden();
});
