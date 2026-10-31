// Vertical-slice checks, driven through the real controller and hazards on
// the real slice geometry. Usage: node dev/test_move.js
const { TUNING, World, Cat, Hazards, buildSlice, boxSpan } = require('./load')();
const DT = 1 / 60;
let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

function slice() { const w = new World(); const S = buildSlice(w); const hz = new Hazards(w, S); return { w, S, hz }; }
// inputFn(t, cat, hz) -> { steer, pace, jump }; hazards optional (vents off when null)
function sim(env, cat, secs, inputFn, until, opts) {
  const ev = []; let prevHeld = false;
  for (let i = 0; i < secs / DT; i++) {
    const inp = inputFn ? inputFn(i * DT, cat, env.hz) : {};
    const held = !!inp.jump;
    cat.step(DT, { steer: inp.steer || 0, pace: inp.pace || 0, jumpPressed: held && !prevHeld, jumpHeld: held });
    prevHeld = held;
    if (!(opts && opts.noHazards)) for (const e of env.hz.step(DT, cat)) ev.push(Object.assign({ t: i * DT, z: cat.pos[2] }, e));
    for (const e of cat.events) ev.push(Object.assign({ t: i * DT, z: cat.pos[2], y: cat.pos[1] }, e));
    cat.events.length = 0;
    if (ev.some(e => e.type === 'fall')) break;
    if (until && until(cat)) break;
  }
  return ev;
}
const has = (ev, t) => ev.some(e => e.type === t);
const toward = (cat, x) => Math.max(-1, Math.min(1, (x - cat.pos[0]) * 2.5));
// start on the real surface under (x, z), like the game's checkpoints do
const at = (env, p, speed) => {
  const g = env.w.groundAt(p[0], p[2], p[1] + 1.5, 0.05, 0.05);
  const c = new Cat(env.w); c.reset([p[0], g.box ? g.y : p[1], p[2]], speed === undefined ? TUNING.cat.cruise : speed);
  if (g.box) { c.grounded = true; c.ground = g.box; c.lastGroundY = g.y; }
  return c;
};

// 1. a standstill start on the terrace has weight
{ const E = slice(), c = at(E, E.S.spawn, 0); let t25 = 0;
  sim(E, c, 1.6, (t, k) => { if (Math.abs(t - 0.25) < DT / 2) t25 = k.fwd; return {}; }, k => k.pos[2] < -4.5);
  check('accelerates from rest', t25 > 1.5 && t25 < TUNING.cat.cruise - 1, `0.25 s: ${t25.toFixed(2)} m/s`); }
// 2. up and over the first tiled roof: slower climbing, faster descending, no falls
{ const E = slice(), c = at(E, [0, 0, -3]); let up = 9, down = 0, top = -9;
  const ev = sim(E, c, 3, (t, k) => { if (k.grounded && k.pos[2] < -6 && k.pos[2] > -8.5) up = Math.min(up, k.fwd); if (k.grounded && k.pos[2] < -10 && k.pos[2] > -12.5) down = Math.max(down, k.fwd); top = Math.max(top, k.pos[1]); return {}; }, k => k.pos[2] < -12.8);
  check('roof B: climbs over the ridge, slower up than down', !has(ev, 'fall') && top > 1.2 && up < down - 0.5, `uphill ${up.toFixed(2)} downhill ${down.toFixed(2)} m/s, crest ${top.toFixed(2)} m`); }
// 3. the alley: no jump falls in; a jump lands on the ridge of roof C
{ const E = slice(), c = at(E, [0.2, 0.5, -11]);
  const ev = sim(E, c, 3, (t, k) => ({ steer: toward(k, 0.2) }), k => k.pos[2] < -16);
  check('alley: running off without a jump falls', has(ev, 'fall'), `y ${c.pos[1].toFixed(2)}`); }
