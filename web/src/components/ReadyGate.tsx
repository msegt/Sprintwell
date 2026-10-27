import { readinessProblems, type ReadinessProblem, type SprintDTO, type StoryDTO } from '@sprintwell/shared';
import '../styles/ready.css';
import { useCallback, useState, type ReactNode } from 'react';
import { ApiError, api } from '../lib/api';
import { useNotice, useTeam } from '../lib/hooks';
import { StoryEditor } from './StoryEditor';
import { Button, Icon, Modal } from './ui';

interface NotReady {
  story: StoryDTO;
  problems: ReadinessProblem[];
}

/**
 * Moves items into a sprint only when they are ready. Items that are not ready
 * stay in the Product Backlog and a dialog explains what is missing, with a
 * shortcut to fix each one. The server enforces the same rule.
 */
export function useReadyGate(): { addToSprint(stories: StoryDTO[], sprint: SprintDTO): Promise<number>; problems(story: StoryDTO): ReadinessProblem[]; dialog: ReactNode } {
  const { snap, teamId } = useTeam();
  const { notify } = useNotice();
  const [blocked, setBlocked] = useState<{ sprint: SprintDTO; items: NotReady[] } | null>(null);
  const [fixing, setFixing] = useState<StoryDTO | null>(null);
  const enforce = snap.team.settings.enforceReady;

  const problems = useCallback((story: StoryDTO) => (enforce ? readinessProblems(story, snap.charter) : []), [enforce, snap.charter]);

  const addToSprint = useCallback(
    async (stories: StoryDTO[], sprint: SprintDTO) => {
      const notReady = stories.map((story) => ({ story, problems: problems(story) })).filter((x) => x.problems.length > 0);
      let added = 0;
      for (const s of stories.filter((st) => !notReady.some((n) => n.story.id === st.id))) {
        try {
          await api('PATCH', `/api/teams/${teamId}/stories/${s.id}`, { sprintId: sprint.id, status: 'todo' });
          added++;
        } catch (e) {
          // The server is the final judge (e.g. someone changed the Definition of Ready meanwhile).
          const details = e instanceof ApiError ? (e.details as { code?: string; items?: { problems: ReadinessProblem[] }[] } | undefined) : undefined;
          if (details?.code === 'not_ready') notReady.push({ story: s, problems: details.items?.[0]?.problems ?? [] });
          else notify((e as Error).message, 'error');
        }
      }
      if (added) notify(`${added} item${added === 1 ? '' : 's'} added to ${sprint.name}`, 'success');
      if (notReady.length) setBlocked({ sprint, items: notReady });
      return added;
    },
    [problems, teamId, notify],
  );

  const current = blocked?.items.filter((x) => {
    const fresh = snap.stories.find((s) => s.id === x.story.id);
    return fresh && fresh.sprintId !== blocked.sprint.id;
  });

  const dialog = (
    <>
      <Modal open={!!blocked && !fixing} onClose={() => setBlocked(null)} title="Not ready for the sprint yet" instant>
        <p>
          Only items that meet your <strong>Definition of Ready</strong> can go into a sprint. User stories also need the “As a… I want… so that…” format, acceptance criteria and an INVEST check. These stayed in the Product Backlog:
        </p>
        <ul className="not-ready-list">
          {(current ?? []).map(({ story, problems: list }) => {
            const fresh = snap.stories.find((s) => s.id === story.id) ?? story;
            const now = readinessProblems(fresh, snap.charter);
            return (
              <li key={story.id}>
                <div className="row between wrap">
                  <strong>{fresh.title}</strong>
                  <span className="row">
                    {now.length === 0 && blocked ? (
                      <Button small variant="primary" onClick={() => void addToSprint([fresh], blocked.sprint)}>
                        <Icon name="check" size={14} /> Ready now: add to {blocked.sprint.name}
                      </Button>
                    ) : (
                      <Button small onClick={() => setFixing(fresh)}>
                        <Icon name="edit" size={14} /> Fix this item
                      </Button>
                    )}
                  </span>
                </div>
                <ul className="small">
                  {(now.length ? now : list).map((p) => (
                    <li key={p.code}>{p.message}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
        <p className="small muted">During Sprint Planning you can refine items here and add them once they are ready. The checks only see what your team ticked and wrote: be honest with them.</p>
        <div className="row end">
          <Button onClick={() => setBlocked(null)}>Close</Button>
        </div>
      </Modal>
      {fixing && <StoryEditor story={snap.stories.find((s) => s.id === fixing.id) ?? fixing} onClose={() => setFixing(null)} />}
    </>
  );

  return { addToSprint, problems, dialog };
}
