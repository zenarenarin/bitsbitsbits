// Logic checks: condition definitions, solver, generator guarantees, engine.
// node dev/test_puzzle.js [seedsPerPreset]
const O = require('./load_core')();
const N = +(process.argv[2] || 80);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const T = O.CONDITION_TYPES;
const S = O.NSTATES;

// ---- 1. Condition definitions (family IDs only) ----------------------------------
ok(T.triple.test([3, 3, 3]) && !T.triple.test([3, 3, 4]), 'triple');
ok(T.pair.test([1, 1, 2]) && !T.pair.test([1, 1, 1]) && !T.pair.test([1, 2, 3]), 'pair of three');
ok(T.pair.test([1, 1, 2, 3]) && !T.pair.test([1, 1, 2, 2]) && !T.pair.test([1, 1, 1, 2]) && !T.pair.test([1, 2, 3, 4]), 'pair of four: exactly one pair, rest differ');
ok(T.contrast.test([0, 5], { d: 5 }) && T.contrast.test([11, 4], { d: 5 }) && !T.contrast.test([11, 3], { d: 5 }), 'contrast is circular distance');
ok(T.contrast.test([2, 8], { d: 6 }) && !T.contrast.test([2, 7], { d: 6 }), 'contrast 6 means opposite');
ok(T.odd.test([4, 4, 7], { odd: 2 }) && !T.odd.test([4, 4, 4], { odd: 2 }) && !T.odd.test([4, 5, 7], { odd: 2 }), 'odd one of three');
ok(T.odd.test([4, 9, 4, 4], { odd: 1 }) && !T.odd.test([4, 9, 4, 5], { odd: 1 }), 'odd one of four: the round pins all match');
ok(T.sequence.test([10, 11, 0], { step: 1 }) && T.sequence.test([1, 0, 11], { step: -1 }) && !T.sequence.test([1, 2, 4], { step: 1 }), 'sequence wraps the spectrum');
ok(T.missing.test([1, 2, 3, 4], { fam: 5 }) && !T.missing.test([1, 5, 3], { fam: 5 }), 'missing');
ok(T.alldiff.test([1, 2, 3, 4, 5]) && !T.alldiff.test([1, 2, 3, 1]), 'all different');
// progress is 1 exactly when the rule holds
Object.keys(T).forEach(k => {
  const r = O.makeRng('prog' + k);
  for (let i = 0; i < 400; i++) {
    const n = k === 'contrast' ? 2 : k === 'triple' || k === 'sequence' ? 3 : 4;
    const f = []; for (let j = 0; j < n; j++) f.push(r.int(0, 3));
    const c = { d: 4, odd: 1, step: 1, fam: 2, rings: f.map((_, j) => j) };
    ok((T[k].progress(f, c) === 1) === T[k].test(f, c), 'progress agrees with test: ' + k + ' ' + f);
  }
});

// ---- 2. Solver: BFS distance equals the true minimum ---------------------------------
{
  const r = O.makeRng('bfs');
  const goal = new Uint8Array(S); const goals = [];
  for (let i = 0; i < 25; i++) { const s = r.int(0, S - 1); goal[s] = 1; goals.push(s); }
  const D = O.bfs(goal);
  const cd = (a, b) => { const d = ((a - b) % 12 + 12) % 12; return Math.min(d, 12 - d); };
  for (let i = 0; i < 300; i++) {
    const s = r.int(0, S - 1), so = O.stateOffsets(s);
    let best = 99; goals.forEach(g => { const go = O.stateOffsets(g); let d = 0; for (let k = 1; k <= 4; k++) d += cd(so[k], go[k]); best = Math.min(best, d); });
    ok(D[s] === best, 'bfs distance ' + s);
  }
  ok(O.stateIndex(O.stateOffsets(12345)) === 12345 && O.stateIndex([0, -1, 13, 0, 0]) === 11 + 12, 'state encoding');
}

