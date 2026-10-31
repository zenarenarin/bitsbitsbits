// Vertical-slice checks, driven through the real controller and hazards on
// the real slice geometry. Usage: node dev/test_move.js
const { TUNING, World, Cat, Hazards, buildSlice } = require('./load')();
const { routes } = require('./routes.js');
const route = routes();
const DT = 1 / 60;
let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

function slice() { const w = new World(); const S = buildSlice(w); const hz = new Hazards(w, S); return { w, S, hz }; }
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
    if (opts && opts.watch) opts.watch(cat);
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
const drive = name => { const p = route(name); return (t, k, hz) => p(k, hz, TUNING); };
function windowOf(start, edgeZ, lineX, hold, okFn, past) {
  const res = [];
  for (let dz = -2.5; dz <= 0.8; dz += 0.05) {
    const E = slice(), c = at(E, start); let pressed = false, pt = 0;
    const ev = sim(E, c, 4, (t, k) => { if (!pressed && k.pos[2] <= edgeZ - dz) { pressed = true; pt = t; } return { steer: toward(k, lineX), jump: pressed && t - pt < hold }; },
      k => k.grounded && k.pos[2] < edgeZ - (past || 1.6), { noHazards: true });
    res.push({ dz, good: !has(ev, 'fall') && c.grounded && okFn(c) });
  }
  const g = res.filter(r => r.good); if (!g.length) return { ms: 0 };
  const from = Math.min(...g.map(r => r.dz)), to = Math.max(...g.map(r => r.dz));
  return { ms: (to - from) / TUNING.cat.cruise * 1000, from, to, holes: res.filter(r => r.dz > from && r.dz < to && !r.good).length };
}

console.log('— act 1: roofs');
{ const E = slice(), c = at(E, E.S.spawn, 0); let t25 = 0;
  sim(E, c, 1.6, (t, k) => { if (Math.abs(t - 0.25) < DT / 2) t25 = k.fwd; return {}; }, k => k.pos[2] < -4.5);
  check('accelerates from rest', t25 > 1.5 && t25 < TUNING.cat.cruise - 1, `0.25 s: ${t25.toFixed(2)} m/s`); }
{ const E = slice(), c = at(E, [0, 0, -3]); let up = 9, down = 0, top = -9;
  const ev = sim(E, c, 3, (t, k) => { if (k.grounded && k.pos[2] < -6 && k.pos[2] > -8.5) up = Math.min(up, k.fwd); if (k.grounded && k.pos[2] < -10 && k.pos[2] > -12.5) down = Math.max(down, k.fwd); top = Math.max(top, k.pos[1]); return {}; }, k => k.pos[2] < -12.8);
  check('roof: climbs over the ridge, slower up than down', !has(ev, 'fall') && top > 1.2 && up < down - 0.5, `uphill ${up.toFixed(2)} downhill ${down.toFixed(2)} m/s`); }
{ const E = slice(), c = at(E, [0.2, 0.5, -11]);
  const ev = sim(E, c, 3, (t, k) => ({ steer: toward(k, 0.2) }), k => k.pos[2] < -16);
  check('alley: running off without a jump falls', has(ev, 'fall')); }
{ const r = windowOf([0.2, 0.5, -11], -13.25, 0.2, 0.06, c => c.pos[1] > 0.2);
  check('alley jump window (tap)', r.ms >= 150, `${r.ms.toFixed(0)} ms`); }
{ const E = slice(), c = at(E, [0.75, 0.25, -15.2]); let maxX = -9;
  const ev = sim(E, c, 1.6, (t, k) => { maxX = Math.max(maxX, k.pos[0]); return {}; }, k => k.pos[2] < -19);
  check('ridge: the slope draws an idle cat toward the eave, never off the roof', !has(ev, 'fall') && maxX > 1.2, `x 0.75 -> ${maxX.toFixed(2)}`); }
{ const E = slice(), c = at(E, [0.2, 0.5, -16]);
  const ev = sim(E, c, 2.5, (t, k) => ({ steer: toward(k, k.pos[2] > -21.5 ? -0.45 : 0.2) }), k => k.pos[2] < -25);
  check('ridge chimney: steering onto the slope goes around it', !has(ev, 'bump') && !has(ev, 'fall')); }
{ const E = slice(), c = at(E, [0.2, 0.5, -24]);
  const ev = sim(E, c, 2, (t, k) => ({ steer: toward(k, 0.2) }), k => k.pos[2] < -29.5);
  check('broken roof: no jump falls through', has(ev, 'fall')); }

