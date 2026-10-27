import { INVEST, LIMITS, investScore, isReady, points, shouldSplit, storySentence, type StoryDTO } from '@sprintwell/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { HowTo } from '../components/Guide';
import { NewMeetingDialog } from '../components/NewMeeting';
import { PAGE_GUIDES } from '../content/guides';
import { StoryEditor } from '../components/StoryEditor';
import { Badge, Button, Empty, Field, Icon, Modal } from '../components/ui';
import { api, download } from '../lib/api';
import { useAction, useNotice, usePageTitle, useTeam } from '../lib/hooks';

type Filter = 'backlog' | 'all' | 'done';

export function BacklogPage() {
  const { snap, teamId } = useTeam();
  const run = useAction();
  const [filter, setFilter] = useState<Filter>('backlog');
  const [editing, setEditing] = useState<StoryDTO | 'new' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [gitlabOpen, setGitlabOpen] = useState(false);
  const [pokerOpen, setPokerOpen] = useState(false);
  usePageTitle('Product Backlog');

  const target = snap.sprints.find((s) => s.status === 'planned') ?? snap.sprints.find((s) => s.status === 'active');
  const stories = useMemo(() => {
    const all = [...snap.stories].sort((a, b) => a.position - b.position);
    if (filter === 'backlog') return all.filter((s) => !s.sprintId && s.status !== 'done');
    if (filter === 'done') return all.filter((s) => s.status === 'done');
    return all;
  }, [snap.stories, filter]);
  const backlogOrder = snap.stories.filter((s) => !s.sprintId && s.status !== 'done').sort((a, b) => a.position - b.position);

  const move = async (story: StoryDTO, delta: -1 | 1) => {
    const ids = backlogOrder.map((s) => s.id);
    const i = ids.indexOf(story.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await run(() => api('POST', `/api/teams/${teamId}/stories/reorder`, { ids }));
  };

  const sprintName = (id: string | null) => snap.sprints.find((s) => s.id === id)?.name;

  return (
    <div className="page stack">
      <div className="row between wrap">
        <div>
          <h1>Product Backlog</h1>
          <p className="muted small">
            Ordered by priority. {backlogOrder.length} stories, {points(backlogOrder)} points estimated.
          </p>
        </div>
        <div className="row wrap">
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> New story
          </Button>
          <Button onClick={() => setBulkOpen(true)}>Add several</Button>
          <Button onClick={() => setGitlabOpen(true)}>Import from GitLab</Button>
          <Button onClick={() => run(() => download(`/api/teams/${teamId}/stories.csv`, 'stories.csv'))}>
            <Icon name="download" /> CSV
          </Button>
        </div>
      </div>

      <HowTo id="backlog" guide={PAGE_GUIDES.backlog} />

      <div className="row between wrap">
        <div className="segmented" role="group" aria-label="Show">
          {(['backlog', 'all', 'done'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'backlog' ? 'Product Backlog' : f === 'all' ? 'All stories' : 'Done'}
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="row wrap" role="group" aria-label="With selected stories">
            <span className="small">{selected.length} selected</span>
            <Button small variant="primary" onClick={() => setPokerOpen(true)}>
              Estimate with Planning Poker
            </Button>
            {target && (
              <Button
                small
                onClick={async () => {
                  for (const id of selected) await api('PATCH', `/api/teams/${teamId}/stories/${id}`, { sprintId: target.id, status: 'todo' }).catch(() => undefined);
                  setSelected([]);
                }}
              >
                Add to {target.name}
              </Button>
            )}
            <Button small variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {stories.length === 0 ? (
        <Empty title={filter === 'done' ? 'Nothing done yet' : 'No stories here yet'}>
          Write user stories as “As a… I want… so that…”, with acceptance criteria, or import them from your issue tracker.
        </Empty>
      ) : (
        <ol className="story-list">
          {stories.map((s) => {
            const ready = isReady(s, snap.charter);
            const inBacklog = backlogOrder.includes(s);
            return (
              <li key={s.id} className="story-row">
                <input type="checkbox" aria-label={`Select ${s.title}`} checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                <div className="story-row-main">
                  <button type="button" className="link-btn story-title" onClick={() => setEditing(s)}>
                    {s.title}
                  </button>
                  {storySentence(s) && <p className="small muted">{storySentence(s)}</p>}
                  <div className="row wrap small">
                    {s.estimate ? <Badge tone={shouldSplit(s.estimate, snap.team.settings.splitThreshold) ? 'warn' : 'info'}>{s.estimate} pts</Badge> : <Badge>Not estimated</Badge>}
                    {ready ? <Badge tone="good">Ready</Badge> : null}
                    <span className="muted" title={INVEST.map((i) => `${i.name}: ${s.invest[i.key] ? 'yes' : 'not yet'}`).join('\n')}>
                      INVEST {investScore(s)}/6
                    </span>
                    <span className="muted">
                      {s.acceptanceCriteria.length} criteri{s.acceptanceCriteria.length === 1 ? 'on' : 'a'}
                    </span>
                    {s.sprintId && <span className="muted">· {sprintName(s.sprintId)}</span>}
                    {s.status === 'done' && <Badge tone="good">Done</Badge>}
                    {s.externalUrl && (
                      <a href={s.externalUrl} target="_blank" rel="noopener noreferrer" className="small">
                        Issue <Icon name="external" size={12} />
                      </a>
                    )}
                  </div>
                </div>
                {inBacklog && filter === 'backlog' && (
                  <div className="reorder">
                    <button type="button" className="icon-btn" aria-label={`Move ${s.title} up`} onClick={() => move(s, -1)} disabled={backlogOrder[0] === s}>
                      <Icon name="up" size={16} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Move ${s.title} down`} onClick={() => move(s, 1)} disabled={backlogOrder[backlogOrder.length - 1] === s}>
                      <Icon name="down" size={16} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editing && <StoryEditor story={editing === 'new' ? null : (snap.stories.find((s) => s.id === editing.id) ?? editing)} onClose={() => setEditing(null)} />}
      <BulkAdd open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <GitLabImport open={gitlabOpen} onClose={() => setGitlabOpen(false)} />
      <NewMeetingDialog kind="poker" open={pokerOpen} onClose={() => setPokerOpen(false)} presetStoryIds={selected} />
    </div>
  );
}

function BulkAdd({ open, onClose }: { open: boolean; onClose(): void }) {
  const { teamId } = useTeam();
  const run = useAction();
  const [text, setText] = useState('');
  const lines = text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .slice(0, 200);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ created: number }>('POST', `/api/teams/${teamId}/stories/bulk`, { stories: lines.map((title) => ({ title: title.slice(0, LIMITS.title) })) }));
    if (r) {
      setText('');
      onClose();
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add several stories">
      <form onSubmit={submit} className="stack">
        <Field label="One story per line" hint="Useful for a backlog brainstorm. Add details to each story afterwards.">
          {(id, h) => <textarea id={id} aria-describedby={h} className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="row end">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={lines.length === 0}>
            Add {lines.length || ''} {lines.length === 1 ? 'story' : 'stories'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  weight?: number | null;
}

/**
 * Imports open issues straight from the browser, so the GitLab token never
 * reaches the Sprintwell server and VPN-only GitLab instances still work.
 */
function GitLabImport({ open, onClose }: { open: boolean; onClose(): void }) {
  const { snap, teamId } = useTeam();
  const { notify } = useNotice();
  const tracker = snap.team.settings.trackerUrl;
  const guess = /^(https?:\/\/[^/]+)\/(.+?)(?:\/-\/.*)?$/.exec(tracker);
  const [base, setBase] = useState(guess?.[1] ?? 'https://gitlab.com');
  const [project, setProject] = useState(guess?.[2] ?? '');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [issues, setIssues] = useState<GitLabIssue[] | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = new Set(snap.stories.map((s) => s.externalUrl).filter(Boolean));

  const fetchIssues = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let path = project.trim();
      const m = /^https?:\/\/[^/]+\/(.+?)(?:\/-\/.*)?$/.exec(path);
      if (m) path = m[1]!;
      path = path.replace(/^\/|\/$/g, '');
      const params = new URLSearchParams({ state: 'opened', per_page: '100', order_by: 'relative_position' });
      if (label.trim()) params.set('labels', label.trim());
      const res = await fetch(`${base.replace(/\/$/, '')}/api/v4/projects/${encodeURIComponent(path)}/issues?${params}`, {
        headers: token ? { 'PRIVATE-TOKEN': token } : {},
      });
      if (res.status === 401 || res.status === 404) throw new Error('GitLab did not find that project. Check the path, and add an access token for private projects.');
      if (!res.ok) throw new Error(`GitLab answered with an error (${res.status}).`);
      const list = (await res.json()) as GitLabIssue[];
      setIssues(list);
      setChosen(list.filter((i) => !existing.has(i.web_url)).map((i) => i.iid));
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Could not reach GitLab from this browser. Your GitLab server may need a VPN, or may block requests from other sites. You can still use “Add several” to paste issue titles.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const importChosen = async () => {
    const list = (issues ?? []).filter((i) => chosen.includes(i.iid));
    if (!list.length) return;
    setBusy(true);
    try {
      await api('POST', `/api/teams/${teamId}/stories/bulk`, {
        stories: list.map((i) => ({
          title: i.title.slice(0, LIMITS.title),
          notes: (i.description ?? '').slice(0, LIMITS.longText),
          externalUrl: i.web_url,
          estimate: i.weight ? String(i.weight) : null,
        })),
      });
      notify(`Imported ${list.length} ${list.length === 1 ? 'issue' : 'issues'}`, 'success');
      setIssues(null);
      onClose();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import issues from GitLab" wide>
      {!issues ? (
        <form onSubmit={fetchIssues} className="stack">
          <p className="muted small">
            Sprintwell reads open issues directly from your browser. Your access token is used once for this request and is never sent to or stored by Sprintwell. Use a token with only the{' '}
            <code>read_api</code> scope.
          </p>
          <Field label="GitLab address">{(id) => <input id={id} className="input" type="url" required value={base} onChange={(e) => setBase(e.target.value)} />}</Field>
          <Field label="Project path or URL" hint="For example group/project or the project’s web address.">
            {(id, h) => <input id={id} aria-describedby={h} className="input" required value={project} onChange={(e) => setProject(e.target.value)} />}
          </Field>
          <Field label="Access token (private projects only)">
            {(id) => <input id={id} className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />}
          </Field>
          <Field label="Only issues with label (optional)">{(id) => <input id={id} className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="user story" />}</Field>
          {error && (
            <p className="callout warn" role="alert">
              {error}
            </p>
          )}
          <div className="row end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Find issues
            </Button>
          </div>
        </form>
      ) : (
        <div className="stack">
          {issues.length === 0 ? (
            <p>No open issues found.</p>
          ) : (
            <div className="check-list tall">
              {issues.map((i) => (
                <label key={i.iid} className="check">
                  <input type="checkbox" checked={chosen.includes(i.iid)} onChange={(e) => setChosen(e.target.checked ? [...chosen, i.iid] : chosen.filter((x) => x !== i.iid))} />#{i.iid} {i.title}
                  {i.weight ? <span className="muted small"> (weight {i.weight})</span> : null}
                  {existing.has(i.web_url) && <span className="muted small"> · already imported</span>}
                </label>
              ))}
            </div>
          )}
          <div className="row end">
            <Button onClick={() => setIssues(null)}>Back</Button>
            <Button variant="primary" busy={busy} disabled={chosen.length === 0} onClick={importChosen}>
              Import {chosen.length} {chosen.length === 1 ? 'issue' : 'issues'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
