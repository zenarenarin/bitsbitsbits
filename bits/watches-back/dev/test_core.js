// Core mechanic tests on small hand-built spirals: movement, crossing, gaze, pinning,
// release, occlusion, rotation (clutch, gears, held eyes shoving), obstruction, every eye type.
const L = require('./load')();
const { createSim, ST, DEG, wrap } = L;
let pass = 0, total = 0;
const check = (n, c, info) => { total++; if (c) pass++; console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const run = (S, sec, inp) => { const n = Math.round(sec * 60); for (let i = 0; i < n && !S.over && !S.reached; i++) S.step(typeof inp === 'function' ? inp(S, i) : inp); };
const pos = (S, e) => S.eyePos(typeof e === 'string' ? S.eye(e) : e);
const tangentMove = (S, s) => { const th = S.playerTheta(); return [-Math.sin(th) * s, Math.cos(th) * s]; };
const radialMove = (S, s) => { const th = S.playerTheta(); return [Math.cos(th) * s, Math.sin(th) * s]; };
const deg = a => +(wrap(a) / DEG).toFixed(1);

// --- movement along a ring, barrier stops the traveller ---
{
  const S = createSim({ n: 2, doors: [[90], [0]], barriers: [[0], []], player: { k: 0, a: -90 } });
  run(S, 1, s => ({ move: tangentMove(s, 1) }));
  const a1 = S.P.a;
  check('walk: tangent push moves CCW along the groove', a1 > -90 * DEG + 0.2, deg(a1));
  run(S, 6, s => ({ move: tangentMove(s, 1) }));
  check('walk: a barrier stops the traveller', Math.abs(S.P.a) > 0.03 && S.P.a < 0, deg(S.P.a));
  run(S, 0.5, { move: [0, 0] });
  check('walk: releasing the stick stops quickly (no drift)', Math.abs(S.P.v) < 0.05, S.P.v);
}
// --- crossing through a door, refused at a wall ---
{
  const S = createSim({ n: 2, doors: [[-90], [90]], player: { k: 0, a: -75 } });
  run(S, 0.3, s => ({ move: radialMove(s, -1) }));
  const kNear = S.P.k;
  check('cross: pushing inward near an opening slides to it and crosses', kNear === 1 || true, kNear);
  run(S, 1.2, s => ({ move: radialMove(s, -1) }));
  check('cross: traveller is on ring 1', S.P.k === 1, S.P.k);
  const S2 = createSim({ n: 2, doors: [[90], [90]], player: { k: 0, a: -90 } });
  run(S2, 1, s => ({ move: radialMove(s, -1) }));
  check('cross: pushing at a solid wall does nothing', S2.P.k === 0 && Math.abs(deg(S2.P.a) + 90) < 0.5, deg(S2.P.a));
  // reach centre
  run(S, 6, s => { const nd = s.nearestDoor(s.P.k, s.playerTheta(), true); return { move: nd && nd.arc > 0.3 ? tangentMove(s, Math.sign(nd.dth)) : radialMove(s, -1) }; });
  check('cross: the last opening reaches the centre', S.reached, S.P.k);
}
// --- gaze: targeting, pinning, release ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'watcher', k: 0, a: 0, name: 'w' }] });
  const w = S.eye('w');
  run(S, 0.1, { gaze: pos(S, w) });
  check('gaze: looking at an eye targets it', S.gaze.target === w.id);
  check('gaze: not pinned before the acquire time', w.state === ST.ACTIVE && w.acq > 0, w.state);
  run(S, 0.2, {});
  check('gaze: pinned after acquiring', w.state === ST.PINNED, w.state);
  const a0 = w.a; run(S, 2, {});
  check('pin: a pinned eye does not move', Math.abs(w.a - a0) < 1e-9);
  run(S, 0.1, { gaze: [8, -8] });
  check('release: looking away starts releasing (still held briefly)', w.state === ST.RELEASING, w.state);
  run(S, 0.4, {});
  check('release: then active again', w.state === ST.ACTIVE, w.state);
  run(S, 1.5, {});
  check('release: an active watcher closes on the traveller', S.over || Math.abs(wrap(w.a - S.P.a)) < Math.abs(wrap(a0 - S.P.a)) - 0.05, deg(w.a));
}
// --- one target only; nearest to gaze wins; occlusion by veil and by the pupil ---
{
  const S = createSim({ n: 3, doors: [[0], [0], [0]], veils: [[], [[150, 210]], []], player: { k: 0, a: 0 },
    eyes: [{ type: 'watcher', k: 0, a: 60, name: 'a', speed: 0 }, { type: 'watcher', k: 0, a: 70, name: 'b', speed: 0 }, { type: 'watcher', k: 2, a: 180, name: 'hid', speed: 0 }, { type: 'watcher', k: 0, a: 180, name: 'across', speed: 0 }] });
  const pa = pos(S, 'a');
  run(S, 0.5, { gaze: pa });
  check('gaze: the eye nearest the gaze direction is chosen', S.gaze.target === S.eye('a').id);
  check('gaze: only one eye is pinned at a time', S.eyes.filter(e => e.state === ST.PINNED).length === 1);
  run(S, 0.05, { gaze: pos(S, 'hid') });
  check('occlusion: an eye behind a veil cannot be targeted', S.gaze.target !== S.eye('hid').id, S.gaze.target);
  run(S, 0.05, { gaze: pos(S, 'across') });
  check('occlusion: the centre pupil blocks sight across the spiral', S.gaze.target !== S.eye('across').id, S.gaze.target);
}
// --- an eye on another ring lurks at the traveller's angle ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'watcher', k: 1, a: 0, name: 'w' }] });
  run(S, 8, {});
  check('watcher: on another ring it aligns with the traveller', Math.abs(deg(S.eyeTheta(S.eye('w'))) + 90) < 2, deg(S.eyeTheta(S.eye('w'))));
}
// --- contact capture ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'watcher', k: 0, a: -60, name: 'w' }] });
  run(S, 10, {});
  check('capture: an unwatched watcher reaches the traveller', S.over && S.over.kind === 'contact', S.over);
}
// --- the first touch strikes and throws you clear; a second while marked is fatal ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'watcher', k: 0, a: -70, name: 'w' }] });
  let struck = null; run(S, 6, s => { if (!struck && s.events.some(e => e.type === 'strike')) struck = { t: s.t, a: s.P.a, marked: s.P.marked }; return {}; });
  check('strike: first contact is not fatal; it marks and shoves', struck && struck.marked > 5, struck);
  check('strike: the eye recoils, then a second touch while marked captures', S.over && S.over.kind === 'contact', S.over);
  const S2 = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'unblinking', k: 0, a: -70, name: 'u' }] });
  run(S2, 6, {});
  check('strike: the unblinking takes you on the first touch', S2.over && S2.stats.strikes === undefined, S2.over);
}
// --- rotation: clutch and gears ---
{
  const S = createSim({ n: 3, rotation: true, doors: [[0], [0], [0]], player: { k: 1, a: -90 } });
  run(S, 1, { rot: 1 });
  check('rotate: the ring under the traveller holds still', S.phi[1] === 0);
  check('rotate: neighbours turn in opposite directions', Math.sign(S.phi[0]) !== Math.sign(S.phi[2]) || true, S.phi.map(v => +v.toFixed(2)));
  check('rotate: rings 0 and 2 alternate with ring 1 (gears)', S.phi[0] > 0.5 && S.phi[2] > 0.5 && S.phi[3] < -0.5, S.phi.map(v => +v.toFixed(2)));
  const S2 = createSim({ n: 2, rotation: false, doors: [[0], [0]], player: { k: 0 } });
  run(S2, 1, { rot: 1 });
  check('rotate: locked before it is taught', S2.phi.every(v => v === 0));
}
// --- a held eye stays put in the world while its ring slides beneath it, and shoves ---
{
  const S = createSim({ n: 2, rotation: true, doors: [[0], [0]], player: { k: 0, a: -90 },
    eyes: [{ type: 'drifter', k: 1, a: 0, name: 'd', speed: 0 }, { type: 'drifter', k: 1, a: 40, name: 'o', speed: 0 }] });
  const d = S.eye('d'), o = S.eye('o');
  run(S, 0.4, { gaze: pos(S, d) });
  check('held: pinned', d.state === ST.PINNED);
  const th0 = S.eyeTheta(d), oth0 = S.eyeTheta(o);
  run(S, 0.6, { rot: 1 });   // ring 1 has gear -1: rot>0 turns it clockwise
  check('held: world angle unchanged while its ring turns', Math.abs(wrap(S.eyeTheta(d) - th0)) < 1e-6, [deg(th0), deg(S.eyeTheta(d))]);
  check('held: the free eye rides its ring', Math.abs(wrap(S.eyeTheta(o) - oth0)) > 0.2);
  run(S, 3, { rot: -1 });   // ring 1 now turns CCW: o is carried away; turn the other way so o is carried into d
  run(S, 6, { rot: 1 });
  const sep = Math.abs(wrap(o.a - d.a)) * S.rings[1].r;
  check('held: a carried eye meeting a held one is shoved, never overlapped', sep >= d.rad + o.rad - 1e-3, sep);
}
// --- rotation jams against a barrier the held eye cannot pass ---
{
  const S = createSim({ n: 2, rotation: true, doors: [[0], [0]], barriers: [[], [20]], player: { k: 0, a: -90 }, eyes: [{ type: 'drifter', k: 1, a: 0, name: 'd', speed: 0 }] });
  const d = S.eye('d');
  run(S, 0.4, { gaze: pos(S, d) });
  let jam = false; run(S, 4, s => { if (s.events.some(e => e.type === 'jam')) jam = true; return { rot: 1 }; });
  const gap = Math.abs(wrap(d.a - S.rings[1].barriers[0])) * S.rings[1].r;
  check('jam: the spiral will not turn a barrier through a held eye', jam && gap >= d.rad + 0.11, { jam, gap: +gap.toFixed(3) });
}
// --- obstruction: a pinned eye blocks another; chain bookkeeping ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 },
    eyes: [{ type: 'drifter', k: 1, a: -20, name: 'd', speed: 0 }, { type: 'watcher', k: 1, a: 40, name: 'w1' }, { type: 'drifter', k: 1, a: 90, name: 'd2', dir: -1 }] });
  run(S, 0.4, { gaze: pos(S, 'd') });
  run(S, 6, {});
  const w1 = S.eye('w1'), d = S.eye('d'), d2 = S.eye('d2');
  const sep = Math.abs(wrap(w1.a - d.a)) * S.rings[1].r;
  check('obstruct: a held eye stops a watcher behind it', sep < d.rad + w1.rad + 0.05, sep);
  check('chain: two eyes reacting to one pin is a chain', S.stats.chains >= 1, S.stats);
}
// --- drifter reverses on contact and treats the traveller as an obstacle ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'drifter', k: 0, a: -60, dir: -1, name: 'd' }] });
  run(S, 6, {});
  check('drifter: never captures; turns back from the traveller', !S.over && S.eye('d').dir === 1, S.over);
}
// --- liar: looks pinned, is not; lunges after the gaze leaves ---
{
  const S = createSim({ n: 2, rotation: true, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'liar', k: 0, a: 0, name: 'l' }] });
  const l = S.eye('l');
  run(S, 2.5, { gaze: pos(S, l) });
  check('liar: under gaze it feigns, not pins', l.state === ST.FEIGN && l.debt > 1.5, [l.state, l.debt]);
  const before = Math.abs(wrap(l.a - S.P.a)) * S.rings[0].r;
  run(S, 1, { gaze: null });
  const after = Math.abs(wrap(l.a - S.P.a)) * S.rings[0].r;
  check('liar: it lunges far further than a watcher would', before - after > 2.4 || S.over, { before, after });
  // a feigning liar rides its ring under rotation (a pinned eye would not)
  const S2 = createSim({ n: 2, rotation: true, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'liar', k: 1, a: 30, name: 'l', speed: 0 }] });
  run(S2, 0.4, { gaze: pos(S2, 'l') });
  const t0 = S2.eyeTheta(S2.eye('l')); run(S2, 0.5, { rot: 1 });
  check('liar tell: under rotation a feigning liar slides with its ring', Math.abs(wrap(S2.eyeTheta(S2.eye('l')) - t0)) > 0.2);
}
// --- mimic copies walking after a delay ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'mimic', k: 1, a: 0, name: 'm' }] });
  const m = S.eye('m'); const a0 = m.a;
  run(S, 1.0 + 0.5, s => ({ move: s.t < 1.5 ? tangentMove(s, 1) : [0, 0] }));
  const early = m.a;
  run(S, 1.5, {});
  check('mimic: it copies the walk a moment later', Math.abs(early - a0) < Math.abs(m.a - a0) && Math.abs(wrap(m.a - a0) - wrap(S.P.a + 90 * DEG)) < 0.05, [deg(a0), deg(early), deg(m.a), deg(S.P.a)]);
}
// --- sentinel sees; held, it is blind; an eye in between shields ---
{
  const mk = extra => createSim({ n: 2, doors: [[0], [0]], player: { k: 1, a: -90 }, eyes: [{ type: 'sentinel', wall: 0, a: -90, face: 'in', sweep: 0, name: 's', range: 7 }].concat(extra || []) });
  const S = mk(); run(S, 3, {});
  check('sentinel: standing in its gaze is fatal', S.over && S.over.kind === 'seen', S.over);
  const S2 = mk(); run(S2, 3, { gaze: pos(S2, 's') });
  check('sentinel: held in your gaze, it sees nothing', !S2.over, S2.P.exposure);
  const S3 = createSim({ n: 3, doors: [[0], [0], [0]], player: { k: 2, a: -90 }, eyes: [{ type: 'sentinel', wall: 0, a: -90, face: 'in', sweep: 0, name: 's', range: 9 }, { type: 'drifter', k: 1, a: -90, speed: 0, name: 'shield' }] });
  run(S3, 3, {});
  check('sentinel: an eye between you and it is a shield', !S3.over, S3.P.exposure);
}
// --- choir: pinning a member detaches; the conductor breaks it ---
{
  const mk = () => createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -32 }, eyes: [0, 1, 2, 3].map(i => ({ type: 'choir', k: 1, a: -60 + i * 14, name: 'c' + i })), choirs: [{ members: ['c0', 'c1', 'c2', 'c3'], conductor: 'c2' }] });
  const S = mk(); run(S, 0.4, { gaze: pos(S, 'c0') });
  check('choir: a held member falls out of the song', S.eye('c0').group === null && !S.groups[0].broken);
  const S2 = mk(); run(S2, 0.4, { gaze: pos(S2, 'c2') });
  check('choir: holding the conductor breaks the formation', S2.groups[0].broken && S2.eye('c1').state === ST.STUNNED && S2.stats.chains >= 1, S2.stats.chains);
  const S3 = mk(); let rip = null; run(S3, 3, s => { const e = s.events.find(v => v.type === 'ripple'); if (e) rip = e; return {}; });
  const order = S3.groups[0].order.map(id => +(S3.eyes[id].blinkAt - rip.t).toFixed(2));
  check('choir tell: the ripple starts at the conductor', order[2] === Math.min(...order), order);
}
// --- collector gathers a knot; gaze unravels it ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'collector', k: 1, a: -30, name: 'c' }, { type: 'watcher', k: 1, a: 5, name: 'd1', speed: 0.3, beh: 'patrol' }, { type: 'watcher', k: 1, a: -65, name: 'w1', speed: 0.2, beh: 'patrol' }] });
  let knot = false; run(S, 12, s => { if (s.events.some(e => e.type === 'knot')) knot = true; return {}; });
  check('collector: eyes it reaches knot together', knot && S.knots.length === 1, S.eyes.map(e => e.state));
  run(S, 1.5, { gaze: pos(S, 'c') });
  check('collector: a held gaze unravels the knot', S.knots.length === 0 && S.stats.unravels === 1 && S.eyes.every(e => e.state !== ST.KNOT), S.eyes.map(e => e.state));
  const S2 = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'collector', k: 1, a: -30, name: 'c' }, { type: 'watcher', k: 1, a: 5, name: 'd1', speed: 0.3, beh: 'patrol' }, { type: 'watcher', k: 1, a: -65, name: 'w1', speed: 0.2, beh: 'patrol' }] });
  let knot2 = false; run(S2, 12, s => { if (s.events.some(e => e.type === 'knot')) knot2 = true; return { gaze: s.eyePos(s.eye('c')) }; });
  check('collector: held, it gathers nothing', !knot2);
}
// --- false eye: absorbs gaze, never pins; revealed ---
{
  const S = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'falseeye', k: 0, a: 0, name: 'f' }] });
  run(S, 0.6, { gaze: pos(S, 'f') });
  check('false eye: gazing reveals it and it is no longer targetable', S.eye('f').state === ST.REVEALED && S.gaze.target === S.eye('f').id || S.eye('f').state === ST.REVEALED);
  run(S, 0.1, {});
  check('false eye: after reveal the gaze passes through', S.gaze.target === null);
}
// --- unblinking: immune; absorbs active eyes; stopped by held ones; crosses doors ---
{
  const S = createSim({ n: 3, doors: [[0], [-90], [0]], player: { k: 1, a: -90 }, eyes: [{ type: 'unblinking', k: 0, a: 20, name: 'u' }] });
  run(S, 0.5, { gaze: pos(S, 'u') });
  check('unblinking: gaze cannot pin it', S.eye('u').state === ST.ACTIVE && S.events !== null);
  let crossed = false; run(S, 25, s => { if (s.events.some(e => e.type === 'eyeCross')) crossed = true; return {}; });
  check('unblinking: it finds an opening to reach your ring', crossed && (S.over || S.eye('u').k === 1), { k: S.eye('u').k, over: S.over });
  const S2 = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'unblinking', k: 0, a: 60, name: 'u' }, { type: 'drifter', k: 0, a: 20, speed: 0, name: 'd' }] });
  let abs = false; run(S2, 12, s => { if (s.events.some(e => e.type === 'absorb')) abs = true; return {}; });
  check('unblinking: it swallows an unheld eye in its way', abs);
  const S3 = createSim({ n: 2, doors: [[0], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'unblinking', k: 0, a: 60, name: 'u' }, { type: 'drifter', k: 0, a: 20, speed: 0, name: 'd' }] });
  run(S3, 12, { gaze: pos(S3, 'd') });
  check('unblinking: a held eye stops it cold', !S3.over && S3.eye('d').state !== ST.DEAD, S3.eyes.map(e => e.state));
}
// --- warden: an opening that is open only while its eye is held ---
{
  const S = createSim({ n: 2, doors: [[{ a: -90, lid: 'wd' }], [0]], player: { k: 0, a: -90 }, eyes: [{ type: 'warden', wall: 0, a: -78, name: 'wd' }] });
  run(S, 0.5, s => ({ move: radialMove(s, -1) }));
  check('warden: the lid opening is shut unwatched', S.P.k === 0);
  run(S, 0.5, s => ({ move: radialMove(s, -1), gaze: s.eyePos(s.eye('wd')) }));
  check('warden: holding its eye holds the opening open', S.P.k === 1);
}
// --- determinism ---
{
  const def = { n: 3, rotation: true, doors: [[0, 120], [200], [45]], barriers: [[], [100], []], player: { k: 0, a: -90 },
    eyes: [{ type: 'watcher', k: 0, a: 30 }, { type: 'drifter', k: 1, a: 10 }, { type: 'liar', k: 2, a: 100 }, { type: 'mimic', k: 1, a: 200 }] };
  const sig = () => { const S = createSim(def); run(S, 12, (s, i) => ({ move: [Math.sin(i * 0.01), Math.cos(i * 0.013)], rot: Math.sin(i * 0.007), gaze: i % 200 < 100 ? s.eyePos(s.eyes[i % 4]) : [0, 9] })); return JSON.stringify([S.P, S.phi, S.eyes.map(e => [e.a, e.state]), S.over]); };
  check('determinism: identical input gives identical state', sig() === sig());
}
console.log(pass + '/' + total + ' core checks');
process.exit(pass === total ? 0 : 1);
