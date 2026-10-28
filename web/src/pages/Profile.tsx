import { LIMITS } from '@sprintwell/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { GitlabButton } from '../components/GitlabButton';
import { GitlabVerify } from '../components/GitlabVerify';
import { Badge, Button, ConfirmButton, CopyButton, Field } from '../components/ui';
import { usePublicConfig } from '../lib/config';
import { api, download, setToken } from '../lib/api';
import { useAction, useMe, usePageTitle } from '../lib/hooks';

export function ProfilePage() {
  const { user, loading, refresh, signOut } = useMe();
  const [name, setName] = useState(user?.displayName ?? '');
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null);
  const run = useAction();
  const navigate = useNavigate();
  const config = usePublicConfig();
  usePageTitle('Your profile');
  useEffect(() => {
    if (user) setName(user.displayName);
  }, [user]);
  if (loading) return <div className="page narrow" aria-busy="true" />;
  if (!user) return <Navigate to="/" replace />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api('PATCH', '/api/me', { displayName: name.trim() }), 'Name updated')) await refresh();
  };

  return (
    <div className="page narrow stack">
      <h1>Your profile</h1>
      <form className="card" onSubmit={save}>
        <Field label="Display name" hint="This is how teammates see you in every team.">
          {(id, d) => <input id={id} aria-describedby={d} className="input" required maxLength={LIMITS.displayName} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </form>

      {config?.gitlab.enabled && (
        <section className="card stack" aria-labelledby="gitlab-h">
          <h2 id="gitlab-h">GitLab</h2>
          {user.gitlab && user.gitlab.source !== 'staff' ? (
            <>
              <p>
                Your GitLab account is <strong>@{user.gitlab.username}</strong> <Badge tone="good">Verified</Badge>
              </p>
              <p className="small muted">
                Your teams and teachers see your GitLab username next to your name, and your merge requests, reviews and commits count towards your activity. On another device, verify with a new
                token{config.gitlab.oauth ? ' or sign in with GitLab' : ''} to get back to this profile.
              </p>
              {config.gitlab.oauth &&
                (user.gitlab.canUseApi ? (
                  <p className="small">Sprintwell may use GitLab on your behalf, for example to import issues and write estimates back. It only does so when you or your team ask it to.</p>
                ) : (
                  <>
                    <p className="small">
                      Optional: allow Sprintwell to use GitLab on your behalf, for teams that have not added a project access token. GitLab will ask you to approve the <code>api</code> permission.
                    </p>
                    <div>
                      <GitlabButton purpose="grant" returnTo="/me">
                        Allow access to GitLab
                      </GitlabButton>
                    </div>
                  </>
                ))}
              <div>
                <ConfirmButton
                  confirmLabel="Disconnect GitLab"
                  onConfirm={async () => {
                    if (await run(() => api('DELETE', '/api/me/gitlab'), 'GitLab disconnected')) await refresh();
                  }}
                >
                  Disconnect GitLab
                </ConfirmButton>
              </div>
            </>
          ) : (
            <>
              {user.gitlab?.source === 'staff' && (
                <p>
                  Your teacher linked you to <strong>@{user.gitlab.username}</strong>. Please confirm it is you by verifying below (if it is not, verify with your own account).
                </p>
              )}
              <p className="muted">
                Link your GitLab account ({new URL(config.gitlab.url).host}) so your team and teachers know it is you, and so your GitLab work counts towards your activity.
              </p>
              {config.gitlab.oauth && (
                <div>
                  <GitlabButton returnTo="/me" variant="primary" />
                </div>
              )}
              <GitlabVerify />
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Sign in on another device</h2>
        <p className="muted">
          Sprintwell does not use passwords yet. Your identity lives in this browser. To use it on your phone or another computer, create a one-time code and enter it on the
          Sprintwell home page there. Codes last 10 minutes.
        </p>
        {link ? (
          <div className="device-code" aria-live="polite">
            <span className="code-display">{link.code}</span>
            <CopyButton text={link.code} />
          </div>
        ) : (
          <Button onClick={async () => setLink((await run(() => api<{ code: string; expiresAt: string }>('POST', '/api/me/device-link'))) ?? null)}>Create a code</Button>
        )}
        <p className="small muted">If you clear this browser’s data without doing this first, you will need to rejoin your teams with their invite links.</p>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <div className="row wrap">
          <Button onClick={() => run(() => download('/api/me/export', 'sprintwell-my-data.json'))}>Download my data</Button>
          <Button
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            Sign out on this device
          </Button>
        </div>
        <p className="small muted">
          Signing out forgets you on this device. Create a sign-in code first if you want to come back as the same person.
        </p>
        <h3>Delete my data</h3>
        <p className="small muted">
          Removes you from every team, signs you out everywhere and replaces your name with “Former member”. Cards and notes you wrote stay with your teams but are no longer linked to you. See{' '}
          <Link to="/privacy">privacy</Link>.
        </p>
        <ConfirmButton
          confirmLabel="Yes, delete my data"
          onConfirm={async () => {
            if (await run(() => api('DELETE', '/api/me'))) {
              setToken(null);
              navigate('/');
            }
          }}
        >
          Delete my data
        </ConfirmButton>
      </section>
    </div>
  );
}
