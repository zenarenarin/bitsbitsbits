// Movement lab checks, driven through the real controller on the real lab course.
// Usage: node dev/test_move.js
const L = require('./load')();
const { TUNING, World, Cat, buildLab } = L;
const DT = 1 / 60;
let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

function lab() { const w = new World(); const L = buildLab(w); return { w, L }; }
// run until predicate or time; inputFn(t, cat) -> {steer, jumpPressed, jumpHeld}
function sim(cat, secs, inputFn, until) {
  const ev = [];
  let prevHeld = false;
  for (let i = 0; i < secs / DT; i++) {
    const inp = inputFn ? inputFn(i * DT, cat) : {};
    const held = !!inp.jump;
    cat.step(DT, { steer: inp.steer || 0, jumpPressed: held && !prevHeld, jumpHeld: held });
    prevHeld = held;
    for (const e of cat.events) ev.push(Object.assign({ t: i * DT, z: cat.pos[2] }, e));
    cat.events.length = 0;
    if (ev.some(e => e.type === 'fall')) break;
    if (until && until(cat)) break;
  }
  return ev;
}
const fell = ev => ev.some(e => e.type === 'fall');
// steer toward a target x like a player would (proportional, clamped)
const toward = (cat, x) => Math.max(-1, Math.min(1, (x - cat.pos[0]) * 2.5));

// 1. starting from a standstill, the cat reaches cruise with weight, not instantly
{ const { w, L } = lab(); const c = new Cat(w); c.reset(L.spawn); let t05 = 0;
  sim(c, 2, (t, k) => { if (Math.abs(t - 0.25) < DT / 2) t05 = k.fwd; return {}; });
  check('accelerates from rest, then holds cruise', t05 > 1.5 && t05 < TUNING.cat.cruise - 1 && Math.abs(c.fwd - TUNING.cat.cruise) < 0.05, `0.25s ${t05.toFixed(2)} m/s, 2s ${c.fwd.toFixed(2)} m/s`); }

// 2. no jump at gap 1: the cat falls
{ const { w, L } = lab(); const c = new Cat(w); c.reset(L.spawn, TUNING.cat.cruise);
  const ev = sim(c, 8, (t, k) => ({ steer: toward(k, 0) }));
  check('runs off the edge without a jump', fell(ev), 'fell at z ' + c.pos[2].toFixed(1)); }

// jump timing window over a gap: which press positions land? Returns window in m and ms.
function window(start, edgeZ, steerX, hold, landY, speed) {
  const wins = [];
  for (let dz = -2.5; dz <= 0.8; dz += 0.05) {
    const { w } = lab(); const c = new Cat(w); c.reset(start, speed || TUNING.cat.cruise);
    const pressZ = edgeZ - dz;   // dz>0: after the edge (coyote)
    let pressed = false, pt = 0;
    const ev = sim(c, 4, (t, k) => {
      if (!pressed && k.pos[2] <= pressZ) { pressed = true; pt = t; }
      return { steer: toward(k, steerX), jump: pressed && t - pt < hold };
    }, k => k.grounded && k.pos[2] < edgeZ - 1.5 && Math.abs(k.pos[1] - landY) < 0.05);
    const good = !fell(ev) && c.grounded && Math.abs(c.pos[1] - landY) < 0.05 && c.pos[2] < edgeZ - 1;
    const scr = ev.some(e => e.type === 'scramble');
    wins.push({ dz, good, scr });
  }
  const g = wins.filter(x => x.good);
  if (!g.length) return { m: 0, ms: 0, from: null, to: null, scr: 0 };
  const from = Math.min(...g.map(x => x.dz)), to = Math.max(...g.map(x => x.dz));
  return { m: to - from, ms: (to - from) / TUNING.cat.cruise * 1000, from, to, scr: g.filter(x => x.scr).length, holes: wins.filter(x => x.dz > from && x.dz < to && !x.good).length };
}
// 3. gap 1 (2.6 m, slight drop): tap and hold windows
for (const [label, hold] of [['tap 60ms', 0.06], ['hold 300ms', 0.3]]) {
  const r = window([0, 0, -20], -30, 0, hold, -0.35);
  check(`gap 1 timing window, ${label}`, r.ms >= 180 && !r.holes, `${r.m.toFixed(2)} m = ${r.ms.toFixed(0)} ms (press from ${r.from} to ${r.to} m past the edge; ${r.scr} via scramble, ${r.holes} holes)`);
}
// 4. gap 2 (3 m, 1.25 m drop) from roof C
for (const [label, hold] of [['tap 60ms', 0.06], ['hold 300ms', 0.3]]) {
  const r = window([1.4, -0.35, -61], -66, 1.4, hold, -1.6);
  check(`gap 2 timing window, ${label}`, r.ms >= 180 && !r.holes, `${r.m.toFixed(2)} m = ${r.ms.toFixed(0)} ms (from ${r.from} to ${r.to}; ${r.scr} via scramble)`);
}
// 5. coyote: a jump pressed just after leaving the edge still counts
{ const { w } = lab(); const c = new Cat(w); c.reset([0, 0, -26], TUNING.cat.cruise); let wasGround = false, leftAt = null;
  const ev = sim(c, 3, (t, k) => { if (k.grounded) wasGround = true; else if (wasGround && leftAt === null) leftAt = t; return { jump: leftAt !== null && t - leftAt >= 0.07 && t - leftAt < 0.4 }; }, k => k.grounded && k.pos[2] < -33);
  check('coyote: jump 70 ms after leaving the edge', !fell(ev) && c.pos[1] === -0.35, `y ${c.pos[1].toFixed(2)}`); }
