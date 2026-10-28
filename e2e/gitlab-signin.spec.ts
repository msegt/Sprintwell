import { expect, test } from '@playwright/test';
import { createTeam, mockToken, person, seriousViolations } from './helpers';

test('people verify their GitLab account with a token, and use a token to sign in on another device', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl } = await createTeam(ada, 'Ada', 'GitLab team');
  const gid = Math.floor(Math.random() * 1e9);
  const me = { id: gid, username: `c${gid}`, name: 'Ada Lovelace' };

  await ada.goto('/me');
  expect(await seriousViolations(ada), 'profile').toEqual([]);
  await ada.getByLabel('GitLab access token').fill(await mockToken({ user: me, scopes: ['read_user'] }));
  await ada.getByRole('button', { name: 'Verify with GitLab' }).click();
  await expect(ada.getByText(`Verified as @c${gid}. Sprintwell has deleted the token in GitLab.`)).toBeVisible();
  await expect(ada.getByText(`@c${gid}`, { exact: true })).toBeVisible();

  await ada.goto(`${teamUrl}/settings`);
  await expect(ada.getByText(`GitLab @c${gid}`)).toBeVisible();

  // Another device: a fresh token finds the same profile.
  const laptop = await person(browser);
  await laptop.goto('/');
  await laptop.getByText('Sign in with a GitLab access token').click();
  await laptop.getByLabel('GitLab access token').fill(await mockToken({ user: me, scopes: ['read_user'] }));
  await laptop.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(laptop.getByRole('heading', { name: 'Your teams' })).toBeVisible();
  await expect(laptop.getByRole('link', { name: /GitLab team/ })).toBeVisible();
});
