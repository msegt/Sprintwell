import { expect, test } from '@playwright/test';
import { createTeam, person, seriousViolations } from './helpers';

test('guides include preparation, pitfalls and further reading', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl } = await createTeam(ada, 'Ada', 'Guide team');

  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Sprint Retrospective/ }).click();
  const dialog = ada.getByRole('dialog');
  await dialog.getByText('Before you start: a quick checklist').click();
  await expect(dialog.getByText(/Start, Stop, Continue is a good first one/)).toBeVisible();
  await ada.keyboard.press('Escape');

  await ada.goto('/guide');
  await expect(ada.getByRole('heading', { name: 'Where to read more' })).toBeVisible();
  const retro = ada.locator('#event-retro');
  await expect(retro.getByText('Watch out for')).toBeVisible();
  const link = retro.getByRole('link', { name: /Retromat/ });
  await expect(link).toHaveAttribute('href', 'https://retromat.org/en/');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await seriousViolations(ada), 'guide page').toEqual([]);
});
