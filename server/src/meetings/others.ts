import {
  type CapacityRow,
  type DailyUpdate,
  type DailyView,
  type PairingMode,
  type PairingView,
  type PlanningView,
  type ReviewFeedback,
  type ReviewView,
} from '@sprintwell/shared';
import {
  dailyCommand,
  pairingCommand,
  planningCommand,
  reviewCommand,
  type DailyCommand,
  type PairingCommand,
  type PlanningCommand,
  type ReviewCommand,
} from '@sprintwell/shared/schemas';
import { newId } from '../util';
import { MeetingError, md, shuffle, type Engine } from './engine';

// ============================================================================
// Daily Scrum
// ============================================================================

export interface DailyState {
  order: string[];
  current: number;
  perPersonSeconds: number;
  updates: Record<string, DailyUpdate>;
  parking: { id: string; text: string; authorId: string }[];
  done: string[];
}

export const dailyEngine: Engine<DailyState, DailyCommand, DailyView> = {
  kind: 'daily',
  schema: dailyCommand,
  facilitatorOnly: new Set(['next', 'prev', 'setSpeaker', 'shuffle', 'setPerPerson']),
  defaultTitle: () => `Daily Scrum, ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`,
  create(input) {
    const seconds = Number(input.options.perPersonSeconds);
    return {
      state: {
        order: shuffle(input.members.map((m) => m.userId)),
        current: 0,
        perPersonSeconds: Number.isFinite(seconds) && seconds >= 15 && seconds <= 600 ? Math.round(seconds) : 90,
        updates: {},
        parking: [],
        done: [],
      },
    };
  },
  apply(ctx, cmd) {
    const s = ctx.state;
    const addMissing = () => {
      for (const m of ctx.members) if (!s.order.includes(m.userId)) s.order.push(m.userId);
    };
    switch (cmd.type) {
      case 'setUpdate':
        s.updates[ctx.actorId] = { yesterday: cmd.yesterday, today: cmd.today, blockers: cmd.blockers };
        if (!s.order.includes(ctx.actorId)) s.order.push(ctx.actorId);
        break;
      case 'next': {
        addMissing();
        const speaker = s.order[s.current];
        if (speaker && !s.done.includes(speaker)) s.done.push(speaker);
        s.current = Math.min(s.current + 1, s.order.length);
        if (s.current < s.order.length) ctx.startTimer(s.perPersonSeconds);
        else ctx.stopTimer();
        break;
      }
      case 'prev':
        s.current = Math.max(0, s.current - 1);
        ctx.startTimer(s.perPersonSeconds);
        break;
      case 'setSpeaker':
        addMissing();
        if (cmd.index >= s.order.length) throw new MeetingError('Nobody is at that position.');
        s.current = cmd.index;
        ctx.startTimer(s.perPersonSeconds);
        break;
      case 'shuffle': {
        addMissing();
        // Keep people who already spoke at the front, shuffle the rest.
        const spoken = s.order.filter((id) => s.done.includes(id));
        const rest = shuffle(s.order.filter((id) => !s.done.includes(id)));
        s.order = [...spoken, ...rest];
        s.current = spoken.length;
        break;
      }
      case 'setPerPerson':
        s.perPersonSeconds = cmd.seconds;
        break;
      case 'addParking':
        if (s.parking.length >= 50) throw new MeetingError('The list is full.');
        s.parking.push({ id: newId(), text: cmd.text, authorId: ctx.actorId });
        break;
      case 'removeParking': {
        const item = s.parking.find((p) => p.id === cmd.itemId);
        if (!item) throw new MeetingError('Item not found.');
        if (item.authorId !== ctx.actorId && !ctx.isFacilitator) throw new MeetingError('Only the author or the facilitator can remove that.');
        s.parking = s.parking.filter((p) => p.id !== cmd.itemId);
        break;
      }
    }
  },
  view: (s) => ({ order: s.order, current: s.current, perPersonSeconds: s.perPersonSeconds, updates: s.updates, parking: s.parking, done: s.done }),
  summary(s, _m, names) {
    const out = ['| Developer | Yesterday | Today | Blockers |', '|---|---|---|---|'];
    for (const id of s.order) {
      const u = s.updates[id];
      if (!u && !s.done.includes(id)) continue;
      out.push(`| ${md(names(id))} | ${md(u?.yesterday ?? '')} | ${md(u?.today ?? '')} | ${md(u?.blockers ?? '')} |`);
    }
    if (s.parking.length) {
      out.push('', '### After the Daily Scrum', '');
      for (const p of s.parking) out.push(`- ${md(p.text)} (${md(names(p.authorId))})`);
    }
    return out.join('\n');
  },
};

