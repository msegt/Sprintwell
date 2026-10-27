import { LIMITS } from '@sprintwell/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GitlabButton } from '../components/GitlabButton';
import { Button, Field } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useMe, usePageTitle } from '../lib/hooks';

export function JoinPage() {
  const { code = '' } = useParams();
  const { user, ensureUser, refresh, loading } = useMe();
  const [preview, setPreview] = useState<{ teamName: string; memberCount: number; className: string | null; requireGitlab: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useAction();
  const navigate = useNavigate();
  usePageTitle(preview ? `Join ${preview.teamName}` : 'Join a team');

  useEffect(() => {
    api<{ teamName: string; memberCount: number; className: string | null; requireGitlab: boolean }>('GET', `/api/invites/${encodeURIComponent(code)}`)
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [code]);

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    const r = await run(async () => {
      await ensureUser(name.trim());
      return api<{ teamId: string }>('POST', '/api/teams/join', { code });
    });
    setBusy(false);
    if (r) {
      await refresh();
      navigate(`/t/${r.teamId}`, { replace: true });
    }
  };

  if (error) {
    return (
      <div className="page narrow">
        <h1>Invite not found</h1>
        <p>{error}</p>
        <Link to="/">Back to Sprintwell</Link>
      </div>
    );
  }
  if (!preview || loading) return <div className="page narrow" aria-busy="true" />;
  const needsGitlab = preview.requireGitlab && !user?.gitlab;

  return (
    <div className="page narrow">
      <form className="card" onSubmit={join}>
        <p className="eyebrow">You are invited to join</p>
        <h1>{preview.teamName}</h1>
        <p className="muted">
          {preview.className && <>Part of {preview.className}. </>}
          {preview.memberCount} member{preview.memberCount === 1 ? '' : 's'} so far.
        </p>
        {needsGitlab ? (
          <div className="stack">
            <p>
              {preview.className} asks everyone to <strong>sign in with GitLab</strong> before joining, so that your contributions are linked to your GitLab account.
            </p>
            <div>
              <GitlabButton returnTo={`/join/${code}`} variant="primary" />
            </div>
          </div>
        ) : (
          <>
        {user ? (
          <p>
            You will join as <strong>{user.displayName}</strong>
            {user.gitlab && <> (GitLab @{user.gitlab.username})</>}.
          </p>
        ) : (
          <Field label="Your name" hint="Shown to your teammates. You can change it later.">
            {(id, d) => <input id={id} aria-describedby={d} className="input" required autoFocus maxLength={LIMITS.displayName} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
          </Field>
        )}
        <div className="row wrap">
          <Button type="submit" variant="primary" busy={busy}>
            Join team
          </Button>
          {!user?.gitlab && (
            <GitlabButton returnTo={`/join/${code}`}>{user ? 'Verify with GitLab first' : 'Sign in with GitLab instead'}</GitlabButton>
          )}
        </div>
          </>
        )}
        {!user && (
          <p className="small muted">
            Sprintwell remembers you on this device. Read the <Link to="/privacy">privacy notes</Link>.
          </p>
        )}
      </form>
    </div>
  );
}
