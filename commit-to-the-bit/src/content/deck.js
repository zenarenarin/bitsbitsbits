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

export const scene04 = {
  headline: ['Two ways', 'to build a game.'],
  topDown: 'Top down',
  bottomUp: 'Bottom up',
  left: ['Concept', 'Rules', 'Mechanics', 'Details'],
  right: ['Action', 'Interaction', 'Mechanics', 'Game'],
  meet: 'Mechanics',
  examples: {
    topDown: { game: 'Papers, Please', line: 'Start with a role: an immigration inspector.' },
    bottomUp: { game: '2048', line: 'Start with an action: slide a tile. Equal tiles merge.' },
  },
  note: 'Illustrative approaches, not development histories.',
};

export const scene05 = {
  headline: ['Games have', 'a grammar.'],
  slots: [
    { key: 'action', label: 'Player does', options: ['tap', 'drag', 'hold', 'aim'] },
    { key: 'world', label: 'World does', options: ['bounce', 'fall', 'move', 'spawn'] },
    { key: 'goal', label: 'To win', options: ['avoid', 'collect', 'survive'] },
  ],
  score: 'Score',
  best: 'Best',
  leaderboard: 'A leaderboard gives someone a reason to beat your score.',
  reset: 'Reset',
};

export const scene06 = {
  open: 'Possibility.',
  headline: ['A game needs', 'limits.'],
  support: 'An objective plus constraints turns possibility into play.',
  constraints: [
    { key: 'space', label: 'Space' },
    { key: 'time', label: 'Time' },
    { key: 'goal', label: 'Objective' },
    { key: 'enemies', label: 'Enemies' },
    { key: 'lives', label: 'Lives' },
    { key: 'level', label: 'Level design' },
    { key: 'info', label: 'Information' },
    { key: 'resources', label: 'Resources' },
  ],
  clear: 'Clear',
};

export const scene07 = {
  headline: ['Same rules.', 'New problems.'],
  stages: [
    { n: '01', word: 'Generous.' },
    { n: '02', word: 'Faster. Tighter.' },
    { n: '03', word: 'Smarter.' },
  ],
  speed: 'Speed',
};

export const scene08 = {
  headline: ['Three games.', 'Three recipes.'],
  placeholder: 'Gameplay footage to be added',
  games: [
    { id: 'flappy-bird', title: 'Flappy Bird', aspect: 9 / 16, recipe: [['tap', 'action'], ['gravity', 'world'], ['obstacles', 'limit'], ['survival', 'goal']] },
    { id: '2048', title: '2048', aspect: 9 / 16, recipe: [['swipe', 'action'], ['merge', 'world'], ['limited space', 'limit'], ['high score', 'goal']] },
    { id: 'tetris', title: 'Tetris', aspect: 9 / 16, recipe: [['move · rotate', 'action'], ['falling pieces', 'world'], ['time pressure', 'limit'], ['spatial strategy', 'goal']] },
  ],
  legend: { action: 'action', world: 'world', limit: 'limit', goal: 'goal' },
};

export const scene09 = {
  headline: ['Hard enough', 'to feel rewarding.', 'Easy enough', 'to try again.'],
  states: { boredom: 'Boredom', flow: 'Flow', frustration: 'Frustration' },
  challenge: 'Challenge',
  skill: 'Skill',
  arcade: ['Pac-Man', 'Space Invaders', 'Tempest', 'Tetris'],
  arcadeNote: 'Each wave, a little harder.',
};

export const scene10 = {
  words: ['Connect.', 'The.', 'Dots.'],
  now: 'Now make one.',
  signature: 'Commit to the Bit',
};
