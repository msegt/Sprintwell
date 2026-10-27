import { LIMITS } from '@sprintwell/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button, ConfirmButton, CopyButton, Field } from '../components/ui';
import { api, download, setToken } from '../lib/api';
import { useAction, useMe, usePageTitle } from '../lib/hooks';

export function ProfilePage() {
  const { user, loading, refresh, signOut } = useMe();
  const [name, setName] = useState(user?.displayName ?? '');
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null);
  const run = useAction();
  const navigate = useNavigate();
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
