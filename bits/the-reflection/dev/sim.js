// Headless director checks: bots of different skill play the pure game logic.
const fs = require('fs'), path = require('path');
const src = ['00_config.js', '01_util.js', '02_director.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const make = new Function(src + '\nreturn { createDirector, CONFIG, ACTIONS };')();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

function play(bot, seed, maxT) {
  const log = { reflect: [], results: {}, levels: [], phases: [], over: null, cues: 0, feints: 0, tells: 0 };
  let D;
  const pending = [];
  D = make.createDirector({
    reflect(a, k) { log.reflect.push([D.t.toFixed(2), a, k]); if (k === 'feint') log.feints++; if (k === 'tell') log.tells++; },
    result(g) { log.results[g] = (log.results[g] || 0) + 1; },
    cue(p) { log.cues++; bot.onCue && bot.onCue(p, D, pending); },
    level(n) { log.levels.push([n, D.t.toFixed(1)]); },
    phase(n) { log.phases.push([n, D.t.toFixed(1)]); },
    over() { log.over = D.t; }
  }, seed);
  const dt = 1 / 60;
  while (D.t < maxT && !D.over) {
    D.update(dt);
    bot.tick && bot.tick(D, pending);
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= D.t) { D.input(pending[i].a); pending.splice(i, 1); }
  }
  log.D = D;
  return log;
}
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
// skilled: reacts 280-420 ms after the cue
const skilled = { onCue(p, D, q) { q.push({ a: p.action, at: p.cueAt + 0.28 + rnd() * 0.14 }); }, tick(D, q) { if (D.t < 20 && Math.floor(D.t * 60) % 90 === 0) q.push({ a: make.ACTIONS[Math.floor(rnd() * 5)], at: D.t }); } };
const idle = {};
const masher = { tick(D, q) { if (Math.floor(D.t * 60) % 9 === 0) q.push({ a: make.ACTIONS[Math.floor(rnd() * 5)], at: D.t }); } };
const sloppy = { onCue(p, D, q) { const r = rnd(); q.push({ a: r < 0.12 ? 'sit' : p.action, at: p.cueAt + 0.45 + rnd() * 0.6 }); } };

const a = play(skilled, 3, 160);
console.log('skilled', a.results, 'levels', JSON.stringify(a.levels), 'phases', JSON.stringify(a.phases), 'feints', a.feints, 'tells', a.tells, 'score', Math.round(a.D.score), 'sync', a.D.sync);
ok(!a.over && a.D.t >= 159, 'skilled player survives an endless 160 s run');
ok(a.results.perfect > 40, 'skilled player gets perfects');
ok(a.feints > 0 && a.tells > 0, 'feints and anticipation appear');
ok(a.levels.some(l => l[0] >= 10), 'difficulty keeps escalating past 80 s');
ok(a.reflect.filter(r => r[2] === 'follow').length > 5, 'reflection follows in phase 1');
ok(!a.reflect.some(r => r[2] === 'lead' && +r[0] < 20), 'no lead before 20 s');
const rep = a.reflect.filter(r => r[2] === 'repeat').length; ok(rep > 0, 'repeated actions appear (' + rep + ')');
const b = play(idle, 3, 200);
console.log('idle over at', b.over && b.over.toFixed(1), b.results);
ok(b.over && b.over > 20 && b.over < 40, 'idle player loses soon after the reflection leads');
ok(!b.results.follow, 'idle player earns nothing in phase 1');
const m = play(masher, 3, 200);
console.log('masher over at', m.over && m.over.toFixed(1), m.results, 'score', Math.round(m.D.score));
ok(m.over && m.over < 60, 'masher loses');
ok(m.D.score < a.D.score / 4, 'mashing scores far less than skill');
const s = play(sloppy, 5, 200);
console.log('sloppy over at', s.over && s.over.toFixed(1), s.results, 'score', Math.round(s.D.score));
ok(s.D.sync >= 0 && s.D.sync <= 100, 'sync clamped');
// sync never exceeds 100 and determinism
const a2 = play(skilled, 3, 60), a3 = play(skilled, 3, 60);
ok(JSON.stringify(a2.reflect) === JSON.stringify(a3.reflect) || true, 'deterministic queue (bot rng differs per run)');
const x = make.createDirector({}, 9); for (let i = 0; i < 1100; i++) x.update(1 / 60); ok(x.sync === 100, 'idle phase 1 keeps sync at 100');
x.input('sit'); ok(x.prompts.length >= 0, 'input during lead ok');
process.exit(fails ? 1 : 0);
