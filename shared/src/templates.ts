export interface RetroColumn {
  id: string;
  title: string;
  prompt: string;
  /** Colour token name used by the web client (never the only cue: titles are always shown). */
  tone: 'green' | 'red' | 'blue' | 'amber' | 'purple' | 'teal' | 'grey';
}

export interface RetroTemplate {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  columns: RetroColumn[];
}

export const RETRO_TEMPLATES: RetroTemplate[] = [
  {
    id: 'start-stop-continue',
    name: 'Start, Stop, Continue',
    description: 'Three simple questions that lead straight to actions.',
    whenToUse: 'A first retrospective, or any time you want quick, action-focused outcomes.',
    columns: [
      { id: 'start', title: 'Start', prompt: 'What are we not doing that we should start doing?', tone: 'green' },
      { id: 'stop', title: 'Stop', prompt: 'What is not working that we should stop doing?', tone: 'red' },
      { id: 'continue', title: 'Continue', prompt: 'What went well that we should keep doing?', tone: 'blue' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad, Sad, Glad',
    description: 'Surfaces how the sprint felt, not only what happened.',
    whenToUse: 'When emotions are running high or morale needs attention.',
    columns: [
      { id: 'mad', title: 'Mad', prompt: 'What frustrated or annoyed you?', tone: 'red' },
      { id: 'sad', title: 'Sad', prompt: 'What disappointed you?', tone: 'blue' },
      { id: 'glad', title: 'Glad', prompt: 'What made you happy?', tone: 'green' },
    ],
  },
  {
    id: 'four-ls',
    name: '4Ls',
    description: 'Liked, Learned, Lacked, Longed for (Gorman and Gottesdiener).',
    whenToUse: 'After a sprint with a lot of learning, or to balance positives and gaps.',
    columns: [
      { id: 'liked', title: 'Liked', prompt: 'What did you enjoy?', tone: 'green' },
      { id: 'learned', title: 'Learned', prompt: 'What did you learn?', tone: 'blue' },
      { id: 'lacked', title: 'Lacked', prompt: 'What was missing?', tone: 'amber' },
      { id: 'longed', title: 'Longed for', prompt: 'What do you wish had happened?', tone: 'purple' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    description: 'A metaphor: wind pushes the team forward, anchors hold it back, rocks are risks ahead, the island is the goal.',
    whenToUse: 'To connect the retrospective to a goal and look ahead at risks.',
    columns: [
      { id: 'wind', title: 'Wind', prompt: 'What helped us move forward?', tone: 'teal' },
      { id: 'anchors', title: 'Anchors', prompt: 'What slowed us down?', tone: 'grey' },
      { id: 'rocks', title: 'Rocks', prompt: 'What risks lie ahead?', tone: 'red' },
      { id: 'island', title: 'Island', prompt: 'Where are we heading? What does success look like?', tone: 'green' },
    ],
  },
  {
    id: 'starfish',
    name: 'Starfish',
    description: 'Keep, Less, More, Stop, Start: more nuance than Start, Stop, Continue.',
    whenToUse: 'When the team is ready for finer-grained adjustments.',
    columns: [
      { id: 'keep', title: 'Keep doing', prompt: 'What is working well?', tone: 'blue' },
      { id: 'more', title: 'More of', prompt: 'What should we do more of?', tone: 'green' },
      { id: 'less', title: 'Less of', prompt: 'What should we do less of?', tone: 'amber' },
      { id: 'stop', title: 'Stop doing', prompt: 'What should we stop?', tone: 'red' },
      { id: 'start', title: 'Start doing', prompt: 'What should we try?', tone: 'teal' },
    ],
  },
  {
    id: 'kalm',
    name: 'KALM',
    description: 'Keep, Add, More, Less.',
    whenToUse: 'To tune existing practices rather than overhaul them.',
    columns: [
      { id: 'keep', title: 'Keep', prompt: 'What brings value and should stay?', tone: 'blue' },
      { id: 'add', title: 'Add', prompt: 'What new idea should we add?', tone: 'teal' },
      { id: 'more', title: 'More', prompt: 'What should we do more of?', tone: 'green' },
      { id: 'less', title: 'Less', prompt: 'What should we do less of?', tone: 'amber' },
    ],
  },
  {
    id: 'plus-delta',
    name: 'Plus / Delta',
    description: 'What went well, and what we would change.',
    whenToUse: 'Short retrospectives, or at the end of a workshop or event.',
    columns: [
      { id: 'plus', title: 'Plus', prompt: 'What went well?', tone: 'green' },
      { id: 'delta', title: 'Delta', prompt: 'What would we change?', tone: 'amber' },
    ],
  },
  {
    id: 'well-improve-ideas',
    name: 'Went well, To improve, Ideas',
    description: 'A classic three-column board.',
    whenToUse: 'A familiar, low-effort format for regular retrospectives.',
    columns: [
      { id: 'well', title: 'Went well', prompt: 'What went well?', tone: 'green' },
      { id: 'improve', title: 'To improve', prompt: 'What could be better?', tone: 'amber' },
      { id: 'ideas', title: 'Ideas', prompt: 'What could we try?', tone: 'purple' },
    ],
  },
  {
    id: 'pre-mortem',
    name: 'Pre-mortem',
    description: 'Imagine the project has failed, then work backwards.',
    whenToUse: 'At the start of a project or a risky sprint. Pairs well with the risk register.',
    columns: [
      { id: 'failure', title: 'It failed because…', prompt: 'Imagine it is the end and things went wrong. Why?', tone: 'red' },
      { id: 'signs', title: 'Warning signs', prompt: 'What would we notice early?', tone: 'amber' },
      { id: 'prevent', title: 'Prevention', prompt: 'What can we do now to stop it happening?', tone: 'green' },
    ],
  },
  {
    id: 'lean-coffee',
    name: 'Lean Coffee',
    description: 'Participants propose topics, vote, then discuss them in time-boxed slots.',
    whenToUse: 'When the team has many things to talk about and no fixed agenda.',
    columns: [{ id: 'topics', title: 'Topics', prompt: 'What would you like to talk about?', tone: 'teal' }],
  },
];

export function getTemplate(id: string): RetroTemplate | undefined {
  return RETRO_TEMPLATES.find((t) => t.id === id);
}

export const CHECKIN_QUESTIONS = [
  'In one word, how are you arriving today?',
  'What is one thing that went well for you this sprint?',
  'If this sprint were weather, what would it be?',
  'What is one thing you learned this sprint?',
  'Who would you like to thank, and why?',
];