// 6. buffer: a jump pressed just before landing fires on touchdown
{ const { w } = lab(); const c = new Cat(w); c.reset([0, 0, -26], TUNING.cat.cruise); let t1 = null, t2 = null;
  const ev = sim(c, 3, (t, k) => {
    if (t1 === null && k.pos[2] < -29.6) t1 = t;
    if (t1 !== null && t2 === null && t - t1 > 0.2 && !k.grounded && k.vel[1] < 0 && k.pos[1] + 0.35 < 0.75) t2 = t;
    return { jump: (t1 !== null && t - t1 < 0.15) || (t2 !== null && t - t2 < 0.3) };
  }, k => k.pos[2] < -40);
  const jumps = ev.filter(e => e.type === 'jump').map(e => e.t), lands = ev.filter(e => e.type === 'land' && e.t > 0.1).map(e => e.t);
  check('buffer: a press just before landing jumps on touchdown', jumps.length >= 2 && lands.length >= 1 && Math.abs(jumps[1] - lands[0]) < 0.034, `pressed ${(lands[0] - t2) * 1000 | 0} ms early; jumps ${jumps.map(x => x.toFixed(2))} lands ${lands.map(x => x.toFixed(2))}`); }
// 7. low passage: steer into the opening, the cat ducks through without a bump
{ const { w } = lab(); const c = new Cat(w); c.reset([0, -0.35, -34], TUNING.cat.cruise); let crouched = false;
  const ev = sim(c, 3, (t, k) => { if (k.crouch) crouched = true; return { steer: toward(k, 0.25) }; }, k => k.pos[2] < -44);
  check('low passage: ducks under the pipes, no bump', crouched && !ev.some(e => e.type === 'bump') && c.pos[2] < -44, `z ${c.pos[2].toFixed(1)} crouched ${crouched}`); }
// 8. jumping under the pipes bonks; running into the stair room stumbles
{ const { w } = lab(); const c = new Cat(w); c.reset([0.25, -0.35, -38.4], TUNING.cat.cruise);
  const ev = sim(c, 1, (t) => ({ jump: t > 0.18 && t < 0.4 }), k => k.pos[2] < -42);
  check('jumping inside the low passage bonks the pipes', ev.some(e => e.type === 'bonk'), ev.map(e => e.type).join(',')); }
{ const { w } = lab(); const c = new Cat(w); c.reset([-2, -0.35, -35], TUNING.cat.cruise);
  const ev = sim(c, 1.2);
  check('running into the stair room stumbles', ev.some(e => e.type === 'bump') && c.stumble > 0 || ev.some(e => e.type === 'bump'), ev.map(e => e.type).join(',')); }
// 9. narrow ledge, hands off: the cat steadies itself and crosses
{ const { w } = lab(); const c = new Cat(w); c.reset([1.4, -0.35, -46.5], TUNING.cat.cruise);
  const ev = sim(c, 3, () => ({}), k => k.pos[2] < -61);
  check('narrow ledge: crosses with the stick idle', !fell(ev) && c.pos[2] < -61, `z ${c.pos[2].toFixed(1)}`); }
// 10. narrow ledge with a sloppy entry (0.25 m off centre)
{ const { w } = lab(); const c = new Cat(w); c.reset([1.05, -0.35, -47.5], TUNING.cat.cruise);
  const ev = sim(c, 3, () => ({}), k => k.pos[2] < -61);
  check('narrow ledge: forgives an entry 0.35 m off the ledge line', !fell(ev) && c.pos[2] < -61, `z ${c.pos[2].toFixed(1)} x ${c.pos[0].toFixed(2)}`); }
