import { expect, test } from '@playwright/test';
import { createTeam, join, person, seriousViolations } from './helpers';

test('a team estimates a story with Planning Poker, with votes hidden until reveal', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl, invite } = await createTeam(ada, 'Ada', 'Poker team');
  const grace = await person(browser);
  await join(grace, invite, 'Grace');
  const linus = await person(browser, true);
  await join(linus, invite, 'Linus');

  await ada.goto(`${teamUrl}/backlog`);
  await ada.getByRole('button', { name: 'New story' }).click();
  await ada.getByLabel('Short name').fill('Book a telescope slot');
  await ada.getByRole('button', { name: 'Add story' }).click();
  await expect(ada.getByRole('button', { name: 'Book a telescope slot', exact: true })).toBeVisible();

  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Planning Poker/ }).click();
  await ada.getByLabel('Book a telescope slot').check();
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  await ada.waitForURL(/\/m\//);
  const url = ada.url();
  await grace.goto(url);
  await linus.goto(url);

  await ada.getByRole('button', { name: 'Estimate 3' }).click();
  await grace.getByRole('button', { name: 'Estimate 13' }).click();
  await expect(linus.getByText('has voted', { exact: true })).toHaveCount(2);
  // Linus cannot see the values yet.
  await expect(linus.locator('.seat-card.revealed')).toHaveCount(0);
  await linus.getByRole('button', { name: 'Estimate 5' }).click();
  await expect(grace.getByRole('button', { name: /Reveal/ })).toHaveCount(0);

  await ada.getByRole('button', { name: /Reveal \(3\/3\)/ }).click();
  await expect(linus.getByText('Discuss first:')).toBeVisible();
  await expect(linus.locator('.seat-card.revealed')).toHaveText(['3', '13', '5']);
  await ada.getByLabel('Final estimate').selectOption('5');
  await ada.getByRole('button', { name: 'Save estimate' }).click();

  await grace.goto(`${teamUrl}/backlog`);
  await expect(grace.locator('.story-row').filter({ hasText: 'Book a telescope slot' }).getByText('5 pts')).toBeVisible();
});

test('a retrospective keeps cards anonymous and hidden while writing', async ({ browser }) => {
  const ada = await person(browser);
  const { teamUrl, invite } = await createTeam(ada, 'Ada', 'Retro team');
  const grace = await person(browser);
  await join(grace, invite, 'Grace');

  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Sprint Retrospective/ }).click();
  await ada.getByLabel(/Mad, Sad, Glad/).check({ force: true });
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  await ada.waitForURL(/\/m\//);
  await grace.goto(ada.url());

  await ada.getByRole('button', { name: /Reflect/ }).click();
  await grace.getByLabel('Add a card to Mad').fill('Flaky CI pipeline');
  await grace.keyboard.press('Enter');
  await expect(ada.getByText('+ 1 card from others (hidden)')).toBeVisible();
  await expect(ada.getByText('Flaky CI pipeline')).toHaveCount(0);

  await ada.getByRole('button', { name: /Next: Group/ }).click();
  await expect(ada.getByText('Flaky CI pipeline')).toBeVisible();
  await expect(ada.locator('.retro-card')).not.toContainText('Grace');
  await ada.getByRole('button', { name: /Next: Vote/ }).click();
  await grace.getByRole('button', { name: 'Add a vote' }).click();
  await expect(grace.getByText('2 of 3 votes left')).toBeVisible();
  await ada.getByRole('button', { name: /Next: Discuss/ }).click();
  await ada.locator('.topic-list button').first().click();
  await ada.getByLabel('Agree an action').fill('Quarantine flaky tests');
  await ada.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(grace.getByText('Quarantine flaky tests')).toBeVisible();
});

test('key pages have no serious accessibility violations', async ({ browser }) => {
  test.setTimeout(120_000);
  const ada = await person(browser);
  await ada.goto('/');
  expect(await seriousViolations(ada)).toEqual([]);
  const { teamUrl } = await createTeam(ada, 'Ada', 'A11y team');
  for (const path of ['', '/backlog', '/sprint', '/events', '/charter', '/actions', '/risks', '/settings']) {
    await ada.goto(teamUrl + path);
    await ada.waitForLoadState('networkidle');
    expect(await seriousViolations(ada), `page ${path || '/'}`).toEqual([]);
  }
  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Sprint Retrospective/ }).click();
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  await ada.waitForURL(/\/m\//);
  await ada.getByText('Check-in').first().waitFor();
  expect(await seriousViolations(ada), 'retro').toEqual([]);
  for (const kind of ['Planning Poker', 'Daily Scrum', 'Pairing timer', 'Sprint Planning']) {
    await ada.goto(teamUrl);
    await ada.getByRole('button', { name: new RegExp(`^${kind}`) }).click();
    await ada.getByRole('button', { name: 'Start', exact: true }).click();
    await ada.waitForURL(/\/m\//);
    await ada.locator('.meeting-head').waitFor();
    await ada.waitForTimeout(300);
    expect(await seriousViolations(ada), kind).toEqual([]);
  }
});

test('dark mode and guides have no serious accessibility violations', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 860 } });
  const ada = await ctx.newPage();
  await ada.goto('/');
  expect(await seriousViolations(ada), 'home (dark)').toEqual([]);
  const { teamUrl } = await createTeam(ada, 'Ada', 'Dark team');
  await ada.goto(teamUrl);
  await ada.getByText('Getting started').waitFor();
  expect(await seriousViolations(ada), 'overview (dark)').toEqual([]);
  await ada.goto('/guide');
  await ada.getByRole('heading', { name: 'Sprintwell guide' }).waitFor();
  expect(await seriousViolations(ada), 'guide (dark)').toEqual([]);
  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Planning Poker/ }).click();
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  await ada.waitForURL(/\/m\//);
  await ada.getByLabel('Story to estimate').fill('Dark story');
  await ada.getByRole('button', { name: 'Add', exact: true }).click();
  await ada.getByRole('button', { name: 'Estimate 5' }).click();
  await expect(ada.getByText('You are facilitating:')).toBeVisible();
  expect(await seriousViolations(ada), 'poker (dark)').toEqual([]);
});