console.log('— act 2: the junction');
{ const E = slice(), c = at(E, [0.2, 0.5, -28.5]);
  const ev = sim(E, c, 2, () => ({}), k => k.pos[2] < -36, { noHazards: true });
  check('wide pipe: runs from the ridge onto the pipe and the junction tank at full pace', !has(ev, 'fall') && c.fwd > TUNING.cat.cruise - 0.2 && c.ground.kind === 'tank', `on ${c.ground && c.ground.kind}, ${c.fwd.toFixed(2)} m/s`); }
{ const E = slice(), c = at(E, [0.45, 0.45, -37.5]);
  const ev = sim(E, c, 2.5, () => ({}), k => k.pos[2] < -50, { noHazards: true });
  check('wide pipe: starting off-centre, curvature + steadying keep the cat on', !has(ev, 'fall'), `x ${c.pos[0].toFixed(2)}`); }
{ const E = slice(), c = at(E, [0.2, 0.5, -31]); const v = E.hz.vents[0], H = TUNING.hazards, T = E.hz.ventCycle();
  E.hz.time = ((H.steamIdle + H.steamWarn + 0.15 - (40 - 31) / TUNING.cat.cruise - v.phase) % T + T) % T;
  const ev = sim(E, c, 2.4, (t, k) => ({ steer: toward(k, 0.2) }), k => k.pos[2] < -41.5);
  check('steam: running into a burst scalds and stops the cat', has(ev, 'scald')); }
{ let clean = 0;
  for (let s = 0; s < 8; s++) {
    const E = slice(), c = at(E, [0.2, 0.5, -34]); E.hz.time = s * 0.37;
    const ev = sim(E, c, 10, drive('centre'), k => k.pos[2] < -54.5);
    if (!has(ev, 'scald') && !has(ev, 'fall') && c.pos[2] < -54.5) clean++;
  }
  check('centre: timing both vents with the brake always gets through', clean === 8, `${clean}/8 start phases clean`); }
// high road
{ const E = slice(), c = at(E, [0.2, 0.5, -33.4]); let maxSpeed = 0, climbed = -9, onFor = 0;
  const ev = sim(E, c, 5, drive('high'), k => k.pos[2] < -44.8, { watch: k => { if (k.surf === 'balance') { onFor += DT; if (onFor > 0.4) maxSpeed = Math.max(maxSpeed, k.fwd); climbed = Math.max(climbed, k.pos[1]); } } });
  check('high road: the thin pipe is a balance surface (careful pace) that climbs to the scaffold', !has(ev, 'fall') && maxSpeed <= TUNING.cat.balanceSpeed + 0.05 && climbed > 1.45 && Math.abs(c.pos[1] - 1.7) < 0.05,
    `max ${maxSpeed.toFixed(2)} m/s, reached y ${c.pos[1].toFixed(2)}, fragment ${has(ev, 'fragment')}`); }
{ let ok8 = 0, worst = 0;
  for (let s = 0; s < 8; s++) {
    const E = slice(), c = at(E, [-1.3, 1.7, -45.6]); E.hz.time = s * 0.31; let drift = 0;
    const ev = sim(E, c, 4, () => ({}), k => k.pos[2] < -54, { watch: k => { if (k.surf === 'bridge') drift = Math.max(drift, Math.abs(k.pos[0] - (-1.25))); } });
    if (!has(ev, 'fall') && c.pos[2] < -54 && has(ev, 'fragment')) ok8++;
    worst = Math.max(worst, drift);
  }
  check('rope bridge: it sways and carries the cat, but an idle stick still crosses and takes the fragment', ok8 === 8 && worst > 0.06, `${ok8}/8 phases, carried up to ${worst.toFixed(2)} m sideways`); }
{ const E = slice(), c = at(E, [-1.25, 1.7, -47.2]);
  const ev = sim(E, c, 3, (t) => ({ steer: t > 0.2 ? -1 : 0 }), k => k.grounded && k.pos[2] < -54);
  check('rope bridge: a committed push off the side falls', has(ev, 'fall')); }
