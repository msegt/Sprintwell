import { ACTIVITY_KIND_NAMES, type ActivityDTO, type ActivityKind } from '@sprintwell/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Icon, formatDate } from '../components/ui';
import { api, download } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';

interface Count {
  userId: string | null;
  kind: ActivityKind;
  n: number;
  last: string;
}

const AREAS = Object.keys(ACTIVITY_KIND_NAMES) as ActivityKind[];
const PAGE = 100;

function time(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Who did what in the team: for the team's own reflection and for teaching staff. */
export function ActivityPage() {
  const { snap, teamId, readOnly } = useTeam();
  const run = useAction();
  usePageTitle('Activity');
  const [person, setPerson] = useState('');
  const [area, setArea] = useState('');
  const [entries, setEntries] = useState<ActivityDTO[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [counts, setCounts] = useState<Count[]>([]);
  const [loading, setLoading] = useState(true);

  const query = useCallback(
    (before?: string) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (person) p.set('userId', person);
      if (area) p.set('kind', area);
      if (before) p.set('before', before);
      return p.toString();
    },
    [person, area],
  );

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      const r = await run(() => api<{ entries: ActivityDTO[]; names: Record<string, string> }>('GET', `/api/teams/${teamId}/activity?${query(before)}`));
      setLoading(false);
      if (!r) return;
      setNames((n) => ({ ...n, ...r.names }));
      setEntries((e) => (before ? [...e, ...r.entries] : r.entries));
      setMore(r.entries.length === PAGE);
    },
    [run, teamId, query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ counts: Count[]; names: Record<string, string> }>('GET', `/api/teams/${teamId}/activity/summary`).then(
      (r) => {
        setCounts(r.counts);
        setNames((n) => ({ ...n, ...r.names }));
      },
      () => undefined,
    );
  }, [teamId, snap]);

  const nameOf = (id: string | null) => (id ? (names[id] ?? snap.team.members.find((m) => m.userId === id)?.displayName ?? 'Former member') : 'Sprintwell');
  const usernameOf = (id: string | null) => snap.team.members.find((m) => m.userId === id)?.gitlabUsername ?? null;

  const people = useMemo(() => {
    const ids = new Set<string>([...snap.team.members.map((m) => m.userId), ...counts.map((c) => c.userId).filter((x): x is string => !!x)]);
    return [...ids];
  }, [snap.team.members, counts]);
  const usedAreas = AREAS.filter((a) => counts.some((c) => c.kind === a));

  return (
    <div className="page stack">
      <div className="row between wrap">
        <h1>Activity</h1>
        <Button onClick={() => run(() => download(`/api/teams/${teamId}/activity.csv?${query()}`, 'activity.csv'))}>
          <Icon name="download" /> Download CSV
        </Button>
      </div>
      <details className="howto">
        <summary>
          <Icon name="info" size={16} /> <span>What is recorded here</span>
        </summary>
        <div className="howto-body">
          <p className="guide-purpose">
            Sprintwell records what each person does in the team: writing and refining backlog items, taking part in events, facilitating, estimating, Daily Scrum updates, actions and risks
            {snap.team.classInfo ? ', and (once your team links its GitLab project) issues, merge requests, reviews and commits' : ''}.
          </p>
          <ul className="guide-tips">
            <li>Everyone in the team can see this log{snap.team.classInfo ? `, and so can the teaching staff of ${snap.team.classInfo.name}` : ''}.</li>
            <li>Hidden or anonymous contributions are never attributed: Planning Poker votes are logged without the value, and anonymous retrospective cards, dot votes and the safety check are not logged at all.</li>
            <li>It shows activity, not the quality or value of a contribution. Use it as evidence to support your own account of your work, not as a score.</li>
          </ul>
        </div>
      </details>

      <section className="card" aria-labelledby="summary-h">
        <h2 id="summary-h">Summary by person</h2>
        {counts.length === 0 ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <div className="table-scroll">
            <table className="table activity-summary">
              <caption className="sr-only">Number of recorded actions per person and area</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Total</th>
                  {usedAreas.map((a) => (
                    <th key={a} scope="col">
                      {ACTIVITY_KIND_NAMES[a]}
                    </th>
                  ))}
                  <th scope="col">Last active</th>
                </tr>
              </thead>
              <tbody>
                {people.map((id) => {
                  const mine = counts.filter((c) => c.userId === id);
                  const last = mine.reduce((a, c) => (c.last > a ? c.last : a), '');
                  const inTeam = snap.team.members.some((m) => m.userId === id);
                  return (
                    <tr key={id}>
                      <th scope="row">
                        {nameOf(id)}
                        {usernameOf(id) && <span className="muted small block">@{usernameOf(id)}</span>}
                        {!inTeam && <Badge>Left</Badge>}
                      </th>
                      <td>{mine.reduce((a, c) => a + c.n, 0)}</td>
                      {usedAreas.map((a) => (
                        <td key={a}>{mine.find((c) => c.kind === a)?.n ?? 0}</td>
                      ))}
                      <td>{last ? formatDate(last) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="log-h">
        <div className="row between wrap">
          <h2 id="log-h">Log</h2>
          <div className="row wrap">
            <label className="field inline">
              <span>Person</span>
              <select className="input" value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Everyone</option>
                {people.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>Area</span>
              <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">All areas</option>
                <option value="gitlab">Everything from GitLab</option>
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {ACTIVITY_KIND_NAMES[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {entries.length === 0 && !loading ? (
          <Empty title="No matching activity" />
        ) : (
          <ol className="activity-list" aria-busy={loading || undefined}>
            {entries.map((e) => (
              <li key={e.id}>
                <time dateTime={e.at} className="muted small">
                  {time(e.at)}
                </time>
                <span>
                  <strong>{nameOf(e.userId)}</strong> {e.summary}
                  {e.url && (
                    <>
                      {' '}
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="small">
                        View <Icon name="external" size={12} />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </>
                  )}
                </span>
                <span className="activity-area small">
                  {e.source === 'gitlab' && <Badge tone="info">GitLab</Badge>} {ACTIVITY_KIND_NAMES[e.kind] ?? e.kind}
                </span>
              </li>
            ))}
          </ol>
        )}
        {more && (
          <div>
            <Button onClick={() => load(entries[entries.length - 1]?.at)} busy={loading}>
              Show older activity
            </Button>
          </div>
        )}
      </section>
      {readOnly && <p className="small muted">Downloads include GitLab usernames, so you can match people to your module records.</p>}
    </div>
  );
}