// 11. a brief flick outward on the ledge is held by edge grip; a committed push falls
{ const { w } = lab(); const c = new Cat(w); c.reset([1.4, -0.35, -51], TUNING.cat.cruise);
  const ev = sim(c, 2.5, (t) => ({ steer: t > 0.2 && t < 0.32 ? 1 : 0 }), k => k.pos[2] < -61);
  check('ledge: a 120 ms flick outward does not throw the cat off', !fell(ev), `z ${c.pos[2].toFixed(1)}`); }
{ const { w } = lab(); const c = new Cat(w); c.reset([1.4, -0.35, -51], TUNING.cat.cruise);
  const ev = sim(c, 2.5, (t) => ({ steer: t > 0.2 ? 1 : 0 }), k => k.pos[2] < -61);
  check('ledge: a committed push outward does fall', fell(ev), `z ${c.pos[2].toFixed(1)}`); }
// 12. wide roof: a sideways drift never walks the cat off the side of a roof
{ const { w } = lab(); const c = new Cat(w); c.reset([2.6, -0.35, -60.5], TUNING.cat.cruise);
  const ev = sim(c, 0.8, (t) => ({ steer: t < 0.05 ? 1 : 0 }), k => k.pos[2] < -65);
  check('roof C: a tap of steer toward the edge does not drop the cat', !fell(ev), `x ${c.pos[0].toFixed(2)}`); }
// 13. tap vs hold: a short tap still clears the standard gap; holding goes higher and farther
{ const res = {};
  for (const [k, hold] of [['tap', 0.03], ['hold', 0.5]]) {
    const w = new World(); w.add(L.boxSpan(-5, 5, -14, 0, -200, 5, { walk: true, kind: 'building' }));
    const c = new Cat(w); c.reset([0, 0, 0], TUNING.cat.cruise);
    sim(c, 2, (t) => ({ jump: t < hold }), k => k.stats.lastJump);
    res[k] = c.stats.lastJump;
  }
  check('hold mode: tap and hold give distinct, both useful, jumps', res.tap.dist > 2.8 && res.hold.dist > res.tap.dist + 0.8,
    `tap: ${res.tap.dist.toFixed(2)} m / rise ${res.tap.rise.toFixed(2)} m / ${(res.tap.air * 1000).toFixed(0)} ms; hold: ${res.hold.dist.toFixed(2)} m / rise ${res.hold.rise.toFixed(2)} m / ${(res.hold.air * 1000).toFixed(0)} ms`); }
// 14. the tank platform is a real alternative route (needs a held jump)
{ const { w } = lab(); const c = new Cat(w); c.reset([2.2, -0.35, -34], TUNING.cat.cruise); let top = false;
  sim(c, 2, (t, k) => { if (k.grounded && k.pos[1] > 0.5) top = true; return { steer: toward(k, 2.2), jump: k.pos[2] < -36.2 && k.pos[2] > -37.6 }; }, k => k.pos[2] < -41);
  check('tank platform reachable with a held jump', top, `y ${c.pos[1].toFixed(2)}`); }
// 15. an autopilot completes the whole lab
{ const { w, L } = lab(); const c = new Cat(w); c.reset(L.spawn, 0);
  const plan = z => z > -11 ? 0 : z > -16 ? -0.6 : z > -24 ? 0 : z > -36 ? 0.25 : z > -46 ? 0.25 : z > -66 ? 1.4 : 0;
  const jumpAt = [[-29.4, -30.6], [-65.4, -66.4]];
  const ev = sim(c, 25, (t, k) => ({ steer: toward(k, plan(k.pos[2])), jump: jumpAt.some(([a, b]) => k.pos[2] < a && k.pos[2] > b) }), k => k.pos[2] < L.endZ);
  check('autopilot completes the lab', !fell(ev) && c.pos[2] < L.endZ, `z ${c.pos[2].toFixed(1)} events ${[...new Set(ev.map(e => e.type))].join(',')}`); }

// report: the same gaps with the jump input in 'tap' mode (every jump full height)
{ const was = TUNING.input.jumpMode; TUNING.input.jumpMode = 'tap';
  const g1 = window([0, 0, -20], -30, 0, 0.06, -0.35), g2 = window([1.4, -0.35, -61], -66, 1.4, 0.06, -1.6);
  console.log(`INFO tap mode: gap 1 window ${g1.ms.toFixed(0)} ms, gap 2 window ${g2.ms.toFixed(0)} ms (every jump full height)`);
  TUNING.input.jumpMode = was; }
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