// low road
{ const E = slice(), c = at(E, [0.2, 0.5, -33.4]); let crouched = false;
  const ev = sim(E, c, 5, (t, k, hz) => route('low')(k, hz, TUNING), k => k.pos[2] < -43.5, { watch: k => { if (k.crouch && k.grounded) crouched = true; } });
  // the crawl: speed once the cat has settled under the duct
  const peak = (() => { let m = 0, n = 0; const E2 = slice(), c2 = at(E2, [1.9, -1.0, -39.5]); sim(E2, c2, 1.2, () => ({ steer: toward(c2, 1.9) }), k => k.pos[2] < -42.3, { watch: k => { if (k.crouch && ++n > 24) m = Math.max(m, k.fwd); } }); return m; })();
  check('low road: drops off the tank onto the sunken catwalk and crawls under the duct', !has(ev, 'fall') && !has(ev, 'bump') && crouched && peak <= TUNING.cat.crawlSpeed + 0.05 && Math.abs(c.pos[1] + 1) < 0.05, `crawl ${peak.toFixed(2)} m/s, y ${c.pos[1].toFixed(2)}`); }
{ const E = slice(), c = at(E, [1.9, -1.0, -43.5]);
  const ev = sim(E, c, 1.5, (t, k) => ({ steer: toward(k, 1.9) }), k => k.pos[2] < -46);
  check('low road: the pipe across the walkway must be hopped', has(ev, 'bump')); }
{ const E = slice(), c = at(E, [1.9, -1.0, -43.5]);
  const ev = sim(E, c, 3, (t, k, hz) => route('low')(k, hz, TUNING), k => k.pos[2] < -56);
  check('low road: hop it, then the ramp climbs back to the machine platform', !has(ev, 'bump') && !has(ev, 'fall') && Math.abs(c.pos[1] - 0.1) < 0.05, `y ${c.pos[1].toFixed(2)} at z ${c.pos[2].toFixed(1)}`); }

console.log('— act 3: the catwalk');
{ const E = slice(), c = at(E, [-0.15, 0.1, -62]);
  const ev = sim(E, c, 2.5, (t, k) => ({ steer: toward(k, -0.15) }), k => k.grounded && k.pos[2] < -67);
  check('broken catwalk: no jump falls through the gap', has(ev, 'fall')); }
{ const r = windowOf([-0.15, 0.1, -61.3], -64.5, -0.15, 0.06, c => Math.abs(c.pos[1] - 0.1) < 0.05, 2.4);
  check('broken catwalk jump window (tap)', r.ms >= 150, `${r.ms.toFixed(0)} ms`); }
{ const E = slice(), c = at(E, [-0.15, 0.1, -66.6]); let crouched = false;
  const ev = sim(E, c, 1.2, (t, k) => { if (k.crouch) crouched = true; return { steer: toward(k, -0.15) }; }, k => k.pos[2] < -69);
  check('catwalk: ducks under the low pipe without a bump', crouched && !has(ev, 'bump')); }
{ const E = slice(), c = at(E, [-0.15, 0.1, -68.6]);
  const ev = sim(E, c, 2, (t, k) => ({ steer: toward(k, -0.15) }), k => k.pos[2] < -74);
  check('unstable section: crossing at pace makes it', has(ev, 'creak') && !has(ev, 'fall')); }
{ const E = slice(), c = at(E, [-0.15, 0.1, -70.2], 1.5);
  const ev = sim(E, c, 4, (t, k) => ({ steer: toward(k, -0.15), pace: -1 }), k => k.pos[2] < -74);
  check('unstable section: stopping on it gives way', has(ev, 'give') && has(ev, 'fall')); }
{ const r = windowOf([0, 0.1, -78.4], -84, 0, 0.06, c => Math.abs(c.pos[1] + 1.6) < 0.05);
  check('final gap window (tap)', r.ms >= 180, `${r.ms.toFixed(0)} ms`); }

console.log('— full runs: the route decides the charge');
for (const [name, want] of [['high', 5], ['centre', 2], ['low', 2]]) {
  const E = slice(), c = at(E, E.S.spawn, 0);
  const ev = sim(E, c, 40, drive(name), () => E.hz.relay.active);
  const t = ev.length ? ev[ev.length - 1].t : 0;
  check(`full run, ${name} road: ${want}/5 fragments, all waypoints woken, relay`, !has(ev, 'fall') && E.hz.charge === want && E.hz.relay.active && E.hz.waypoints.every(w => w.active),
    `${E.hz.charge}/5, ${E.hz.waypoints.filter(w => w.active).length}/3 waypoints, ${t.toFixed(1)} s${has(ev, 'fall') ? ', FELL at z ' + ev.find(e => e.type === 'fall').z.toFixed(1) : ''}`);
}

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
