import { LIMITS, type ActionDTO } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Badge, Button, ConfirmButton, Empty, Field, InlineEdit, formatDate } from '../components/ui';
import { api } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';

export function ActionsPage() {
  const { snap, teamId } = useTeam();
  const [show, setShow] = useState<'open' | 'done'>('open');
  usePageTitle('Actions');
  const list = snap.actions.filter((a) => a.status === show);
  return (
    <div className="page stack">
      <h1>Actions and impediments</h1>
      <p className="muted">
        Improvement actions usually come from retrospectives; impediments come up in the Daily Scrum. Check the previous actions at the start of every retrospective.
      </p>
      <NewAction />
      <div className="segmented" role="group" aria-label="Show">
        <button type="button" aria-pressed={show === 'open'} onClick={() => setShow('open')}>
          Open ({snap.actions.filter((a) => a.status === 'open').length})
        </button>
        <button type="button" aria-pressed={show === 'done'} onClick={() => setShow('done')}>
          Done ({snap.actions.filter((a) => a.status === 'done').length})
        </button>
      </div>
      {list.length === 0 ? <Empty title={show === 'open' ? 'Nothing open' : 'Nothing done yet'} /> : <ActionList actions={list} teamId={teamId} />}
    </div>
  );
}

export function ActionList({ actions, teamId, compact }: { actions: ActionDTO[]; teamId: string; compact?: boolean }) {
  const { snap } = useTeam();
  const run = useAction();
  const meeting = (id: string | null) => snap.meetings.find((m) => m.id === id);
  const patch = (a: ActionDTO, body: Partial<ActionDTO>) => run(() => api('PATCH', `/api/teams/${teamId}/actions/${a.id}`, body));
  return (
    <ul className="action-list">
      {actions.map((a) => {
        const m = meeting(a.meetingId);
        const overdue = a.status === 'open' && a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10);
        return (
          <li key={a.id} className="action-row">
            <label className="check">
              <input type="checkbox" checked={a.status === 'done'} onChange={(e) => patch(a, { status: e.target.checked ? 'done' : 'open' })} aria-label={`Done: ${a.text}`} />
            </label>
            <div className="action-main">
              <div className={a.status === 'done' ? 'done-text' : ''}>
                {a.kind === 'impediment' && <Badge tone="bad">Impediment</Badge>} <InlineEdit label="Action" value={a.text} onSave={(v) => patch(a, { text: v })} />
              </div>
              {!compact && (
                <div className="row wrap small muted">
                  {m && (
                    <span>
                      From <Link to={`/t/${teamId}/m/${m.id}`}>{m.title}</Link>
                    </span>
                  )}
                  {a.completedAt && <span>Done {formatDate(a.completedAt)}</span>}
                  {overdue && <Badge tone="warn">Overdue</Badge>}
                </div>
              )}
            </div>
            <div className="row wrap">
              <label className="sr-only" htmlFor={`owner-${a.id}`}>
                Owner
              </label>
              <select id={`owner-${a.id}`} className="input input-small" value={a.ownerId ?? ''} onChange={(e) => patch(a, { ownerId: e.target.value || null })}>
                <option value="">No owner</option>
                {snap.team.members.map((mm) => (
                  <option key={mm.userId} value={mm.userId}>
                    {mm.displayName}
                  </option>
                ))}
              </select>
              {!compact && (
                <>
                  <label className="sr-only" htmlFor={`due-${a.id}`}>
                    Due date
                  </label>
                  <input id={`due-${a.id}`} type="date" className="input input-small" value={a.dueDate ?? ''} onChange={(e) => patch(a, { dueDate: e.target.value || null })} />
                  <ConfirmButton confirmLabel="Delete" onConfirm={() => run(() => api('DELETE', `/api/teams/${teamId}/actions/${a.id}`))}>
                    Delete
                  </ConfirmButton>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function NewAction({ meetingId, kind = 'action', label = 'Add an action' }: { meetingId?: string; kind?: ActionDTO['kind']; label?: string }) {
  const { snap, teamId } = useTeam();
  const run = useAction();
  const [text, setText] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [k, setK] = useState<ActionDTO['kind']>(kind);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await run(() => api('POST', `/api/teams/${teamId}/actions`, { text: text.trim(), ownerId: ownerId || null, dueDate: dueDate || null, kind: k, meetingId }));
    if (ok) {
      setText('');
      setDueDate('');
    }
  };
  return (
    <form onSubmit={submit} className="card new-action">
      <Field label={label} hint="Specific, owned and small enough to finish by the next retrospective.">
        {(id, h) => <input id={id} aria-describedby={h} className="input" value={text} maxLength={LIMITS.shortText} onChange={(e) => setText(e.target.value)} placeholder="e.g. Agree a review buddy for each merge request" />}
      </Field>
      <div className="row wrap align-end">
        <Field label="Owner">
          {(id) => (
            <select id={id} className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">No owner yet</option>
              {snap.team.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Due">{(id) => <input id={id} type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        {!meetingId && (
          <Field label="Type">
            {(id) => (
              <select id={id} className="input" value={k} onChange={(e) => setK(e.target.value as ActionDTO['kind'])}>
                <option value="action">Improvement action</option>
                <option value="impediment">Impediment</option>
              </select>
            )}
          </Field>
        )}
        <Button type="submit" variant="primary">
          Add
        </Button>
      </div>
    </form>
  );
}
