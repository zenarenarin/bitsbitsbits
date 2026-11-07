// All presentation copy lives here, separate from animation code.
// Scenes import their own block and never hard-code wording.

export const opening = {
  presents: 'Presents',
  title: ['Commit to', 'the Bit'],
  subtitle: 'A playground for game makers.',
  enter: 'Press → to enter',
};

export const scene01 = {
  index: '01',
  kicker: 'Why do we play?',
  headline: 'Why play?',
  setup:
    'In The Grasshopper (1978), the philosopher Bernard Suits imagines a utopia where every need is already met. What would anyone do all day?',
  answer: 'His answer: games.',
  beats: ['Unnecessary obstacles.', 'Voluntary challenge.'],
  easyWay: 'The easy way',
  chosenWay: 'The chosen way',
  quote: 'The voluntary attempt to overcome unnecessary obstacles.',
  quoteLead: 'Playing a game is',
  attribution: 'Bernard Suits',
  source: 'The Grasshopper: Games, Life and Utopia, 1978',
  hint: 'Click the wall to raise the challenge',
};

export const scene02 = {
  index: '02',
  kicker: 'Connecting dots',
  words: ['Unrelated.', 'Until connected.'],
  statement: ['Creativity is the power of connecting dots', 'that seem unconnected.'],
  hint: 'Drag any object',
};

export const challenge01 = {
  index: '02 · Challenge',
  kicker: 'Mini challenge 01',
  title: 'Make the connection',
  duration: 45,
  instruction: 'Invent a game that connects these two things.',
  prompts: [
    { n: '01', q: 'What does the player do?' },
    { n: '02', q: 'What makes it difficult?' },
    { n: '03', q: 'What counts as winning?' },
  ],
  // Ingredient pairs. The first pair is the one from the brief.
  pairs: [
    ['A paper plane', 'A magnet'],
    ['A shadow', 'A lantern'],
    ['A balloon', 'A clock'],
    ['An echo', 'A maze'],
    ['A seed', 'A storm'],
    ['A mirror', 'A ball'],
    ['A rope', 'A river'],
    ['A snowball', 'A slope'],
  ],
  controls: { start: 'Start', pause: 'Pause', shuffle: 'New pair', reset: 'Reset', skip: 'Skip' },
  done: 'Time. Who has one?',
};

export const scene03 = {
  index: '03',
  kicker: 'The joy of trying again',
  headline: ["The reward isn't", 'only winning.'],
  payoff: ["It's wanting", 'another attempt.'],
  support: 'Feedback makes trying again meaningful.',
  feedback: { short: 'Too short', long: 'Too far', hit: 'Landed' },
  attempt: 'Attempt',
  yourTurn: 'Your turn — pull back the seed and let go',
};

// Screens still in production (Phase 3–5). Shown as chapter cards so the
// whole running order can be rehearsed today.
export const upcoming = [
  { index: '04', title: 'Two ways to build a game', phase: 'Phase 3' },
  { index: '05', title: 'Games have a grammar', phase: 'Phase 3' },
  { index: '06', title: 'Possibility needs limits', phase: 'Phase 3' },
  { index: '07', title: 'Same rules. New problems.', phase: 'Phase 3' },
  { index: '08', title: 'Four games. Four recipes.', phase: 'Phase 4' },
  { index: '09', title: 'The flow state', phase: 'Phase 5' },
  { index: '10', title: 'Connect. The. Dots.', phase: 'Phase 5' },
];