// ---- 3. Generator guarantees -----------------------------------------------------------
const times = {};
for (const preset of ['gentle', 'standard', 'deep']) {
  const P = O.PUZZLE_PRESETS[preset];
  const t0 = Date.now(); let worst = 0;
  for (let n = 1; n <= N; n++) {
    const key = preset === 'standard' ? O.keyFromDayNumber(n) : 'practice:' + n;
    const ts = Date.now();
    const p = O.PuzzleGenerator.generate(key, preset);
    worst = Math.max(worst, Date.now() - ts);
    const id = preset + ' ' + key;
    ok(!p.fallback, 'no fallback ' + id);
    if (n <= 10) ok(O.PuzzleGenerator.generate(key, preset).sig === p.sig, 'deterministic ' + id);
    ok(p.conds.length === 7 && p.cum.join() === '3,5,7', 'seven clues in 3/5/7 ' + id);
    // Rows are permutations; the centre ring is the spectrum.
    ok(p.seqs[0].every((f, i) => f === i), 'centre ring is the spectrum ' + id);
    ok(p.seqs.every(row => row.slice().sort((a, b) => a - b).join() === '0,1,2,3,4,5,6,7,8,9,10,11'), 'every ring carries each family once ' + id);
    ok(new Set(p.conds.map(c => c.pos)).size === 7, 'one clue per column ' + id);
    ok(new Set(p.conds.map(c => c.type)).size >= 4, 'at least four kinds of clue ' + id);
    for (let k = 1; k <= 4; k++) ok(p.conds.filter(c => c.rings.includes(k)).length >= 2, 'ring ' + k + ' shared by two clues ' + id);
    const masks = p.conds.map(c => O.satMask(p.seqs, c));
    // The fast mask agrees with evaluating the rule directly on the board.
    if (n <= 12) { const r = O.makeRng('mask' + id); for (let t = 0; t < 200; t++) { const st = r.int(0, S - 1), rot = O.stateOffsets(st); p.conds.forEach((c, i) => { const f = O.condFams(p.seqs, c, rot); ok(masks[i][st] === (O.CONDITION_TYPES[c.type].test(f, c) ? 1 : 0), 'mask matches direct evaluation ' + id); }); } }
    // Every clue holds at the solution; the solution set matches the final stage.
    const sol = p.solution;
    p.conds.forEach((c, i) => ok(masks[i][O.stateIndex(sol)] === 1, 'clue ' + i + ' holds at the solution ' + id));
    const stageSet = n => { const m = new Uint8Array(S).fill(1); for (let i = 0; i < n; i++) for (let s = 0; s < S; s++) m[s] &= masks[i][s]; return m; };
    const sets = p.cum.map(stageSet);
    const sizes = sets.map(m => m.reduce((a, b) => a + b, 0));
    ok(sizes.join() === p.sizes.join(), 'stage sizes verified ' + id);
    ok(sizes[2] >= P.s3[0] && sizes[2] <= P.s3[1], 'solutions in range ' + sizes[2] + ' ' + id);
    ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], 'each stage narrows ' + id);
    // No redundant clue at its stage.
    p.cum.forEach((n, st) => {
      for (let i = st ? p.cum[st - 1] : 0; i < n; i++) {
        let cnt = 0; for (let s = 0; s < S; s++) { let a = 1; for (let j = 0; j < n; j++) if (j !== i) a &= masks[j][s]; cnt += a; }
        ok(cnt > sizes[st], 'clue ' + i + ' contributes at stage ' + (st + 1) + ' ' + id);
      }
    });
    // The start: not solved at any stage, distance verified, within range.
    const s0 = O.stateIndex(p.start);
    ok(!sets[0][s0], 'start does not satisfy stage 1 ' + id);
    const D3 = O.bfs(sets[2]);
    ok(D3[s0] === p.par && p.par >= P.par[0] && p.par <= P.par[1], 'par verified by BFS ' + p.par + ' ' + id);
    ok(p.route >= p.par && p.budget > p.route, 'route and budget sane ' + id);
    // Play it: always step toward the current stage's nearest arrangement.
    const e = O.createGame(p);
    let guard = 0, events = [];
    while (!e.solved && guard++ < 200) {
      const D = p.dist[e.stage]; const here = D[e.state()];
      let mv = null;
      for (let k = 1; k <= 4 && !mv; k++) for (const d of [1, -1]) { const o = e.rot.slice(); o[k] += d; if (D[O.stateIndex(o)] < here) { mv = [k, d]; break; } }
      const r = e.rotate(mv[0], mv[1]);
      if (r.event) {
        events.push(r.event);
        if (r.event === 'stage') {
          // The newly revealed clues are not all satisfied by where we stand.
          let all = true; for (let i = p.cum[e.stage - 1]; i < p.cum[e.stage]; i++) all = all && e.holds(i);
          ok(!all, 'reveal forces a rethink at stage ' + (e.stage + 1) + ' ' + id);
        }
      }
    }
    ok(e.solved && events.join() === 'stage,stage,solved', 'solvable through the stages ' + events + ' ' + id);
    // `route` is the best nearest-first route (the stage arrangements tie); any
    // nearest-first path is at least that long, and never shorter than par.
    ok(e.moves >= p.route && p.route >= p.par, 'nearest-first path ' + e.moves + ' >= route ' + p.route + ' >= par ' + p.par + ' ' + id);
  }
  times[preset] = { avgMs: Math.round((Date.now() - t0) / N), worstMs: worst };
}

