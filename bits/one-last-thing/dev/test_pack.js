const { U, World, Catalog, Packer } = require('./load')();
const sets = [
  ['notebook', 'cup', 'vase'],
  ['journal', 'teapot', 'scroll', 'key', 'bottle'],
  ['radio', 'bowl', 'bottle', 'postcards', 'incense', 'clock', 'letter'],
  ['tv', 'candle', 'letter', 'bird', 'mirror', 'envelopes', 'woodbox', 'horse', 'mask', 'flower'],
];
for (const ids of sets) {
  const t = Date.now();
  const r = Packer.runSync(Packer.puzzleGen(ids.map(id => ({ id })), { H: 8.3, seed: 3, slack: [1, 1] }));
  console.log(ids.length, 'items', r.ok ? `drawer ${r.W} x ${r.D} x ${r.H}` : r.reason, JSON.stringify(r.problems || ''), Date.now() - t, 'ms');
}
