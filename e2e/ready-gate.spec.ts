import { INVEST, STARTER_DOR } from '@sprintwell/shared';
import { expect, test } from '@playwright/test';
import { createTeam, person, seriousViolations } from './helpers';

test('only Ready items enter the sprint, and the team can refine them during Sprint Planning', async ({ browser }) => {
  test.setTimeout(90_000);
  const ada = await person(browser);
  const { teamUrl } = await createTeam(ada, 'Ada', 'Ready team');

  await ada.goto(teamUrl);
  await ada.getByRole('button', { name: /^Sprint Planning/ }).click();
  await ada.getByRole('button', { name: 'Start', exact: true }).click();
  await ada.waitForURL(/\/m\//);
  await ada.getByRole('button', { name: /^Next: What/ }).click();

  // Write a rough backlog item from inside Sprint Planning.
  await ada.getByRole('button', { name: 'New item' }).click();
  const editor = ada.getByRole('dialog', { name: 'New user story' });
  await editor.getByLabel('Short name').fill('Book a telescope slot');
  await editor.getByRole('button', { name: 'Add story' }).click();
  await expect(editor).toBeHidden();

  await ada.getByRole('button', { name: 'Add Book a telescope slot to the sprint' }).click();
  const gate = ada.getByRole('dialog', { name: 'Not ready for the sprint yet' });
  await expect(gate.getByText(/Write it as a user story/)).toBeVisible();
  await expect(gate.getByText(/Definition of Ready not met/)).toBeVisible();
  expect(await seriousViolations(ada), 'gate dialog').toEqual([]);

  await gate.getByRole('button', { name: 'Fix this item' }).click();
  const fix = ada.getByRole('dialog', { name: 'Edit story' });
  await fix.getByRole('textbox', { name: 'As a', exact: true }).fill('astronomy student');
  await fix.getByRole('textbox', { name: 'I want', exact: true }).fill('to book a telescope slot');
  await fix.getByRole('textbox', { name: 'so that', exact: true }).fill('I can observe at night');
  await fix.getByLabel('New acceptance criterion').fill('Given a free slot, when I book it, then it is mine');
  await fix.getByRole('button', { name: 'Add', exact: true }).click();
  for (const i of INVEST) await fix.getByRole('checkbox', { name: new RegExp(`^${i.name}`) }).check();
  for (const text of STARTER_DOR) await fix.getByRole('checkbox', { name: text, exact: true }).check();
  await expect(fix.getByText('Ready for a sprint.')).toBeVisible();
  await fix.getByRole('button', { name: 'Save' }).click();
  await expect(fix).toBeHidden();

  await gate.getByRole('button', { name: /Ready now: add to Sprint 1/ }).click();
  await expect(ada.locator('#sb-h').locator('xpath=ancestor::section').getByText('Book a telescope slot')).toBeVisible();
});