function windowOf(start, edgeZ, lineX, hold, okFn) {
  const res = [];
  for (let dz = -2.5; dz <= 0.8; dz += 0.05) {
    const E = slice(), c = at(E, start); let pressed = false, pt = 0;
    const ev = sim(E, c, 4, (t, k) => { if (!pressed && k.pos[2] <= edgeZ - dz) { pressed = true; pt = t; } return { steer: toward(k, lineX), jump: pressed && t - pt < hold }; },
      k => k.grounded && k.pos[2] < edgeZ - 1.6, { noHazards: true });
    res.push({ dz, good: !has(ev, 'fall') && c.grounded && okFn(c) });
  }
  const g = res.filter(r => r.good); if (!g.length) return { ms: 0 };
  const from = Math.min(...g.map(r => r.dz)), to = Math.max(...g.map(r => r.dz));
  return { ms: (to - from) / TUNING.cat.cruise * 1000, from, to, holes: res.filter(r => r.dz > from && r.dz < to && !r.good).length };
}
{ const r = windowOf([0.2, 0.5, -11], -13.25, 0.2, 0.06, c => c.pos[1] > 0.2);
  check('alley jump window (tap)', r.ms >= 150, `${r.ms.toFixed(0)} ms (press ${r.from} to ${r.to} m past the eave, ${r.holes} holes)`); }
// 4. ridge run: with the stick idle the slope pulls the cat toward the eave, but never off the roof
{ const E = slice(), c = at(E, [0.75, 0.25, -15.2]); let minX = 9, maxX = -9;
  const ev = sim(E, c, 1.6, (t, k) => { minX = Math.min(minX, k.pos[0]); maxX = Math.max(maxX, k.pos[0]); return {}; }, k => k.pos[2] < -19);
  check('ridge: an idle stick slides toward the eave but keeps the cat on the roof', !has(ev, 'fall') && maxX > 1.2, `x drifted ${(0.75).toFixed(2)} -> ${maxX.toFixed(2)}, y ${c.pos[1].toFixed(2)}`); }
// 5. chimney on the ridge: straight on bumps; steering around passes
{ const E = slice(), c = at(E, [0.2, 0.5, -16]);
  const ev = sim(E, c, 1.4, (t, k) => ({ steer: toward(k, 0.2) }), k => k.pos[2] < -21);
  check('ridge chimney: running into it stumbles', has(ev, 'bump'), ev.map(e => e.type).join(',')); }
{ const E = slice(), c = at(E, [0.2, 0.5, -16]);
  const ev = sim(E, c, 2.5, (t, k) => ({ steer: toward(k, k.pos[2] > -21.5 ? -0.45 : 0.2) }), k => k.pos[2] < -25);
  check('ridge chimney: steering onto the slope goes around it', !has(ev, 'bump') && !has(ev, 'fall') && c.pos[2] < -25, `z ${c.pos[2].toFixed(1)}`); }
// 6. the broken roof section must be jumped
{ const E = slice(), c = at(E, [0.2, 0.5, -24]);
  const ev = sim(E, c, 2, (t, k) => ({ steer: toward(k, 0.2) }), k => k.pos[2] < -29.5);
  check('broken roof: no jump falls through', has(ev, 'fall'), `y ${c.pos[1].toFixed(2)}`); }
{ const E = slice(), c = at(E, [0.2, 0.5, -24]);
  const ev = sim(E, c, 2, (t, k) => ({ steer: toward(k, 0.2), jump: k.pos[2] < -25.55 && k.pos[2] > -25.95 }), k => k.pos[2] < -29.5);
  check('broken roof: a jump clears it', !has(ev, 'fall') && c.grounded, `z ${c.pos[2].toFixed(1)}`); }
// 7. onto the great pipe and along it, stick idle (vents off)
{ const E = slice(), c = at(E, [0.2, 0.5, -28.5]);
  const ev = sim(E, c, 4, () => ({}), k => k.pos[2] < -46.5, { noHazards: true });
  check('great pipe: runs on from the ridge and along it with the stick idle', !has(ev, 'fall') && c.pos[2] < -46.5, `z ${c.pos[2].toFixed(1)}`); }
{ const E = slice(), c = at(E, [0.45, 0.45, -31]);
  const ev = sim(E, c, 3, () => ({}), k => k.pos[2] < -45, { noHazards: true });
  check('great pipe: starting off-centre, curvature + steadying keep the cat on', !has(ev, 'fall'), `x ${c.pos[0].toFixed(2)}`); }
{ const E = slice(), c = at(E, [0.2, 0.5, -31]);
  const ev = sim(E, c, 3, (t) => ({ steer: t > 0.3 ? 1 : 0 }), k => k.pos[2] < -45, { noHazards: true });
  check('great pipe: a committed push off the side falls', has(ev, 'fall'), `x ${c.pos[0].toFixed(2)}`); }
