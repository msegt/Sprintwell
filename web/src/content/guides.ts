import type { MeetingKind } from '@sprintwell/shared';

/**
 * Short, practical guidance shown inside the app. Keep each step to one
 * sentence: people read this while the event is running.
 */
export interface Guide {
  title: string;
  /** One sentence on what this is for. */
  purpose: string;
  steps: string[];
  tips?: string[];
}

export type PageGuideId = 'overview' | 'backlog' | 'sprint' | 'events' | 'charter' | 'actions' | 'risks' | 'team';

export const PAGE_GUIDES: Record<PageGuideId, Guide> = {
  overview: {
    title: 'How to use Sprintwell as a team',
    purpose: 'This page shows your current sprint, events in progress and open actions. Start every Scrum event from here.',
    steps: [
      'Invite everyone with the link on the Team page.',
      'Agree your working agreement, Definition of Ready and Definition of Done on the Charter page.',
      'Write user stories in the Backlog and estimate them with Planning Poker.',
      'Run Sprint Planning to set a Sprint Goal and choose the stories for the sprint.',
      'Hold a Daily Scrum every day, a Sprint Review with your client at the end, then a Sprint Retrospective.',
    ],
    tips: ['Rotate the facilitator for each event so everyone practises running them.'],
  },
  backlog: {
    title: 'How to use the Product Backlog',
    purpose: 'The ordered list of everything the product might need. The top of the list is what you would do next.',
    steps: [
      'Choose New story and give it a short name, then write it as “As a… I want… so that…”.',
      'Add acceptance criteria: testable conditions such as “Given…, when…, then…”.',
      'Tick the INVEST checks honestly. If a story is not Small or Testable yet, refine or split it.',
      'Tick the Definition of Ready items. A story is Ready when all of them are ticked.',
      'Put the most valuable stories at the top with the up and down arrows.',
      'Select stories with the tick boxes, then choose Estimate with Planning Poker.',
    ],
    tips: [
      'Already have issues in GitLab? Use Import from GitLab, or Add several to paste titles.',
      'Estimates of 8 or more get a “consider splitting” hint (change the threshold on the Team page).',
    ],
  },
  sprint: {
    title: 'How to use the sprint board',
    purpose: 'Follow the Sprint Backlog from To do to Done and see whether you are on track for the Sprint Goal.',
    steps: [
      'Move stories between To do, In progress and Done with the status menu on each card.',
      'Only mark a story Done when it meets your Definition of Done.',
      'Check the burndown: if the remaining line sits well above the ideal one, talk about it at the Daily Scrum.',
      'Close the sprint at the end of the Sprint Review. Unfinished stories go back to the Product Backlog.',
    ],
    tips: ['Velocity (points finished per sprint) appears after your first sprint closes. Use it in Sprint Planning.'],
  },
  events: {
    title: 'Which event, when?',
    purpose: 'Every Scrum event has a purpose and a timebox. Start one here; everyone in the team can join from this page or the Overview.',
    steps: [
      'Sprint Planning starts the sprint: why it is valuable, what you can do, and how.',
      'The Daily Scrum is a 15-minute check on progress towards the Sprint Goal.',
      'The Sprint Review shows the increment to stakeholders (your client) and gathers feedback.',
      'The Sprint Retrospective closes the sprint: how can the team work better?',
      'Planning Poker and the pairing timer are practices you can use whenever you need them.',
    ],
    tips: ['Whoever starts an event becomes its facilitator. They can hand over from Manage.', 'On the last step, the facilitator chooses Finish event. Events left untouched for 6 hours finish on their own.', 'Finished events keep a summary you can download as Markdown, for example for your portfolio.'],
  },
  charter: {
    title: 'How to use the team charter',
    purpose: 'Your shared rules for working together. It is a living document: review it at every retrospective.',
    steps: [
      'Working agreement: how you communicate, make decisions, resolve conflict, review code and use Git.',
      'Definition of Ready: what a story needs before it can enter a sprint.',
      'Definition of Done: the quality bar every piece of work must meet.',
      'Click any item to edit it; use the arrows to reorder and the bin to remove.',
    ],
    tips: ['Starter items are only suggestions. Make them yours.', 'Use Print to keep a copy or to share it.'],
  },
  actions: {
    title: 'How to use actions and impediments',
    purpose: 'Improvement actions usually come from retrospectives; impediments are blockers raised at the Daily Scrum.',
    steps: [
      'Give every action an owner and, ideally, a due date.',
      'Tick an action when it is done.',
      'Check open actions at the start of every retrospective (the retrospective does this for you).',
    ],
    tips: ['Keep actions small and specific: “Agree a review buddy for each merge request” rather than “Communicate better”.'],
  },
  risks: {
    title: 'How to use the risk register',
    purpose: 'Spot what could go wrong early and agree how to reduce it.',
    steps: [
      'Choose Add risk and describe what could happen.',
      'Pick a category: legal, ethical, social, professional, security, technical or other.',
      'Rate likelihood and impact as Low, Medium or High. The heat map places it for you.',
      'Write a countermeasure that reduces the likelihood or the impact, and give it an owner.',
      'Update the status as things change, for example during Sprint Planning.',
    ],
    tips: ['Think beyond technical risks: personal data, accessibility, consent and client expectations are common ones.'],
  },
  team: {
    title: 'Managing the team',
    purpose: 'Invite people, manage who is an admin, change settings and download your data.',
    steps: [
      'Copy the invite link and share it with your team only.',
      'Admins can rename the team, change settings and remove members. Removing someone creates a new invite link.',
      'Use Export everything to keep a copy of your team’s data.',
    ],
  },
};

