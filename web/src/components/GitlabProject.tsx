import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { useAction, useNotice, useTeam } from '../lib/hooks';
import { GitlabButton } from './GitlabButton';
import { Button, ConfirmButton, Field, Icon } from './ui';

interface SyncResult {
  issuesCreated: number;
  issuesUpdated: number;
  sprintsCreated: number;
  sprintsUpdated: number;
  estimatesPushed: number;
  events: number;
  partial: boolean;
}

function describe(r: SyncResult): string {
  const parts = [
    r.issuesCreated && `${r.issuesCreated} new item${r.issuesCreated === 1 ? '' : 's'}`,
    r.issuesUpdated && `${r.issuesUpdated} updated`,
    r.sprintsCreated && `${r.sprintsCreated} sprint${r.sprintsCreated === 1 ? '' : 's'} from milestones`,
    r.estimatesPushed && `${r.estimatesPushed} estimate${r.estimatesPushed === 1 ? '' : 's'} sent to GitLab`,
    r.events && `${r.events} GitLab activit${r.events === 1 ? 'y' : 'ies'} logged`,
  ].filter(Boolean);
  return `Synced with GitLab: ${parts.length ? parts.join(', ') : 'everything was up to date'}.${r.partial ? ' There is more to fetch: sync again to continue.' : ''}`;
}

/** "Sync with GitLab" button for teams with a linked project. */
export function GitlabSyncButton({ small }: { small?: boolean }) {
  const { snap, teamId, me, readOnly } = useTeam();
  const run = useAction();
  const { notify } = useNotice();
  const [busy, setBusy] = useState(false);
  if (!snap.team.gitlab || readOnly) return null;
  if (!me.gitlab?.canUseApi) {
    return (
      <GitlabButton purpose="grant" returnTo={location.pathname} small={small}>
        Allow GitLab access to sync
      </GitlabButton>
    );
  }
  return (
    <Button
      small={small}
      busy={busy}
      onClick={async () => {
        setBusy(true);
        const r = await run(() => api<SyncResult>('POST', `/api/teams/${teamId}/gitlab/sync`));
        setBusy(false);
        if (r) notify(describe(r), 'success');
      }}
    >
      <Icon name="loop" size={16} /> Sync with GitLab
    </Button>
  );
}

/** Link the team to its GitLab project (Team page). */
export function GitlabProjectCard() {
  const config = usePublicConfig();
  const { snap, teamId, me, isAdmin, readOnly } = useTeam();
  const run = useAction();
  const [project, setProject] = useState(snap.team.settings.trackerUrl);
  if (!config?.gitlab.enabled) return null;
  const linked = snap.team.gitlab;
  const host = new URL(config.gitlab.url).host;

  const link = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => api('POST', `/api/teams/${teamId}/gitlab`, { project: project.trim() }), 'GitLab project linked. Choose Sync with GitLab to import.');
  };

  return (
    <section className="card stack" aria-labelledby="gitlab-project-h">
      <h2 id="gitlab-project-h">GitLab project</h2>
      {linked ? (
        <>
          <p>
            Linked to{' '}
            <a href={linked.webUrl} target="_blank" rel="noopener noreferrer">
              {linked.path} <Icon name="external" size={12} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            . {linked.lastSyncAt ? `Last synced ${new Date(linked.lastSyncAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not synced yet.'}
          </p>
          <ul className="guide-tips">
            <li>Sync imports open issues as backlog items (reading “As a… I want… so that…” and an “Acceptance criteria” list from the description) and milestones as sprints. Imported items stay in the Product Backlog until they are Ready.</li>
            <li>It also records merge requests, reviews, comments and commits in the team’s Activity log, for people who signed in with GitLab.</li>
            <li>
              Estimates go back to GitLab automatically when they are saved, as the issue weight{linked.estimateField === 'label' ? '. This GitLab has no weights, so they are written as a “points::N” label' : ' or, where GitLab has no weights, a “points::N” label'}.
            </li>
            <li>Changes made in GitLab after Sprintwell’s own win when titles and descriptions differ.</li>
          </ul>
          <div className="row wrap">
            <GitlabSyncButton />
            {(isAdmin || readOnly) && (
              <ConfirmButton confirmLabel="Unlink the GitLab project" onConfirm={() => run(() => api('DELETE', `/api/teams/${teamId}/gitlab`), 'GitLab project unlinked')}>
                Unlink
              </ConfirmButton>
            )}
          </div>
        </>
      ) : readOnly ? (
        <p className="muted">The team has not linked a GitLab project yet.</p>
      ) : !me.gitlab ? (
        <>
          <p className="muted">Link your team’s project on {host} to import issues and milestones, record merge requests and reviews, and send estimates back to GitLab. First sign in with GitLab.</p>
          <div>
            <GitlabButton returnTo={location.pathname} />
          </div>
        </>
      ) : !me.gitlab.canUseApi ? (
        <>
          <p className="muted">To link a project, allow Sprintwell to use GitLab on your behalf. You can see what this means on your <Link to="/me">profile</Link>.</p>
          <div>
            <GitlabButton purpose="grant" returnTo={location.pathname}>
              Allow access to GitLab
            </GitlabButton>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={link}>
          <Field label="Project address" hint={`For example https://${host}/group/project. You must be a member of the project.`}>
            {(id, h) => <input id={id} aria-describedby={h} className="input" required value={project} onChange={(e) => setProject(e.target.value)} placeholder={`https://${host}/group/project`} />}
          </Field>
          <div>
            <Button type="submit" variant="primary">
              Link project
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