// ============================================================================
// Sprint Planning (stories, goal and tasks live in team data; this keeps capacity)
// ============================================================================

export interface PlanningState {
  capacity: CapacityRow[];
  notes: string;
}

export const planningEngine: Engine<PlanningState, PlanningCommand, PlanningView> = {
  kind: 'planning',
  schema: planningCommand,
  facilitatorOnly: new Set([]),
  async defaultTitle(input) {
    if (input.sprintId) return `Sprint Planning: ${(await input.repo.sprint(input.teamId, input.sprintId)).name}`;
    return 'Sprint Planning';
  },
  async create(input) {
    let sprintId = input.sprintId;
    if (!sprintId) {
      // Default dates: the sprint starts today and lasts the team's usual sprint length.
      const start = new Date();
      const end = new Date(start.getTime() + (input.settings.sprintLengthDays - 1) * 86_400_000);
      const sprint = await input.repo.createSprint(input.teamId, {
        name: await input.repo.nextSprintName(input.teamId),
        goal: '',
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      });
      sprintId = sprint.id;
    }
    const sprint = await input.repo.sprint(input.teamId, sprintId);
    const workingDays = Math.max(1, Math.round((input.settings.sprintLengthDays * 5) / 7));
    const capacity =
      sprint.capacity.length > 0
        ? sprint.capacity
        : input.members.map((m) => ({ userId: m.userId, daysAvailable: workingDays, hoursPerDay: 6, focusPercent: 100 }));
    await input.repo.updateSprint(input.teamId, sprintId, { capacity });
    return { state: { capacity, notes: '' }, sprintId };
  },
  async apply(ctx, cmd) {
    const s = ctx.state;
    switch (cmd.type) {
      case 'setCapacity': {
        if (!ctx.members.some((m) => m.userId === cmd.row.userId)) throw new MeetingError('That person is not in the team.');
        const i = s.capacity.findIndex((r) => r.userId === cmd.row.userId);
        if (i >= 0) s.capacity[i] = cmd.row;
        else s.capacity.push(cmd.row);
        if (ctx.meeting.sprintId) {
          await ctx.repo.updateSprint(ctx.meeting.teamId, ctx.meeting.sprintId, { capacity: s.capacity });
          ctx.touchTeam();
        }
        break;
      }
      case 'setNotes':
        s.notes = cmd.notes;
        break;
    }
  },
  view: (s) => ({ capacity: s.capacity, notes: s.notes }),
  summary(s, _m, names) {
    const out = ['| Developer | Days | Hours/day | Focus | Hours |', '|---|---|---|---|---|'];
    for (const r of s.capacity) {
      out.push(`| ${md(names(r.userId))} | ${r.daysAvailable} | ${r.hoursPerDay} | ${r.focusPercent}% | ${Math.round(r.daysAvailable * r.hoursPerDay * r.focusPercent) / 100} |`);
    }
    if (s.notes) out.push('', '### Notes', '', md(s.notes));
    return out.join('\n');
  },
};

// ============================================================================
// Sprint Review
// ============================================================================

export interface ReviewState {
  demoed: string[];
  feedback: ReviewFeedback[];
  notes: string;
}