export const MEETING_GUIDES: Record<MeetingKind, Guide> = {
  poker: {
    title: 'How Planning Poker works',
    purpose: 'Estimate stories together, so that quiet voices count as much as loud ones.',
    steps: [
      'The facilitator adds stories: from the backlog, or typed in.',
      'Everyone picks a card at the same time. Nobody can see anyone else’s card yet.',
      'When everyone has voted, the facilitator chooses Reveal.',
      'If the estimates differ, the people with the lowest and highest cards explain their thinking first.',
      'Vote again if needed, then the facilitator saves the final estimate. It is written to the story.',
    ],
    tips: [
      'Estimate relative size and complexity, not hours.',
      '“?” means “I’m not sure”; “☕” means “I need a break”.',
      'Tick “I’m observing” if you are not part of the team that will do the work.',
    ],
  },
  retro: {
    title: 'How to run a retrospective',
    purpose: 'Look back on the sprint, learn without blaming, and agree one to three improvements.',
    steps: [
      'Check-in: read the Prime Directive, answer the question, and say anonymously how you feel about being here.',
      'Previous actions: did you do what you agreed last time?',
      'Reflect: everyone writes cards silently. Others can’t see them yet.',
      'Group: read all the cards together and group the similar ones.',
      'Vote: spend your dots on the topics you most want to discuss.',
      'Discuss: start with the most-voted topic, take notes, and agree actions with owners.',
      'Close: rate whether the retrospective was worth your time.',
    ],
    tips: [
      'For a two-week sprint, aim for 45–90 minutes. Use the suggested timer on each step.',
      'Vary the format from sprint to sprint so it doesn’t go stale.',
    ],
  },
  daily: {
    title: 'How to run the Daily Scrum',
    purpose: 'A 15-minute check on progress towards the Sprint Goal, and a plan for the next day.',
    steps: [
      'Before your turn, fill in Your update: yesterday, today and any impediment.',
      'The facilitator moves through the speaking order with Next person; each person has a short timer.',
      'If someone raises a blocker, record it as an impediment so it is not forgotten.',
      'Add longer conversations to “After the Daily Scrum”. Only the people who need them stay.',
    ],
    tips: ['Talk about the Sprint Goal, not about being busy.', 'Same time, same place, every working day.'],
  },
  planning: {
    title: 'How to run Sprint Planning',
    purpose: 'Agree why this sprint is valuable, what you can deliver, and how you will do it.',
    steps: [
      'Why: write a one-sentence Sprint Goal that you could explain to your client.',
      'What: set everyone’s availability, then add stories from the top of the backlog until you reach your capacity.',
      'How: break each story into tasks of a day or less.',
      'Confirm: check the plan and start the sprint.',
    ],
    tips: ['Don’t over-commit. Finishing fewer stories well beats leaving many half done.', 'Only take stories that meet your Definition of Ready.'],
  },
  review: {
    title: 'How to run the Sprint Review',
    purpose: 'Show the increment to stakeholders, hear their feedback and decide what comes next.',
    steps: [
      'Inspect the increment: demonstrate each finished story and tick it as you go. Be open about what was not finished.',
      'Record whether you met the Sprint Goal.',
      'Feedback: capture what stakeholders say; send useful points straight to the Product Backlog.',
      'Adapt: agree what matters next, then close the sprint.',
    ],
    tips: ['It is a working session, not a presentation: invite questions.', 'Hold the retrospective after the review.'],
  },
  pairing: {
    title: 'How to use the pairing timer',
    purpose: 'Share the keyboard fairly when pair or mob programming.',
    steps: [
      'Choose who is pairing and the style.',
      'Choose Start: the driver types, the navigator reviews and thinks ahead.',
      'When the timer ends, roles swap automatically (or choose Swap now).',
    ],
    tips: ['Short rotations (5–15 minutes) keep both people engaged.', 'In strong-style pairing, ideas must go through the other person’s hands.'],
  },
};

