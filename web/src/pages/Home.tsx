import { LIMITS } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { GitlabButton } from '../components/GitlabButton';
import { CreateClass, useMyClasses } from './Classes';
import { Button, Field, Icon } from '../components/ui';
import { api, setToken } from '../lib/api';
import { useAction, useMe, usePageTitle } from '../lib/hooks';

const FEATURES: { title: string; body: string; icon: string; kind: string }[] = [
  { title: 'Planning Poker', icon: 'cards', kind: 'poker', body: 'Hidden, simultaneous votes; the highest and lowest estimates explain first; estimates flow back to your stories.' },
  { title: 'Retrospectives', icon: 'loop', kind: 'retro', body: 'Ten formats from Start, Stop, Continue to the Sailboat, with silent writing, grouping, dot voting and follow-up actions.' },
  { title: 'Every Scrum event', icon: 'calendar', kind: 'planning', body: 'Sprint Planning with capacity, Daily Scrum with a fair timer, Sprint Review feedback straight into the backlog.' },
  { title: 'A living team charter', icon: 'list', kind: 'review', body: 'Working agreement, Definition of Ready and Definition of Done, plus INVEST checks on every story.' },
  { title: 'Risk register', icon: 'shield', kind: 'daily', body: 'Likelihood × impact heat map with countermeasures, owners and status.' },
  { title: 'Guidance built in', icon: 'sparkle', kind: 'pairing', body: 'Every page and every step explains what to do, so new teams can run good events from day one.' },
];

function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg viewBox="0 0 420 340" role="presentation">
        <defs>
          <linearGradient id="hg1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0b7a66" />
            <stop offset="1" stopColor="#3949c7" />
          </linearGradient>
          <linearGradient id="hg2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8a3d" />
            <stop offset="1" stopColor="#e0482b" />
          </linearGradient>
          <filter id="hs" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#171528" floodOpacity="0.18" />
          </filter>
        </defs>
        <circle cx="300" cy="120" r="110" fill="url(#hg1)" opacity="0.12" />
        <circle cx="90" cy="250" r="70" fill="#f2a71b" opacity="0.14" />
        {/* Sticky notes */}
        <g className="float-b" filter="url(#hs)">
          <rect x="34" y="34" width="120" height="96" rx="10" fill="#e8f7ee" transform="rotate(-6 94 82)" />
          <rect x="52" y="60" width="72" height="8" rx="4" fill="#15803d" opacity="0.5" transform="rotate(-6 94 82)" />
          <rect x="52" y="78" width="54" height="8" rx="4" fill="#15803d" opacity="0.3" transform="rotate(-6 94 82)" />
          <rect x="60" y="150" width="112" height="90" rx="10" fill="#f3e8ff" transform="rotate(4 116 195)" />
          <rect x="78" y="174" width="70" height="8" rx="4" fill="#9333ea" opacity="0.45" transform="rotate(4 116 195)" />
          <rect x="78" y="192" width="46" height="8" rx="4" fill="#9333ea" opacity="0.3" transform="rotate(4 116 195)" />
          <circle cx="150" cy="226" r="9" fill="#9333ea" opacity="0.8" />
          <circle cx="132" cy="226" r="9" fill="#9333ea" opacity="0.8" />
        </g>
        {/* Fanned poker cards */}
        <g className="float-a" filter="url(#hs)">
          <g transform="rotate(-16 290 290)">
            <rect x="196" y="110" width="92" height="132" rx="14" fill="#fff" stroke="#e4e2ee" />
            <text x="216" y="146" fontFamily="Bricolage Grotesque Variable, sans-serif" fontWeight="800" fontSize="30" fill="#171528">3</text>
          </g>
          <g transform="rotate(-2 290 290)">
            <rect x="244" y="96" width="92" height="132" rx="14" fill="url(#hg2)" />
            <text x="264" y="134" fontFamily="Bricolage Grotesque Variable, sans-serif" fontWeight="800" fontSize="32" fill="#fff">5</text>
          </g>
          <g transform="rotate(13 290 290)">
            <rect x="292" y="108" width="92" height="132" rx="14" fill="url(#hg1)" />
            <circle cx="338" cy="174" r="20" fill="#fff" opacity="0.22" />
            <circle cx="338" cy="174" r="9" fill="#fff" opacity="0.35" />
          </g>
        </g>
        {/* Timer chip */}
        <g filter="url(#hs)" className="float-b">
          <rect x="250" y="270" width="132" height="44" rx="22" fill="#fff" />
          <circle cx="276" cy="292" r="10" fill="none" stroke="#3949c7" strokeWidth="3" />
          <path d="M276 286v7l4 3" stroke="#3949c7" strokeWidth="3" strokeLinecap="round" fill="none" />
          <text x="296" y="299" fontFamily="Bricolage Grotesque Variable, sans-serif" fontWeight="800" fontSize="20" fill="#171528">14:59</text>
        </g>
      </svg>
    </div>
  );
}

export function HomePage() {
  const { user, teams, loading } = useMe();
  const { classes } = useMyClasses();
  usePageTitle('');
  if (loading) return <div className="page" aria-busy="true" />;
  return (
    <div className="page">
      {!user ? (
        <div className="hero-wrap">
          <section className="hero">
            <h1>
              Run your Scrum events <span className="gradient-text">together, in real time.</span>
            </h1>
            <p className="lead">Sprintwell is a free, open-source space where Agile teams plan, estimate, reflect and improve, run by the team itself.</p>
            <ul className="hero-badges" aria-label="Highlights">
              <li>Free and open source</li>
              <li>No sign-up or email</li>
              <li>Accessible by design</li>
            </ul>
            <div className="hero-actions">
              <GitlabButton returnTo="/" variant="primary" />
            </div>
          </section>
          <HeroArt />
        </div>
      ) : (
        <section>
          <h1>Your teams</h1>
          {teams.length === 0 ? (
            <p className="muted">You are not in a team yet. Create one or join with an invite link.</p>
          ) : (
            <ul className="team-list">
              {teams.map((t) => (
                <li key={t.id}>
                  <Link to={`/t/${t.id}`} className="team-tile with-initial">
                    <span className="team-initial" aria-hidden="true">
                      {t.name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
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
          {classes.length > 0 && (
            <>
              <h2>Classes you teach</h2>
              <ul className="team-list">
                {classes.map((c) => (
                  <li key={c.id}>
                    <Link to={`/c/${c.id}`} className="team-tile with-initial">
                      <span className="team-initial" aria-hidden="true">
                        <Icon name="book" size={18} />
                      </span>
                      <span className="team-tile-name">{c.name}</span>
                      <span className="muted small">
                        {c.teamCount} team{c.teamCount === 1 ? '' : 's'} · {c.role === 'owner' ? 'owner' : 'teaching staff'}
                      </span>
                      <Icon name="arrow" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <CreateClass />
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
              {FEATURES.map((f) => (
                <li key={f.title} className={`kind-${f.kind}`}>
                  <span className="feature-icon">
                    <Icon name={f.icon} size={20} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
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
