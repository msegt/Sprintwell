import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { useAction, useNotice, useTeam } from '../lib/hooks';
import { GitlabButton } from './GitlabButton';
import { Button, ConfirmButton, CopyButton, Field, Icon } from './ui';

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
  const config = usePublicConfig();
  const run = useAction();
  const { notify } = useNotice();
  const [busy, setBusy] = useState(false);
  const gl = snap.team.gitlab;
  if (!gl || readOnly) return null;
  if (gl.access === 'personal' && !me.gitlab?.canUseApi) {
    return config?.gitlab.oauth ? (
      <GitlabButton purpose="grant" returnTo={location.pathname} small={small}>
        Allow GitLab access to sync
      </GitlabButton>
    ) : null;
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

function TokenSteps({ host }: { host: string }) {
  return (
    <ol className="guide-steps small">
      <li>
        In your team’s project on {host}, open <strong>Settings → Access tokens</strong> and choose <strong>Add new token</strong>. (Project owners and maintainers can do this.)
      </li>
      <li>
        Name it “Sprintwell”, choose the role <strong>Developer</strong>, tick the <strong>api</strong> scope (or <strong>read_api</strong> if Sprintwell should only read), and set the expiry date to the end of term.
      </li>
      <li>Create it, copy the token and paste it below with the project’s address.</li>
    </ol>
  );
}

/** Link the team to its GitLab project (Team page). */
export function GitlabProjectCard() {
  const config = usePublicConfig();
  const { snap, teamId, isAdmin, readOnly } = useTeam();
  const run = useAction();
  const [project, setProject] = useState(snap.team.gitlab?.webUrl ?? snap.team.settings.trackerUrl);
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  if (!config?.gitlab.enabled) return null;
  const linked = snap.team.gitlab;
  const host = new URL(config.gitlab.url).host;
  const expiresSoon = linked?.tokenExpiresAt && Date.parse(linked.tokenExpiresAt) - Date.now() < 14 * 86_400_000;

  const link = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api('POST', `/api/teams/${teamId}/gitlab`, { project: project.trim(), ...(token.trim() && { token: token.trim() }) }), linked ? 'GitLab token updated' : 'GitLab project linked. Choose Sync with GitLab to import.');
    if (ok) {
      setToken('');
      setReplacing(false);
    }
  };

  const form = (
    <form className="stack" onSubmit={link}>
      <TokenSteps host={host} />
      <Field label="Project address" hint={`For example https://${host}/group/project`}>
        {(id, h) => <input id={id} aria-describedby={h} className="input" required value={project} onChange={(e) => setProject(e.target.value)} placeholder={`https://${host}/group/project`} />}
      </Field>
      <Field label="Project access token" hint="Stored encrypted. Nobody, including your team, can see it again in Sprintwell.">
        {(id, h) => <input id={id} aria-describedby={h} className="input" required={!config.gitlab.oauth} autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="glpat-…" />}
      </Field>
      <div className="row">
        <Button type="submit" variant="primary">
          {linked ? 'Save new token' : 'Link project'}
        </Button>
        {replacing && <Button onClick={() => setReplacing(false)}>Cancel</Button>}
      </div>
    </form>
  );

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
          <p className="small">
            {linked.access === 'project-token' ? (
              <>
                Uses the team’s project access token{linked.tokenExpiresAt && `, which expires on ${new Date(`${linked.tokenExpiresAt}T12:00:00`).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`}.{' '}
                {!linked.canWrite && 'It can only read, so estimates are not sent to GitLab.'}
              </>
            ) : (
              'Uses the GitLab access of the person who syncs.'
            )}
          </p>
          {expiresSoon && (
            <p className="callout warn small" role="note">
              The token expires soon. Create a new one in GitLab and save it here so sync keeps working.
            </p>
          )}
          <ul className="guide-tips">
            <li>Sync imports open issues as backlog items (reading “As a… I want… so that…” and an “Acceptance criteria” list from the description) and milestones as sprints. Imported items stay in the Product Backlog until they are Ready.</li>
            <li>It records merge requests, reviews, comments and commits in the team’s Activity log, for people who verified their GitLab account.</li>
            <li>Estimates go back to GitLab when they are saved, as the issue weight or, where GitLab has no weights, a “points::N” label. In GitLab they appear as changed by the token’s bot user.</li>
          </ul>
          {!readOnly && (
            <div className="row wrap">
              <GitlabSyncButton />
              {!replacing && <Button onClick={() => setReplacing(true)}>Replace token</Button>}
              {(isAdmin || readOnly) && (
                <ConfirmButton confirmLabel="Unlink the GitLab project" onConfirm={() => run(() => api('DELETE', `/api/teams/${teamId}/gitlab`), 'GitLab project unlinked')}>
                  Unlink
                </ConfirmButton>
              )}
            </div>
          )}
          {replacing && form}
          {linked.access === 'project-token' && <WebhookSetup />}
        </>
      ) : readOnly ? (
        <p className="muted">The team has not linked a GitLab project yet.</p>
      ) : (
        <>
          <p className="muted">Link your team’s project on {host} to import issues and milestones, record merge requests, reviews and commits, and send estimates back to GitLab.</p>
          {form}
        </>
      )}
    </section>
  );
}

/** Optional: GitLab tells Sprintwell about changes as they happen. */
function WebhookSetup() {
  const { snap, teamId } = useTeam();
  const run = useAction();
  const [hook, setHook] = useState<{ url: string; secret: string } | null>(null);
  const received = snap.team.gitlab?.webhookAt;
  return (
    <details className="guide-more">
      <summary>Live updates with a webhook (optional){received ? ' · working' : ''}</summary>
      <p className="small">Without a webhook, Sprintwell reads GitLab when someone chooses Sync. With one, merge requests, reviews, commits and issue changes appear within seconds.</p>
      {received && <p className="small">Last webhook received {new Date(received).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.</p>}
      {!hook ? (
        <Button small onClick={async () => setHook((await run(() => api<{ url: string; secret: string }>('GET', `/api/teams/${teamId}/gitlab/webhook`))) ?? null)}>
          Show webhook details
        </Button>
      ) : (
        <>
          <ol className="guide-steps small">
            <li>
              In the project, open <strong>Settings → Webhooks</strong> and choose <strong>Add new webhook</strong>.
            </li>
            <li>Paste the URL and the secret token below.</li>
            <li>
              Tick <strong>Push events</strong>, <strong>Comments</strong>, <strong>Issues events</strong> and <strong>Merge request events</strong>, keep SSL verification on, and add the webhook.
            </li>
            <li>
              Use <strong>Test → Push events</strong> in GitLab: this page then shows when the webhook was last received.
            </li>
          </ol>
          <div className="invite-box">
            <code className="invite-link">{hook.url}</code>
            <CopyButton text={hook.url} label="Copy URL" />
          </div>
          <div className="invite-box">
            <code className="invite-link">{hook.secret}</code>
            <CopyButton text={hook.secret} label="Copy secret token" />
          </div>
        </>
      )}
    </details>
  );
}