export interface PhaseHint {
  /** What the facilitator should do now. */
  facilitator: string;
  /** What everyone else should do now. */
  everyone: string;
  /** Suggested timebox for this step, in minutes. */
  minutes?: number;
}

export const PHASE_HINTS: Record<MeetingKind, Record<string, PhaseHint>> = {
  poker: {
    estimate: {
      facilitator: 'Select a story, wait until everyone has voted, then Reveal. Ask the lowest and highest to explain, then save the estimate.',
      everyone: 'Pick a card for the selected story. Nobody sees it until the facilitator reveals the votes.',
    },
    summary: {
      facilitator: 'Check that every story has an estimate, then end the session.',
      everyone: 'Here are the estimates. They have been saved to the backlog.',
    },
  },
  retro: {
    checkin: {
      facilitator: 'Read the Prime Directive aloud, then ask everyone to answer the check-in question.',
      everyone: 'Answer the check-in question and choose how you feel about being here. That choice is anonymous.',
      minutes: 5,
    },
    review: {
      facilitator: 'Go through the open actions. Tick the ones that are done and ask why any others are not.',
      everyone: 'Did we do what we agreed last time? Tick anything that is done.',
      minutes: 5,
    },
    reflect: {
      facilitator: 'Start the timer and write your own cards too. Move on when most people have stopped writing.',
      everyone: 'Write one idea per card in any column. Others can’t see your cards yet.',
      minutes: 7,
    },
    group: {
      facilitator: 'Read the cards aloud and ask the team to group similar ones. Rename groups so the topic is clear.',
      everyone: 'Read everyone’s cards. Use “Group with…” to put similar cards together.',
      minutes: 7,
    },
    vote: {
      facilitator: 'Wait until most people have used their votes, then move on to Discuss.',
      everyone: 'Use your votes on the topics you most want to discuss. You can put several on one topic.',
      minutes: 3,
    },
    discuss: {
      facilitator: 'Pick the top topic, timebox the discussion, and make sure each topic ends with an action or a decision.',
      everyone: 'Discuss the selected topic. Agree specific actions with owners.',
      minutes: 25,
    },
    close: {
      facilitator: 'Ask everyone to rate the retrospective, read out the actions, then end it.',
      everyone: 'Was this worth your time? Rate it from 1 to 5 (anonymous).',
      minutes: 3,
    },
  },
  daily: {
    updates: {
      facilitator: 'Go through the speakers with Next person. Keep it to the Sprint Goal and park longer discussions.',
      everyone: 'Fill in your update before your turn. When it is your turn, talk about progress towards the Sprint Goal.',
      minutes: 15,
    },
    parking: {
      facilitator: 'Go through the parked topics with only the people who need them, then choose Finish event.',
      everyone: 'Stay only for the topics you are needed for.',
    },
  },
  planning: {
    why: {
      facilitator: 'Ask: why is this sprint valuable? Write one sentence the client would understand.',
      everyone: 'Help write the Sprint Goal: one sentence about value, not a list of tasks.',
      minutes: 15,
    },
    what: {
      facilitator: 'Check everyone’s availability, then add stories from the top of the backlog until you reach your capacity.',
      everyone: 'Update your days and focus. Speak up if a story is not Ready or the plan feels too big.',
      minutes: 30,
    },
    how: {
      facilitator: 'Ask the team to break each story into tasks of a day or less.',
      everyone: 'Add the tasks needed for each story. Owners are optional.',
      minutes: 30,
    },
    commit: {
      facilitator: 'Read back the Sprint Goal and plan. If the team agrees, start the sprint.',
      everyone: 'Does the plan feel achievable? Say so now if not.',
      minutes: 5,
    },
  },
  review: {
    increment: {
      facilitator: 'Demonstrate each finished story and tick it. Then record whether the Sprint Goal was met.',
      everyone: 'Show the work you finished. Only work that meets the Definition of Done counts.',
      minutes: 20,
    },
    feedback: {
      facilitator: 'Ask stakeholders what they think and capture every point. Send useful ideas to the backlog.',
      everyone: 'Listen and capture feedback. Ask clarifying questions rather than defending the work.',
      minutes: 20,
    },
    adapt: {
      facilitator: 'Agree what matters most next, then close the sprint. Next: the retrospective.',
      everyone: 'What should the next sprint focus on?',
      minutes: 10,
    },
  },
  pairing: {
    pairing: {
      facilitator: 'Choose who is pairing and the style, then Start. Roles swap when the timer ends.',
      everyone: 'Driver types, navigator reviews and thinks ahead. Swap when the timer ends.',
    },
  },
};
