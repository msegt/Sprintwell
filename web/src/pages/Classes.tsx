import { LIMITS, type ClassDTO, type ClassSummaryDTO, type ResourceLink } from '@sprintwell/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, ConfirmButton, CopyButton, Empty, Field, Icon, formatDate } from '../components/ui';
import { api, download } from '../lib/api';
import { useAction, useMe, usePageTitle } from '../lib/hooks';
import '../styles/classes.css';

/** Classes the signed-in person teaches, for the home page. */
export function useMyClasses(): { classes: ClassSummaryDTO[]; reload(): void } {
  const { user } = useMe();
  const [classes, setClasses] = useState<ClassSummaryDTO[]>([]);
  const reload = useCallback(() => {
    if (!user) return setClasses([]);
    api<{ classes: ClassSummaryDTO[] }>('GET', '/api/classes').then((r) => setClasses(r.classes), () => undefined);
  }, [user]);
  useEffect(reload, [reload]);
  return { classes, reload };
}

/** Lets someone who teaches create a class from the home page. */
export function CreateClass() {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const run = useAction();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ classId: string }>('POST', '/api/classes', { name: name.trim() }));
    if (r) navigate(`/c/${r.classId}`);
  };
  if (!open) {
    return (
      <p className="small muted">
        Teaching a module?{' '}
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          Create a class
        </button>{' '}
        to set up teams for your students and follow their activity.
      </p>
    );
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>Create a class</h2>
      <p className="muted small">You create the teams and share an invite link with each one. You can see every team’s work and activity, but you are not a team member.</p>
      <Field label="Class name">
        {(id) => <input id={id} className="input" required maxLength={LIMITS.teamName} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CMT651 Agile Software Development 2026/27" />}
      </Field>
      <div className="row">
        <Button type="submit" variant="primary">
          Create class
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export function ClassPage() {
  const { classId = '' } = useParams();
  const { user, loading } = useMe();
  const [cls, setCls] = useState<ClassDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useAction();
  const navigate = useNavigate();
  usePageTitle(cls?.name ?? 'Class');

  const load = useCallback(() => {
    api<ClassDTO>('GET', `/api/classes/${classId}`).then(setCls, (e: Error) => setError(e.message));
  }, [classId]);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading) return <div className="page" aria-busy="true" />;
  if (!user || error) {
    return (
      <div className="page narrow">
        <h1>Class not available</h1>
        <p>{error ?? 'Sign in first.'}</p>
        <Link to="/">Back to Sprintwell</Link>
      </div>
    );
  }
  if (!cls) return <div className="page" aria-busy="true" />;

  const students = cls.teams.reduce((a, t) => a + t.members.length, 0);
  const unverified = cls.teams.flatMap((t) => t.members).filter((m) => !m.gitlabUsername).length;

  return (
    <div className="page stack">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Class · you are {cls.myRole === 'owner' ? 'the owner' : 'teaching staff'}</p>
          <h1>{cls.name}</h1>
          <p className="muted">
            {cls.teams.length} team{cls.teams.length === 1 ? '' : 's'} · {students} student{students === 1 ? '' : 's'}
            {unverified > 0 && ` · ${unverified} not signed in with GitLab`}
          </p>
        </div>
        <Button onClick={() => run(() => download(`/api/classes/${classId}/activity.csv`, 'activity-summary.csv'))}>
          <Icon name="download" /> Activity summary (CSV)
        </Button>
      </div>

      <section aria-labelledby="teams-h" className="stack">
        <h2 id="teams-h">Teams</h2>
        {cls.teams.length === 0 ? (
          <Empty title="No teams yet">Add your teams below, then share each team’s invite link with its students.</Empty>
        ) : (
          <ul className="class-teams">
            {cls.teams.map((t) => {
              const link = `${location.origin}/join/${t.inviteCode}`;
              return (
                <li key={t.id} className="card class-team">
                  <div className="row between wrap">
                    <h3>
                      <Link to={`/t/${t.id}`}>{t.name}</Link>
                    </h3>
                    <span className="small muted">
                      {t.recentActivity} action{t.recentActivity === 1 ? '' : 's'} in the last 7 days{t.lastActivityAt && ` · last ${formatDate(t.lastActivityAt)}`}
                    </span>
                  </div>
                  {t.members.length === 0 ? (
                    <p className="small muted">Nobody has joined yet. The first student to join becomes the team admin.</p>
                  ) : (
                    <ul className="class-members">
                      {t.members.map((m) => (
                        <li key={m.userId}>
                          {m.displayName}
                          {m.gitlabUsername ? <span className="muted small"> @{m.gitlabUsername}</span> : <Badge tone="warn">No GitLab</Badge>}
                          {m.role === 'admin' && <Badge tone="info">Admin</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="invite-box">
                    <code className="invite-link">{link}</code>
                    <CopyButton text={link} label={`Copy invite link for ${t.name}`} copiedLabel="Copied" />
                  </div>
                  <p className="small">
                    <Link to={`/t/${t.id}/activity`}>Activity</Link> · <Link to={`/t/${t.id}/settings`}>Members and invite</Link>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <AddTeams classId={classId} existing={cls.teams.length} onDone={load} />
      </section>

      <ClassSettingsForm cls={cls} onSaved={load} />

      <section className="card stack" aria-labelledby="staff-h">
        <h2 id="staff-h">Teaching staff</h2>
        <ul className="plain-list">
          {cls.staff.map((s) => (
            <li key={s.userId} className="row between wrap">
              <span>
                {s.displayName}
                {s.gitlabUsername && <span className="muted small"> @{s.gitlabUsername}</span>} {s.role === 'owner' && <Badge tone="info">Owner</Badge>}
              </span>
              {cls.myRole === 'owner' && s.role !== 'owner' && (
                <ConfirmButton confirmLabel={`Remove ${s.displayName}`} onConfirm={() => run(() => api('DELETE', `/api/classes/${classId}/staff/${s.userId}`)).then(load)}>
                  Remove
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        <p className="small muted">To add a colleague (a moderator or teaching assistant), send them this link. They will see every team, read-only. Do not share it with students.</p>
        <div className="invite-box">
          <code className="invite-link">{`${location.origin}/c/join/${cls.staffCode}`}</code>
          <CopyButton text={`${location.origin}/c/join/${cls.staffCode}`} label="Copy staff link" />
        </div>
        {cls.myRole === 'owner' && (
          <div>
            <ConfirmButton variant="secondary" confirmLabel="Create a new staff link (the old one stops working)" onConfirm={() => run(() => api('POST', `/api/classes/${classId}/staff-code`)).then(load)}>
              New staff link
            </ConfirmButton>
          </div>
        )}
      </section>

      {cls.myRole === 'owner' && (
        <section className="card" aria-labelledby="danger-h">
          <h2 id="danger-h">Delete the class</h2>
          <p className="small muted">Teams nobody joined are deleted. Teams with students stay with their students, but you lose access to them.</p>
          <ConfirmButton
            confirmLabel="Delete this class"
            onConfirm={async () => {
              if (await run(() => api('DELETE', `/api/classes/${classId}`))) navigate('/');
            }}
          >
            Delete class
          </ConfirmButton>
        </section>
      )}
    </div>
  );
}

function AddTeams({ classId, existing, onDone }: { classId: string; existing: number; onDone(): void }) {
  const [text, setText] = useState('');
  const run = useAction();
  const suggest = () => setText(Array.from({ length: 4 }, (_, i) => `Team ${existing + i + 1}`).join('\n'));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const names = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!names.length) return;
    if (await run(() => api('POST', `/api/classes/${classId}/teams`, { names }), `${names.length} team${names.length === 1 ? '' : 's'} created`)) {
      setText('');
      onDone();
    }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Add teams</h3>
      <Field label="Team names, one per line" hint="Each team gets the starter working agreement, Definition of Ready and Definition of Done, which students then adapt.">
        {(id, h) => <textarea id={id} aria-describedby={h} className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Team 1: Observatory\nTeam 2: Broadcast'} />}
      </Field>
      <div className="row wrap">
        <Button type="submit" variant="primary">
          Create teams
        </Button>
        <Button onClick={suggest}>Suggest four names</Button>
      </div>
    </form>
  );
}

function ClassSettingsForm({ cls, onSaved }: { cls: ClassDTO; onSaved(): void }) {
  const [name, setName] = useState(cls.name);
  const [requireGitlab, setRequireGitlab] = useState(cls.settings.requireGitlab);
  const [resources, setResources] = useState<ResourceLink[]>(cls.settings.resources);
  const [draft, setDraft] = useState<ResourceLink>({ title: '', url: '' });
  const run = useAction();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const list = draft.title.trim() && draft.url.trim() ? [...resources, { title: draft.title.trim(), url: draft.url.trim() }] : resources;
    if (await run(() => api('PATCH', `/api/classes/${cls.id}`, { name: name.trim(), settings: { requireGitlab, resources: list } }), 'Class settings saved')) {
      setResources(list);
      setDraft({ title: '', url: '' });
      onSaved();
    }
  };
  return (
    <form className="card stack" onSubmit={save} aria-labelledby="class-settings-h">
      <h2 id="class-settings-h">Settings</h2>
      <Field label="Class name">{(id) => <input id={id} className="input" required maxLength={LIMITS.teamName} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <label className="check">
        <input type="checkbox" checked={requireGitlab} onChange={(e) => setRequireGitlab(e.target.checked)} />
        <span>
          <strong>Students must sign in with GitLab to join a team</strong>
          <span className="hint block">Recommended if you use the activity log as evidence: it ties each action to a GitLab account rather than a typed name. Only affects people joining from now on.</span>
        </span>
      </label>
      <fieldset>
        <legend>Course resources</legend>
        <p className="hint">Links shown to every team in this class, for example your slides, the assessment brief or the module’s Learning Central page.</p>
        <ul className="plain-list">
          {resources.map((r, i) => (
            <li key={`${r.url}-${i}`} className="row between wrap">
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                {r.title}
              </a>
              <button type="button" className="icon-btn" aria-label={`Remove ${r.title}`} onClick={() => setResources(resources.filter((_, j) => j !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
        <div className="row wrap">
          <label className="field inline">
            <span>Title</span>
            <input className="input" maxLength={LIMITS.title} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field inline">
            <span>Link</span>
            <input className="input" type="url" maxLength={500} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" />
          </label>
        </div>
      </fieldset>
      <div>
        <Button type="submit" variant="primary">
          Save settings
        </Button>
      </div>
    </form>
  );
}

/** Opened from a teaching-staff link: adds the person to the class's staff. */
export function StaffJoinPage() {
  const { code = '' } = useParams();
  const { user, loading, ensureUser } = useMe();
  const [name, setName] = useState('');
  const run = useAction();
  const navigate = useNavigate();
  usePageTitle('Join as teaching staff');
  if (loading) return <div className="page narrow" aria-busy="true" />;
  const join = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(async () => {
      if (!user) await ensureUser(name.trim());
      return api<{ classId: string }>('POST', '/api/classes/join-staff', { code });
    });
    if (r) navigate(`/c/${r.classId}`, { replace: true });
  };
  return (
    <div className="page narrow">
      <form className="card stack" onSubmit={join}>
        <h1>Join a class as teaching staff</h1>
        <p className="muted">You will be able to see every team in the class, read-only, and download its activity. This link is meant for colleagues, not students.</p>
        {!user && <Field label="Your name">{(id) => <input id={id} className="input" required maxLength={LIMITS.displayName} value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
        <div>
          <Button type="submit" variant="primary">
            Join as teaching staff
          </Button>
        </div>
      </form>
    </div>
  );
}
