import { expect, test } from '@playwright/test';
import { MOCK_GITLAB, createTeam, mockToken, person, seriousViolations } from './helpers';

test('a team links its GitLab project, imports issues and sends estimates back', async ({ browser }) => {
  test.setTimeout(90_000);
  const gid = Math.floor(Math.random() * 1e9);
  const me = { id: gid, username: `c${gid}`, name: 'Ada Lovelace' };
  const projectId = 8800 + Math.floor(Math.random() * 1000);
  const path = `cmt651/observatory-${projectId}`;
  const now = new Date().toISOString();
  await fetch(`${MOCK_GITLAB}/__mock/project`, {
    method: 'POST',
    body: JSON.stringify({
      id: projectId,
      path_with_namespace: path,
      members: [me.id],
      issues: [
        {
          id: projectId * 10 + 1,
          iid: 1,
          title: 'Point the telescope',
          description: 'As an observer, I want to point the telescope at a target so that I can take images.\n\n## Acceptance criteria\n- [ ] Given a target, when I submit it, then the telescope moves',
          state: 'opened',
          labels: [],
          weight: null,
          milestone: null,
          web_url: `${MOCK_GITLAB}/${path}/-/issues/1`,
          updated_at: now,
        },
      ],
      events: [{ id: projectId * 10 + 2, action_name: 'approved', target_type: 'MergeRequest', target_iid: 3, target_title: 'Add pointing form', author_id: me.id, author: me, created_at: now }],
    }),
  });

  const ada = await person(browser);
  const { teamUrl } = await createTeam(ada, 'Ada', 'Observatory team');
  await ada.goto('/me');
  await ada.getByLabel('GitLab access token').fill(await mockToken({ user: me, scopes: ['read_user'] }));
  await ada.getByRole('button', { name: 'Verify with GitLab' }).click();
  await expect(ada.getByText(/Verified as/)).toBeVisible();

  await ada.goto(`${teamUrl}/settings`);
  await ada.getByLabel('Project address').fill(`${MOCK_GITLAB}/${path}`);
  await ada.getByLabel('Project access token').fill(await mockToken({ projectId, scopes: ['api'], expiresAt: '2027-06-30' }));
  await ada.getByRole('button', { name: 'Link project' }).click();
  await expect(ada.getByText('Linked to')).toBeVisible();
  await expect(ada.getByText(/expires on 30 Jun 2027/)).toBeVisible();
  await ada.getByText('Live updates with a webhook (optional)').click();
  await ada.getByRole('button', { name: 'Show webhook details' }).click();
  await expect(ada.getByRole('button', { name: 'Copy secret token' })).toBeVisible();
  expect(await seriousViolations(ada), 'team page with GitLab').toEqual([]);

  await ada.goto(`${teamUrl}/backlog`);
  await ada.getByRole('button', { name: 'Sync with GitLab' }).click();
  await expect(ada.getByText(/Synced with GitLab: 1 new item/)).toBeVisible();
  await ada.getByRole('button', { name: 'Point the telescope', exact: true }).click();
  const editor = ada.getByRole('dialog', { name: 'Edit story' });
  await expect(editor.getByRole('textbox', { name: 'As a', exact: true })).toHaveValue('observer');
  await editor.getByLabel('Estimate', { exact: true }).selectOption('5');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => ((await (await fetch(`${MOCK_GITLAB}/__mock/project/${projectId}`)).json()) as { issues: { weight: number | null }[] }).issues[0]!.weight).toBe(5);

  await ada.goto(`${teamUrl}/activity`);
  await expect(ada.locator('.activity-list').getByText(/approved merge request !3/)).toBeVisible();
});
