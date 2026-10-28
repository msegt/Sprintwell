import { expect, test } from '@playwright/test';
import { mockToken, person, seriousViolations } from './helpers';

test('a teacher creates class teams, students join with GitLab, and the teacher sees their activity', async ({ browser }) => {
  test.setTimeout(90_000);
  const teacher = await person(browser);
  // The teacher needs a profile first: create a personal team, then a class.
  await teacher.goto('/');
  await teacher.getByLabel('Your name').fill('Dr Teacher');
  await teacher.getByLabel('Team name').fill('Staff sandbox');
  await teacher.getByRole('button', { name: 'Create team' }).click();
  await teacher.waitForURL(/\/t\//);
  await teacher.goto('/');
  await teacher.getByRole('button', { name: 'Create a class' }).click();
  await teacher.getByLabel('Class name').fill('CMT651 2026/27');
  await teacher.getByRole('button', { name: 'Create class' }).click();
  await teacher.waitForURL(/\/c\/[a-z0-9]+$/);
  await teacher.getByRole('button', { name: 'Suggest four names' }).click();
  await teacher.getByRole('button', { name: 'Create teams' }).click();
  await expect(teacher.getByRole('heading', { name: 'Team 4' })).toBeVisible();
  expect(await seriousViolations(teacher), 'class page').toEqual([]);
  const invite = await teacher.locator('.class-team').filter({ hasText: 'Team 1' }).locator('.invite-link').innerText();

  const ada = await person(browser);
  const gid = Math.floor(Math.random() * 1e9);
  await ada.goto(invite);
  await expect(ada.getByText('asks everyone to')).toBeVisible();
  await ada.getByLabel('GitLab access token').fill(await mockToken({ user: { id: gid, username: `c${gid}`, name: 'Ada Lovelace' }, scopes: ['read_user'] }));
  await ada.getByRole('button', { name: 'Verify and continue' }).click();
  await ada.getByRole('button', { name: 'Join team' }).click();
  await ada.waitForURL(/\/t\/[a-z0-9]+$/);
  await ada.goto(`${ada.url()}/backlog`);
  await ada.getByRole('button', { name: 'New story' }).click();
  await ada.getByLabel('Short name').fill('Point the telescope');
  await ada.getByRole('button', { name: 'Add story' }).click();
  await expect(ada.getByRole('button', { name: 'Point the telescope', exact: true })).toBeVisible();

  await teacher.reload();
  await expect(teacher.locator('.class-team').filter({ hasText: 'Team 1' }).getByText(`@c${gid}`)).toBeVisible();
  await teacher.locator('.class-team').filter({ hasText: 'Team 1' }).getByRole('link', { name: 'Activity' }).click();
  await expect(teacher.getByText('You are viewing this team as teaching staff')).toBeVisible();
  await expect(teacher.locator('.activity-list').getByText('wrote “Point the telescope”')).toBeVisible();
  expect(await seriousViolations(teacher), 'activity page').toEqual([]);
});
