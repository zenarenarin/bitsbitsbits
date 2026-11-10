// Node tests for the puzzle bank and the pure game rules (src/00_util.js, 01_bank.js, 02_rules.js).
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = ['00_util.js', '01_bank.js', '02_rules.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const C = {}; vm.createContext(C); vm.runInContext(src + '\nthis.X={CONFIG,loadBank,dayNumber,dailyPuzzles,practicePuzzles,WordInput,Run,isAccepted,PUZZLE_BANK_RAW,LEVEL_NAMES};', C);
const X = C.X;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// ---- bank ----
const bank = X.loadBank(X.PUZZLE_BANK_RAW);
const LEN = [[3, 4], [4, 5], [5, 6], [6, 8], [7, 9]];
const ids = new Set();
bank.forEach((pool, l) => {
  ok(pool.length >= 25, `level ${l + 1} has ${pool.length} puzzles`);
  for (const p of pool) {
    ok(!ids.has(p.id), 'unique id ' + p.id); ids.add(p.id);
    ok(p.answer.length === p.length, p.id + ' length');
    ok(p.answer[0] === p.startLetter && p.answer[p.length - 1] === p.endLetter, p.id + ' letters');
    ok(p.length >= LEN[l][0] && p.length <= LEN[l][1], p.id + ' level length range');
    ok(p.accepted[0] === p.answer, p.id + ' primary first');
    for (const w of p.accepted) ok(w.length === p.length && w[0] === p.startLetter && w[w.length - 1] === p.endLetter && /^[A-Z]+$/.test(w), p.id + ' alt ' + w);
    ok(p.hint && p.hint.length <= 70, p.id + ' hint length');
    ok(!p.hint.toUpperCase().includes(p.answer), p.id + ' hint leaks answer');
  }
});
// spot checks of alternatives that must be accepted
const find = a => bank.flat().find(p => p.answer === a);
for (const [a, alt] of [['CUP', 'CAP'], ['MAP', 'MOP'], ['BOOK', 'BACK'], ['LABYRINTH', 'LOCKSMITH'], ['VOLCANO', 'VERTIGO'], ['VERTIGO', 'VOLCANO'], ['KAYAK', 'KNOCK'], ['HAT', 'HUT']])
  ok(X.isAccepted(find(a), alt), `${a} accepts ${alt}`);
ok(!X.isAccepted(find('CUP'), 'CUT'), 'CUP rejects CUT (wrong ending)');
ok(!X.isAccepted(find('BOOK'), 'BXXK'), 'rejects non-word');
ok(X.isAccepted(find('CUP'), 'cup'), 'case-insensitive');

// ---- daily determinism ----
const d1 = X.dailyPuzzles(bank, 314).map(p => p.id).join(), d2 = X.dailyPuzzles(bank, 314).map(p => p.id).join();
ok(d1 === d2, 'daily deterministic');
ok(X.dailyPuzzles(bank, 315).map(p => p.id).join() !== d1, 'next day differs');
ok(X.dayNumber(new Date(2026, 0, 1, 23, 59)) === 1 && X.dayNumber(new Date(2026, 10, 10, 0, 1)) === 314, 'day numbers ' + X.dayNumber(new Date(2026, 10, 10)));
for (let l = 0; l < 5; l++) { // a full cycle visits every puzzle exactly once
  const n = bank[l].length, seen = new Set();
  for (let d = 1; d <= n; d++) seen.add(X.dailyPuzzles(bank, d)[l].id);
  ok(seen.size === n, `level ${l + 1} cycle covers pool`);
}
const pr = X.practicePuzzles(bank, 7, X.dailyPuzzles(bank, 314).map(p => p.id));
ok(pr.length === 5 && pr.every((p, i) => p.difficulty === i + 1), 'practice set shape');

// ---- input model ----
const W = a => new X.WordInput(find(a));
let w = W('CUP'); w.type('u'); ok(w.word === 'CUP' && w.full, 'middle-only typing, lowercase');
w = W('CUP'); for (const c of 'CUP') w.type(c); ok(w.word === 'CUP', 'whole-word typing');
w = W('BOOK'); for (const c of 'BOOK') w.type(c); ok(w.word === 'BOOK', 'whole word BOOK');
w = W('BOOK'); for (const c of 'OO') w.type(c); ok(w.word === 'BOOK', 'middle BOOK');
w = W('BOOK'); for (const c of 'OOX') w.type(c); ok(w.word === 'BOOK', 'extra letter ignored');
w = W('BOOK'); w.type(' '); w.type('1'); ok(w.middle === '', 'non-letters ignored');
w = W('BOOK'); w.type('O'); w.back(); ok(w.middle === '', 'backspace');
w = W('BOOK'); w.back(); ok(w.middle === '', 'backspace on empty');
w = W('BOOK'); for (const c of 'BOOK') w.type(c); w.back(); ok(w.middle === 'O', 'backspace after whole word removes a middle letter');
w = W('LABYRINTH'); for (const c of 'LABYRINTH') w.type(c); ok(w.word === 'LABYRINTH', 'long whole word');
w = W('LABYRINTH'); w.setRaw('l a-byrinth!'); ok(w.word === 'LABYRINTH', 'setRaw sanitises');
w = W('EGG'); for (const c of 'EGG') w.type(c); ok(w.word === 'EGG', 'EGG whole');
w = W('EGG'); w.type('G'); ok(w.word === 'EGG', 'EGG middle');

// ---- run, timer, hints, scoring ----
const set = X.dailyPuzzles(bank, 314);
const typeWord = (r, word, t) => { for (const c of word) r.type(c, t); return r.submit(t); };
let r = new X.Run(set), t = 1000;
ok(r.remainingMs(t) === 75000, 'ready shows full time');
ok(r.type('A', t) === false, 'no input before start');
r.start(t);
ok(r.submit(t).kind === 'empty', 'empty submit');
r.type(set[0].answer[1], t); if (set[0].length > 3) ok(r.submit(t).kind === 'incomplete', 'incomplete submit');
r.input.clear();
let res = typeWord(r, set[0].answer, t + 10000);
ok(res.kind === 'correct' && res.entry.speed === 65 && res.entry.mult === 1 && res.entry.points === 165, 'first word scoring ' + JSON.stringify(res.entry && res.entry.points));
ok(r.submit(t + 10000).kind === 'ignored' && r.type('A', t + 10500) === false, 'input locked during transition');
ok(r.remainingMs(t + 10500) === 64500, 'timer continues through transition');
const h = r.hint(t + 12000); ok(h.kind === 'ok' && r.remainingMs(t + 12000) === 58000, 'hint costs 5s');
ok(r.hint(t + 12000).kind === 'already' && r.remainingMs(t + 12000) === 58000, 'second hint free and no-op');
r.input.clear(); for (const c of 'ZZZZZZZZZ'.slice(0, set[1].length)) r.type(c, t + 13000);
res = r.submit(t + 13000); ok(res.kind === 'wrong', 'wrong answer');
ok(r.state === 'playing' && r.remainingMs(t + 13000) === 57000, 'wrong keeps timer running');
r.input.clear(); res = typeWord(r, set[1].answer, t + 14000);
ok(res.kind === 'correct' && res.entry.penalty === 50 && res.entry.mult === 1 && res.entry.points === 100 + 56 - 50, 'hinted word scoring ' + res.entry.points);
res = typeWord(r, set[2].answer, t + 20000); ok(res.kind === 'correct' && res.entry.mult === 1, 'streak restarts after hint');
res = typeWord(r, set[3].answer, t + 25000); ok(res.kind === 'correct' && res.entry.mult === 1.25, 'streak grows');
// hint refused near zero
const r2 = new X.Run(set); r2.start(0); ok(r2.hint(70500).kind === 'denied' && r2.remainingMs(70500) === 4500, 'hint refused at 4.5s');
ok(r2.hint(69000).kind === 'ok' && r2.remainingMs(69000) === 1000, 'hint at 6s leaves 1s, never negative');
ok(r2.tick(70000) === 'lost' && r2.remainingMs(99999) === 0 && r2.state === 'lost', 'runs out');
ok(r2.submit(70001).kind === 'ignored', 'no submit after loss');
// correct with < 5s left, and time running out mid-transition
const r3 = new X.Run(set); r3.start(0);
for (let i = 0; i < 4; i++) typeWord(r3, set[i].answer, 1000 + i * 2000);
ok(r3.state === 'playing', 'mid-run');
res = typeWord(r3, set[4].answer, 72000); ok(res.kind === 'won' && r3.remainingMs(99999) === 3000, 'win with 3s left, timer frozen');
ok(res.entry.bonus === 250 + 30, 'completion bonus');
ok(r3.submit(72001).kind === 'ignored' && r3.hint(72001).kind === 'ignored', 'no input after win');
const total = r3.solved.reduce((a, e) => a + e.points, 0) + res.entry.bonus; ok(total === r3.score, 'score adds up');
const r4 = new X.Run(set); r4.start(0); typeWord(r4, set[0].answer, 74500); ok(r4.tick(75000) === 'lost' && r4.solved.length === 1, 'time out during transition');
// solve with an alternative answer
const r5 = new X.Run([find('CUP'), ...set.slice(1)]); r5.start(0); r5.type('A', 0); ok(r5.submit(0).kind === 'correct' && r5.solved[0].word === 'CAP' && !r5.solved[0].primary, 'alternative accepted');
// typing fast while locked never leaks into the next word
const r6 = new X.Run(set); r6.start(0); for (const c of set[0].answer + 'XYZ') r6.type(c, 0); r6.submit(0); ok(r6.input.middle === '', 'no leaked keystrokes');
// double submit
const r7 = new X.Run(set); r7.start(0); for (const c of set[0].answer) r7.type(c, 0); const a1 = r7.submit(0), a2 = r7.submit(0); ok(a1.kind === 'correct' && a2.kind === 'ignored' && r7.solved.length === 1, 'double submit prevented');

console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