// 8. steam: running blind into a burst scalds; braking to let it pass gets through clean
{ const E = slice(), c = at(E, [0.2, 0.5, -31]);
  // arrive while the first vent is bursting
  const v = E.hz.vents[0], H = TUNING.hazards, T = E.hz.ventCycle();
  const arrive = (36.2 - 31) / TUNING.cat.cruise;
  E.hz.time = ((H.steamIdle + H.steamWarn + 0.15 - arrive - v.phase) % T + T) % T;
  const ev = sim(E, c, 1.6, () => ({}), k => k.pos[2] < -37.5);
  check('steam: running into a burst scalds and stops the cat', has(ev, 'scald'), ev.filter(e => e.type === 'scald').map(e => 'scald at z ' + e.z.toFixed(1)).join(',')); }
// how a player times a vent: hold back while it is hissing or bursting, and go
// only when it will stay idle for the whole crossing at running pace
const steamPilot = (k, hz) => {
  for (const v of hz.vents) {
    const d = k.pos[2] - v.z - 0.7;              // distance to the edge of the steam
    if (d < 0 || d > 2.4) continue;              // committed, or still far
    // time to clear the steam from the current speed, with the cat's real acceleration
    const dist = d + 1.4, a = TUNING.cat.accel * (1 + TUNING.cat.startBoost), v0 = k.fwd;
    const cross = (-v0 + Math.sqrt(v0 * v0 + 2 * a * dist)) / a + 0.2;
    for (let t = 0; t <= cross; t += 0.05) if (hz.ventAt(v, hz.time + t).state !== 'idle') return -1;
  }
  return 0;
};
{ const E = slice(), c = at(E, [0.2, 0.5, -31]); let seeds = 0, clean = 0;
  for (let s = 0; s < 8; s++) {
    const E2 = slice(), c2 = at(E2, [0.2, 0.5, -31]); E2.hz.time = s * 0.37;
    const ev = sim(E2, c2, 8, (t, k, hz) => ({ steer: toward(k, 0.2), pace: steamPilot(k, hz) }), k => k.pos[2] < -46);
    seeds++; if (!has(ev, 'scald') && !has(ev, 'fall') && c2.pos[2] < -46) clean++;
  }
  void c; void E;
  check('steam: timing the vents with the brake always gets through', clean === seeds, `${clean}/${seeds} start phases clean`); }
// 9. the junction and the narrow pipe
{ const E = slice(), c = at(E, [0.2, 0.5, -31]); let onNarrow = false;
  const ev = sim(E, c, 4, (t, k) => { if (k.ground && k.ground.narrow) onNarrow = true; return { steer: toward(k, k.pos[2] > -32.4 ? 0.2 : -1.2) }; }, k => k.pos[2] < -46.3);
  check('junction: drops onto the valve and takes the narrow pipe, no steam on it', onNarrow && !has(ev, 'fall') && !has(ev, 'scald') && c.pos[2] < -46.3, `z ${c.pos[2].toFixed(1)}`); }
{ const E = slice(), c = at(E, [-1.2, 0.1, -34]);
  const ev = sim(E, c, 3, () => ({}), k => k.pos[2] < -46.3);
  check('narrow pipe: crosses with the stick idle', !has(ev, 'fall') && c.pos[2] < -46.3, `z ${c.pos[2].toFixed(1)}`); }
{ const E = slice(), c = at(E, [-1.2, 0.1, -34]);
  const ev = sim(E, c, 3, (t) => ({ steer: t > 0.3 && t < 0.42 ? 1 : 0 }), k => k.pos[2] < -46.3);
  check('narrow pipe: a 120 ms flick does not throw the cat off', !has(ev, 'fall'), `x ${c.pos[0].toFixed(2)}`); }
