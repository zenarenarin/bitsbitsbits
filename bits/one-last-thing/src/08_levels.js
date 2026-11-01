// Level design. The twelve designed drawers are solved offline by dev/gen_levels.js
// (same packer and rules as the game) and stored in 08_levels_data.js with their proof
// arrangement. Endless drawers are generated on the device by reverse generation.
// Every puzzle's proof is re-validated by Packer.verify before it is shown.

const Levels = (() => {
  const DEFS = [
    { name: 'First drawer', items: ['notebook', 'cup', 'vase'], H: 7.0, slack: [4.5, 4.0], seed: 11 },
    { name: 'Correspondence', items: ['journal', 'teapot', 'scroll', 'key'], H: 8.3, slack: [2.6, 2.4], seed: 21 },
    { name: 'Glaze and paper', items: ['bowl', 'bottle', 'postcards', 'incense', 'clock'], H: 6.6, slack: [2.0, 2.0], seed: 31 },
    { name: 'The study', items: ['radio', 'frame', 'candle', 'mirror', 'letter', 'bird'], H: 6.0, slack: [1.7, 1.6], seed: 41 },
    { name: 'Nursery shelf', items: ['tv', 'lidpot', 'envelopes', 'horse', 'flower', 'cup', 'key'], H: 7.4, slack: [1.5, 1.4], seed: 51 },
    { name: 'Gramophone evening', items: ['gramophone', 'woodbox', 'notebook', 'mask', 'sculpture', 'letter', 'postcards'], H: 7.4, slack: [1.3, 1.2], seed: 61 },
    { name: 'Tea for one', items: ['flask', 'teapot', 'journal', 'bird', 'key', 'envelopes', 'candle', 'cup'], H: 8.3, slack: [1.2, 1.1], seed: 71 },
    { name: 'Curiosities', items: ['vase', 'bowl', 'radio', 'scroll', 'mirror', 'frame', 'incense', 'horse', 'notebook'], H: 6.6, slack: [1.1, 1.0], seed: 81 },
    { name: 'Attic', items: ['tv', 'gramophone', 'bottle', 'clock', 'letter', 'postcards', 'mask', 'flower', 'sculpture', 'cup'], H: 7.2, slack: [1.0, 0.95], seed: 91 },
    { name: 'Inheritance', items: ['lidpot', 'flask', 'woodbox', 'journal', 'envelopes', 'key', 'bird', 'candle', 'mirror', 'incense', 'notebook'], H: 7.0, slack: [0.95, 0.9], seed: 101 },
    { name: 'Moving day', items: ['teapot', 'vase', 'bowl', 'radio', 'tv', 'frame', 'scroll', 'horse', 'postcards', 'letter', 'flower', 'sculpture'], H: 8.3, slack: [0.9, 0.85], seed: 111 },
    { name: 'One last thing', items: ['gramophone', 'clock', 'bottle', 'cup', 'woodbox', 'journal', 'notebook', 'envelopes', 'mask', 'key', 'bird', 'candle', 'mirror', 'incense'], H: 7.4, slack: [0.85, 0.8], seed: 121 },
  ];

  function designed(i) {
    const data = typeof LEVEL_DATA !== 'undefined' ? LEVEL_DATA : [];
    return data[i] ? Object.assign({ index: i, name: DEFS[i].name, designed: true }, data[i]) : null;
  }

  // Endless: controlled variation of object choice, size and drawer.
  function endlessSpec(n) {
    const r = U.rng(9001 + n * 7919);
    const all = Catalog.list.map(d => d.id);
    const count = Math.min(14, 8 + Math.floor(n / 2) + r.int(0, 2));
    const ids = r.shuffle(all).slice(0, count);
    const items = ids.map(id => ({ id, scale: +(0.9 + r() * 0.2).toFixed(3) }));
    // the drawer must at least admit every object in some orientation
    let minH = 0;
    for (const it of items) {
      const ors = Packer.orientations(Catalog.byId[it.id], it.scale, 99, U.rng(1));
      minH = Math.max(minH, Math.min(...ors.map(o => o.e[1])));
    }
    const H = +(minH + 0.25 + r() * 1.1).toFixed(2);
    const s = Math.max(0.6, 1.0 - n * 0.02);
    const NAMES = ['A rainy Tuesday', 'The spare room', 'Left to me', 'Before the move', 'Lost property', 'The bottom drawer', 'An aunt\u2019s things', 'Market finds', 'Under the stairs', 'The writing desk', 'Odds and ends', 'A long winter', 'Kept for later', 'The guest room', 'House clearance', 'Sunday afternoon'];
    return { name: NAMES[n % NAMES.length], items, H, slack: [s, s * 0.95], seed: 5000 + n * 31 };
  }
  function* endlessGen(n) {
    const spec = endlessSpec(n);
    for (let attempt = 0; attempt < 3; attempt++) {
      const pz = yield* Packer.puzzleGen(spec.items, { H: spec.H, seed: spec.seed + attempt * 977, slack: spec.slack, searchSteps: 3, maxOrient: 6 });
      if (pz.ok) return Object.assign({ index: DEFS.length + n, name: spec.name, endless: n }, pz);
      spec.H = +(spec.H + 0.5).toFixed(2);
    }
    return null;
  }

  return { DEFS, designed, endlessSpec, endlessGen, count: DEFS.length };
})();
