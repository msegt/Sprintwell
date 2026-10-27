import { expect, test } from '@playwright/test';
import { createTeam, gitlabAs, person, seriousViolations } from './helpers';

test('people can verify themselves with GitLab and sign in with it on another device', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl } = await createTeam(ada, 'Ada', 'GitLab team');

  const gid = Math.floor(Math.random() * 1e9);
  await gitlabAs({ id: gid, username: `c${gid}`, name: 'Ada Lovelace' });
  await ada.goto('/me');
  expect(await seriousViolations(ada), 'profile').toEqual([]);
  await ada.getByRole('button', { name: 'Sign in with GitLab' }).click();
  await ada.waitForURL(/\/me$/);
  await expect(ada.getByText('Signed in with GitLab as')).toBeVisible();
  await expect(ada.getByText(`@c${gid}`, { exact: true })).toBeVisible();

  await ada.goto(`${teamUrl}/settings`);
  await expect(ada.getByText(`GitLab @c${gid}`)).toBeVisible();

  // Another device: no codes needed.
  const laptop = await person(browser);
  await laptop.goto('/');
  await laptop.getByRole('button', { name: 'Sign in with GitLab' }).first().click();
  await laptop.waitForURL((url) => url.pathname === '/');
  await expect(laptop.getByRole('heading', { name: 'Your teams' })).toBeVisible();
  await expect(laptop.getByRole('link', { name: /GitLab team/ })).toBeVisible();
});
