import type { TeamGitlabDTO } from '@sprintwell/shared';
import type { Selectable } from 'kysely';
import type { TeamGitlabTable } from '../db/schema';

export type Link = Selectable<TeamGitlabTable>;

/** Whether the team's access lets Sprintwell write to GitLab (unknown scopes are tried). */
export function canWrite(link: Link): boolean {
  if (!link.token) return true;
  return !link.token_scopes || link.token_scopes.split(/\s+/).includes('api');
}

export function toStatus(row: Link): TeamGitlabDTO {
  return {
    path: row.path,
    webUrl: row.web_url,
    lastSyncAt: row.last_sync_at,
    estimateField: row.estimate_field as TeamGitlabDTO['estimateField'],
    access: row.token ? 'project-token' : 'personal',
    tokenExpiresAt: row.token_expires_at,
    canWrite: canWrite(row),
    webhookAt: row.webhook_at,
  };
}