export const reviewEngine: Engine<ReviewState, ReviewCommand, ReviewView> = {
  kind: 'review',
  schema: reviewCommand,
  facilitatorOnly: new Set([]),
  async defaultTitle(input) {
    if (input.sprintId) return `Sprint Review: ${(await input.repo.sprint(input.teamId, input.sprintId)).name}`;
    return 'Sprint Review';
  },
  async create(input) {
    if (input.sprintId) await input.repo.sprint(input.teamId, input.sprintId);
    return { state: { demoed: [], feedback: [], notes: '' } };
  },
  async apply(ctx, cmd) {
    const s = ctx.state;
    switch (cmd.type) {
      case 'setDemoed':
        s.demoed = s.demoed.filter((id) => id !== cmd.storyId);
        if (cmd.demoed) {
          await ctx.repo.story(ctx.meeting.teamId, cmd.storyId).catch(() => {
            throw new MeetingError('Story not found.');
          });
          if (s.demoed.length >= 500) throw new MeetingError('Too many stories.');
          s.demoed.push(cmd.storyId);
        }
        break;
      case 'addFeedback':
        if (s.feedback.length >= 200) throw new MeetingError('The feedback list is full.');
        if (cmd.storyId) {
          await ctx.repo.story(ctx.meeting.teamId, cmd.storyId).catch(() => {
            throw new MeetingError('Story not found.');
          });
        }
        s.feedback.push({ id: newId(), text: cmd.text, from: cmd.from, storyId: cmd.storyId, backlogStoryId: null });
        break;
      case 'removeFeedback':
        s.feedback = s.feedback.filter((f) => f.id !== cmd.feedbackId);
        break;
      case 'markFeedbackAdded': {
        const f = s.feedback.find((x) => x.id === cmd.feedbackId);
        if (!f) throw new MeetingError('Feedback not found.');
        await ctx.repo.story(ctx.meeting.teamId, cmd.storyId).catch(() => {
          throw new MeetingError('Story not found.');
        });
        f.backlogStoryId = cmd.storyId;
        break;
      }
      case 'setNotes':
        s.notes = cmd.notes;
        break;
    }
  },
  view: (s) => ({ demoed: s.demoed, feedback: s.feedback, notes: s.notes }),
  summary(s) {
    const out: string[] = [];
    if (s.feedback.length) {
      out.push('### Feedback', '');
      for (const f of s.feedback) out.push(`- ${md(f.text)}${f.from ? ` (${md(f.from)})` : ''}${f.backlogStoryId ? ' → added to the Product Backlog' : ''}`);
    }
    if (s.notes) out.push('', '### Notes', '', md(s.notes));
    out.push('', `Stories demonstrated: ${s.demoed.length}`);
    return out.join('\n');
  },
};

// ============================================================================
// Pairing / mob timer
// ============================================================================

export interface PairingState {
  mode: PairingMode;
  participants: string[];
  driverIndex: number;
  intervalSeconds: number;
  rotations: number;
  autoRotate: boolean;
}

function rotate(s: PairingState): void {
  if (s.participants.length === 0) return;
  s.driverIndex = (s.driverIndex + 1) % s.participants.length;
  s.rotations += 1;
}

export const pairingEngine: Engine<PairingState, PairingCommand, PairingView> = {
  kind: 'pairing',
  schema: pairingCommand,
  facilitatorOnly: new Set([]),
  defaultTitle: () => 'Pairing session',
  create(input) {
    const requested = Array.isArray(input.options.participants)
      ? input.options.participants.filter((id): id is string => typeof id === 'string' && input.members.some((m) => m.userId === id))
      : [];
    return {
      state: {
        mode: 'driver-navigator',
        participants: requested.length ? requested : [input.actorId],
        driverIndex: 0,
        intervalSeconds: 10 * 60,
        rotations: 0,
        autoRotate: true,
      },
    };
  },
  apply(ctx, cmd) {
    const s = ctx.state;
    switch (cmd.type) {
      case 'setParticipants': {
        const valid = cmd.participants.filter((id) => ctx.members.some((m) => m.userId === id));
        if (valid.length === 0) throw new MeetingError('Choose at least one team member.');
        const driver = s.participants[s.driverIndex];
        s.participants = [...new Set(valid)];
        s.driverIndex = Math.max(0, driver ? s.participants.indexOf(driver) : 0);
        break;
      }
      case 'setMode':
        s.mode = cmd.mode;
        break;
      case 'setInterval':
        s.intervalSeconds = cmd.seconds;
        break;
      case 'rotate':
        rotate(s);
        if (ctx.meeting.timer.endsAt) ctx.startTimer(s.intervalSeconds);
        break;
      case 'setAutoRotate':
        s.autoRotate = cmd.autoRotate;
        break;
      case 'startRotation':
        ctx.startTimer(s.intervalSeconds);
        break;
    }
  },
  onTimerEnd(ctx) {
    if (!ctx.state.autoRotate) return false;
    rotate(ctx.state);
    ctx.startTimer(ctx.state.intervalSeconds);
    return true;
  },
  view: (s) => ({ ...s }),
  summary(s, _m, names) {
    return `Mode: ${s.mode}. Participants: ${s.participants.map((p) => md(names(p))).join(', ')}. Rotations: ${s.rotations}.`;
  },
};
