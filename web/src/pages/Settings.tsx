import { DECKS, LIMITS, type TeamSettings } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { HowTo } from '../components/Guide';
import { Avatar, Badge, Button, ConfirmButton, CopyButton, Field, Icon } from '../components/ui';
import { PAGE_GUIDES } from '../content/guides';
import { api, download } from '../lib/api';
import { useAction, useMe, usePageTitle, useTeam } from '../lib/hooks';

export function SettingsPage() {
  const { snap, teamId, isAdmin, me } = useTeam();
  const { refresh: refreshMe } = useMe();
  const run = useAction();
  const navigate = useNavigate();
  usePageTitle('Team');
  const link = `${location.origin}/join/${snap.team.inviteCode}`;
  const admins = snap.team.members.filter((m) => m.role === 'admin');

  return (
    <div className="page stack">
      <h1>Team</h1>
      <HowTo id="team" guide={PAGE_GUIDES.team} />
      <section className="card" aria-labelledby="invite-h">
        <h2 id="invite-h">Invite people</h2>
        <p className="muted small">Anyone with this link can join the team. Share it only with your team, and create a new link if it leaks.</p>
        <div className="invite-box">
          <code className="invite-link">{link}</code>
          <CopyButton text={link} label="Copy link" />
        </div>
        <p className="small">
          Invite code: <strong className="code-display small-code">{snap.team.inviteCode}</strong>
        </p>
        {isAdmin && (
          <ConfirmButton variant="secondary" confirmLabel="Create new link (the old one stops working)" onConfirm={() => run(() => api('POST', `/api/teams/${teamId}/invite`), 'New invite link created')}>
            Create a new link
          </ConfirmButton>
        )}
      </section>

      <section className="card" aria-labelledby="members-h">
        <h2 id="members-h">Members ({snap.team.members.length})</h2>
        <p className="small muted">In Scrum everyone building the product is a Developer. Admin here only means managing this space.</p>
        <ul className="member-list">
          {snap.team.members.map((m) => (
            <li key={m.userId} className="row between wrap">
              <span className="row">
                <Avatar id={m.userId} name={m.displayName} />
                <span>
                  {m.displayName}
                  {m.userId === me.id && <span className="muted"> (you)</span>}
                </span>
                {m.role === 'admin' && <Badge tone="info">Admin</Badge>}
              </span>
              {isAdmin && m.userId !== me.id && (
                <span className="row">
                  <Button small variant="ghost" onClick={() => run(() => api('PATCH', `/api/teams/${teamId}/members/${m.userId}`, { role: m.role === 'admin' ? 'member' : 'admin' }))}>
                    {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                  </Button>
                  <ConfirmButton confirmLabel={`Remove ${m.displayName}`} onConfirm={() => run(() => api('DELETE', `/api/teams/${teamId}/members/${m.userId}`), `${m.displayName} was removed. A new invite link was created so the old one no longer works.`)}>
                    Remove
                  </ConfirmButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin ? <TeamSettingsForm /> : <p className="muted">Team admins ({admins.map((a) => a.displayName).join(', ')}) can change the team settings.</p>}

      <section className="card" aria-labelledby="data-h">
        <h2 id="data-h">Data</h2>
        <div className="row wrap">
          <Button onClick={() => run(() => download(`/api/teams/${teamId}/export.json`, 'team.json'))}>
            <Icon name="download" /> Export everything (JSON)
          </Button>
          <Button onClick={() => run(() => download(`/api/teams/${teamId}/stories.csv`, 'stories.csv'))}>
            <Icon name="download" /> Stories (CSV)
          </Button>
        </div>
        <p className="small muted">The CSV has title and description columns, which GitLab can import as issues.</p>
        <h3>Leave or delete</h3>
        <div className="row wrap">
          <ConfirmButton
            confirmLabel="Leave this team"
            onConfirm={async () => {
              if (await run(() => api('DELETE', `/api/teams/${teamId}/members/${me.id}`))) {
                await refreshMe();
                navigate('/');
              }
            }}
          >
            Leave team
          </ConfirmButton>
          {isAdmin && (
            <ConfirmButton
              confirmLabel="Delete the team and all its data for everyone"
              onConfirm={async () => {
                if (await run(() => api('DELETE', `/api/teams/${teamId}`))) {
                  await refreshMe();
                  navigate('/');
                }
              }}
            >
              Delete team
            </ConfirmButton>
          )}
        </div>
      </section>
    </div>
  );
}

function TeamSettingsForm() {
  const { snap, teamId } = useTeam();
  const run = useAction();
  const [name, setName] = useState(snap.team.name);
  const [s, setS] = useState<TeamSettings>(snap.team.settings);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => api('PATCH', `/api/teams/${teamId}`, { name: name.trim(), settings: s }), 'Settings saved');
  };
  return (
    <form className="card stack" onSubmit={save} aria-labelledby="settings-h">
      <h2 id="settings-h">Settings</h2>
      <Field label="Team name">{(id) => <input id={id} className="input" required maxLength={LIMITS.teamName} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="row wrap">
        <Field label="Sprint length (days)">
          {(id) => <input id={id} type="number" min={1} max={60} className="input input-short" value={s.sprintLengthDays} onChange={(e) => setS({ ...s, sprintLengthDays: Number(e.target.value) })} />}
        </Field>
        <Field label="Retrospective votes per person">
          {(id) => <input id={id} type="number" min={1} max={20} className="input input-short" value={s.retroVotesPerPerson} onChange={(e) => setS({ ...s, retroVotesPerPerson: Number(e.target.value) })} />}
        </Field>
        <Field label="Suggest splitting at" hint="Estimates at or above this value show a “consider splitting” hint.">
          {(id, h) => <input id={id} aria-describedby={h} type="number" min={1} max={1000} className="input input-short" value={s.splitThreshold} onChange={(e) => setS({ ...s, splitThreshold: Number(e.target.value) })} />}
        </Field>
      </div>
      <Field label="Default Planning Poker deck">
        {(id) => (
          <select id={id} className="input" value={s.defaultDeck} onChange={(e) => setS({ ...s, defaultDeck: e.target.value })}>
            {DECKS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Issue tracker project (optional)" hint="Your GitLab or GitHub project address. Used to prefill imports.">
        {(id, h) => <input id={id} aria-describedby={h} type="url" className="input" maxLength={500} value={s.trackerUrl} onChange={(e) => setS({ ...s, trackerUrl: e.target.value })} placeholder="https://git.example.ac.uk/group/project" />}
      </Field>
      <div>
        <Button type="submit" variant="primary">
          Save settings
        </Button>
      </div>
    </form>
  );
}
