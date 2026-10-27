import { expect, test } from '@playwright/test';
import { createTeam, join, person, seriousViolations } from './helpers';

test('the last step makes finishing an event obvious, for everyone', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl, invite } = await createTeam(ada, 'Ada', 'Finish team');
  const grace = await person(browser);
  await join(grace, invite, 'Grace');

  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Planning Poker/ }).click();
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  await ada.waitForURL(/\/m\//);
  await grace.goto(ada.url());

  await ada.getByRole('button', { name: /^Next: Summary/ }).click();
  await expect(grace.getByText('will finish the event when the team is done')).toBeVisible();
  const callout = ada.getByRole('note');
  await expect(callout.getByText('Last step.')).toBeVisible();
  expect(await seriousViolations(ada), 'finish callout').toEqual([]);
  await callout.getByRole('button', { name: 'Finish event' }).click();

  await expect(grace.getByText('This event has finished.')).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(grace.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
  expect(await seriousViolations(grace), 'ended banner').toEqual([]);
});
