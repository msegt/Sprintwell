import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

/** Opens a fresh browser context, i.e. a separate person. */
export async function person(browser: Browser, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
  return ctx.newPage();
}

export async function createTeam(page: Page, name: string, team: string): Promise<{ teamUrl: string; invite: string }> {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Team name').fill(team);
  await page.getByRole('button', { name: 'Create team' }).click();
  await page.waitForURL(/\/t\/[a-z0-9]+$/);
  const teamUrl = page.url();
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  const invite = await page.locator('.invite-link').innerText();
  return { teamUrl, invite };
}

export async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(invite);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join team' }).click();
  await page.waitForURL(/\/t\//);
}

export async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