// ---- 4. Engine --------------------------------------------------------------------------
{
  const p = O.PuzzleGenerator.generate('engine-test', 'standard');
  const e = O.createGame(p);
  ok(e.rotate(0, 1) === null && e.rot[0] === 0, 'centre ring cannot turn');
  e.rotate(2, 3); e.rotate(4, -2); e.rotate(1, 12);
  ok(e.moves === 17 && e.history.length === 3, 'one move per segment (3+2+12)');
  const before = e.state();
  e.undo();
  ok(e.moves === 5 && e.rot[1] === p.start[1], 'undo reverses exactly the last action and its moves');
  ok(e.state() === before, 'a full revolution leaves the arrangement unchanged');
  e.undo(); e.undo();
  ok(e.moves === 0 && e.rot.join() === p.start.join() && !e.undo(), 'undo back to the start');
  e.rotate(3, 1); e.reset();
  ok(e.moves === 0 && e.rot.join() === p.start.join() && e.history.length === 0, 'reset');
  // hints escalate and the direction is a real improvement
  const ci = e.hintTarget(-1);
  const h1 = e.hint(ci), h2 = e.hint(ci), h3 = e.hint(ci), h4 = e.hint(ci);
  ok(h1.level === 1 && h2.level === 2 && h3.level === 3 && h4.level === 3 && e.hints === 4, 'hint levels 1, 2, 3 (capped)');
  ok(typeof h2.text === 'string' && h2.text.length > 10, 'level-2 hint explains the relationship: ' + h2.text);
  if (h3.dir) { const o = e.rot.slice(); o[h3.dir.ring] += h3.dir.dir; ok(p.dist[0][O.stateIndex(o)] < p.dist[0][e.state()], 'level-3 direction moves closer to the stage'); }
  else ok(false, 'level-3 hint has a direction');
  // serialize / restore
  e.rotate(2, -1); e.rotate(3, 2);
  const snap = JSON.parse(JSON.stringify(e.serialize()));
  const e2 = O.createGame(p, snap);
  ok(e2.rot.join() === e.rot.join() && e2.moves === e.moves && e2.hints === e.hints && e2.stage === e.stage, 'restore round-trips');
  ok(O.createGame(p, { sig: 'other', rot: [0, 1, 1, 1, 1], moves: 3, stage: 0, history: [] }).moves === 0, 'save for another puzzle ignored');
  ok(O.createGame(p, { sig: p.sig, rot: [0, 1], moves: 3, stage: 0, history: [] }).moves === 0, 'malformed save ignored');
  ok(!O.createGame(p, Object.assign({}, snap, { solved: true })).solved, 'a claimed solve is re-checked, not trusted');
  // solved locks the board; forceSolved lands on a solution
  const e3 = O.createGame(p); e3.forceSolved();
  ok(e3.solved && e3.isSolutionState() && e3.rotate(1, 1) === null, 'forced solved view is a real solution and locked');
}

console.log('timing per puzzle', JSON.stringify(times));
console.log(fails ? 'puzzle: ' + fails + ' FAILED' : 'puzzle: all checks passed');
process.exit(fails ? 1 : 0);
