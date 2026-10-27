import { LIMITS } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Field, Icon } from '../components/ui';
import { api, setToken } from '../lib/api';
import { useAction, useMe, usePageTitle } from '../lib/hooks';

const FEATURES = [
  ['Planning Poker', 'Hidden, simultaneous votes; the highest and lowest estimates explain first; estimates flow back to your stories.'],
  ['Retrospectives', 'Ten formats from Start, Stop, Continue to the Sailboat, with silent writing, grouping, dot voting and follow-up actions.'],
  ['Every Scrum event', 'Sprint Planning with capacity, Daily Scrum with a fair timer, Sprint Review feedback straight into the backlog.'],
  ['A living team charter', 'Working agreement, Definition of Ready and Definition of Done, plus INVEST checks on every story.'],
  ['Risk register', 'Likelihood × impact heat map with countermeasures, owners and status.'],
  ['Yours to keep', 'Export summaries as Markdown and your data as JSON. No accounts or email needed to start.'],
];

export function HomePage() {
  const { user, teams, loading } = useMe();
  usePageTitle('');
  if (loading) return <div className="page" aria-busy="true" />;
  return (
    <div className="page">
      {!user ? (
        <section className="hero">
          <h1>Run your Scrum events together, in real time.</h1>
          <p className="lead">Sprintwell is a free, open-source space where Agile teams plan, estimate, reflect and improve, run by the team itself.</p>
        </section>
      ) : (
        <section>
          <h1>Your teams</h1>
          {teams.length === 0 ? (
            <p className="muted">You are not in a team yet. Create one or join with an invite link.</p>
          ) : (
            <ul className="team-list">
              {teams.map((t) => (
                <li key={t.id}>
                  <Link to={`/t/${t.id}`} className="team-tile">
                    <span className="team-tile-name">{t.name}</span>
                    <span className="muted small">
                      {t.memberCount} member{t.memberCount === 1 ? '' : 's'}
                      {t.role === 'admin' ? ' · admin' : ''}
                    </span>
                    <Icon name="arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid-2">
        <CreateTeam />
        <JoinWithCode />
      </div>

      {!user && (
        <>
          <section aria-labelledby="features" className="features">
            <h2 id="features">What your team gets</h2>
            <ul className="feature-grid">
              {FEATURES.map(([title, body]) => (
                <li key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </section>
          <DeviceSignIn />
        </>
      )}
    </div>
  );
}

function CreateTeam() {
  const { user, ensureUser, refresh } = useMe();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useAction();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await run(async () => {
      await ensureUser(name.trim());
      return api<{ teamId: string }>('POST', '/api/teams', { name: teamName.trim(), starterCharter: true });
    });
    setBusy(false);
    if (r) {
      await refresh();
      navigate(`/t/${r.teamId}`);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Start a team</h2>
      <p className="muted">You will be the team admin and get an invite link to share.</p>
      {!user && (
        <Field label="Your name" hint="Shown to your teammates. No email needed.">
          {(id, d) => <input id={id} aria-describedby={d} className="input" required maxLength={LIMITS.displayName} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        </Field>
      )}
      <Field label="Team name">
        {(id) => <input id={id} className="input" required maxLength={LIMITS.teamName} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Team 3: Observatory" />}
      </Field>
      <Button type="submit" variant="primary" busy={busy}>
        Create team
      </Button>
    </form>
  );
}

function JoinWithCode() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Accept a whole invite link as well as a bare code.
    const match = /join\/([a-z0-9]+)/i.exec(code) ?? /^([a-z0-9]{6,})$/i.exec(code.trim());
    if (match) navigate(`/join/${match[1]!.toLowerCase()}`);
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Join a team</h2>
      <p className="muted">Paste the invite link or code a teammate shared with you.</p>
      <Field label="Invite link or code">
        {(id) => <input id={id} className="input" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…/join/abc123defg" />}
      </Field>
      <Button type="submit">Continue</Button>
    </form>
  );
}

function DeviceSignIn() {
  const [code, setCode] = useState('');
  const run = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ token: string }>('POST', '/api/device-link/redeem', { code: code.trim() }), 'Signed in. Welcome back!');
    if (r) setToken(r.token);
  };
  return (
    <form className="card subtle" onSubmit={submit}>
      <h2>Already use Sprintwell on another device?</h2>
      <p className="muted">
        On that device, open your profile and choose <strong>Sign in on another device</strong>. Enter the 8-character code here.
      </p>
      <div className="inline-form">
        <label className="sr-only" htmlFor="device-code">
          Sign-in code
        </label>
        <input id="device-code" className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} placeholder="ABCD2345" autoComplete="one-time-code" />
        <Button type="submit">Sign in</Button>
      </div>
    </form>
  );
}