// 10. catwalk: squeezes under the low pipe
{ const E = slice(), c = at(E, [-0.15, 0.1, -48.6]); let crouched = false;
  const ev = sim(E, c, 1.4, (t, k) => { if (k.crouch) crouched = true; return { steer: toward(k, -0.15) }; }, k => k.pos[2] < -53);
  check('catwalk: ducks under the low pipe without a bump', crouched && !has(ev, 'bump'), `z ${c.pos[2].toFixed(1)}`); }
// 11. the unstable section: keep moving and it holds long enough; stall and it drops
{ const E = slice(), c = at(E, [-0.15, 0.1, -53]);
  const ev = sim(E, c, 2, (t, k) => ({ steer: toward(k, -0.15) }), k => k.pos[2] < -58);
  check('unstable catwalk: crossing at pace makes it', has(ev, 'creak') && !has(ev, 'fall'), ev.filter(e => /creak|give/.test(e.type)).map(e => e.type + '@' + e.z.toFixed(1)).join(' ')); }
{ const E = slice(), c = at(E, [-0.15, 0.1, -54.6], 1.5);
  const ev = sim(E, c, 4, (t, k) => ({ steer: toward(k, -0.15), pace: -1 }), k => k.pos[2] < -58);
  check('unstable catwalk: stopping on it gives way', has(ev, 'give') && has(ev, 'fall'), `${ev.map(e => e.type).join(',')} at z ${c.pos[2].toFixed(1)}`); }
// 12. the last fragment hangs above the walkway: only a jump reaches it
{ const E = slice(), c = at(E, [-0.15, 0.1, -57.2]);
  sim(E, c, 1, (t, k) => ({ steer: toward(k, -0.15) }), k => k.pos[2] < -61);
  const no = E.hz.charge;
  const E2 = slice(), c2 = at(E2, [-0.15, 0.1, -57.2]);
  sim(E2, c2, 1, (t, k) => ({ steer: toward(k, -0.15), jump: k.pos[2] < -58.6 && k.pos[2] > -58.9 }), k => k.pos[2] < -61);
  check('catwalk fragment: missed by running, taken by jumping', no === 0 && E2.hz.charge === 1, `run ${no}, jump ${E2.hz.charge}`); }
// 13. the drop onto the relay terrace
{ const r = windowOf([0, 0.1, -62.4], -68, 0, 0.06, c => Math.abs(c.pos[1] + 1.6) < 0.05);
  check('final gap window (tap)', r.ms >= 180, `${r.ms.toFixed(0)} ms (press ${r.from} to ${r.to}, ${r.holes} holes)`); }
// 14. a full run: narrow line, all fragments, steam-free pipe, relay
const pilot = (k, hz) => {
  const z = k.pos[2];
  const x = z > -9 ? 0 : z > -13.5 ? 0.2 : z > -19 ? 0.2 : z > -21.6 ? -0.45 : z > -23 ? -0.75 : z > -32.4 ? 0.2 : z > -46.3 ? -1.2 : z > -63 ? -0.15 : 0;
  const jump = (z < -12.85 && z > -13.25) || (z < -25.55 && z > -25.95) || (z < -58.6 && z > -58.9) || (z < -67.4 && z > -67.9);
  return { steer: toward(k, x), jump, pace: steamPilot(k, hz) };
};
{ const E = slice(), c = at(E, E.S.spawn, 0);
  const ev = sim(E, c, 30, (t, k, hz) => pilot(k, hz), k => E.hz.relay.active);
  const t = ev.length ? ev[ev.length - 1].t : 0;
  check('a full run: three fragments, then the relay', !has(ev, 'fall') && E.hz.charge === 3 && E.hz.relay.active,
    `fragments ${E.hz.charge}/3, relay ${E.hz.relay.active}, ${t.toFixed(1)} s, events ${[...new Set(ev.map(e => e.type))].join(',')}`); }

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
