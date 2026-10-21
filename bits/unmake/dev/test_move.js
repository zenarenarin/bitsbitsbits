const L = require('./load')();
const { Phys, Player, qAxis } = L;
function world() { return new L.Phys(); }
function box(P, x, y, z, hx, hy, hz, extra) { return P.addBody(Object.assign({ type: 'static', pos: [x, y, z], size: [hx, hy, hz] }, extra || {})); }
function run(P, pl, secs, inputFn) {
  const dt = 1 / 60, log = [];
  for (let i = 0; i < secs * 60; i++) {
    const inp = inputFn ? inputFn(i * dt, pl) : { steer: 0, pace: 0 };
    P.step(dt); pl.step(dt, inp, 0);
    if (i % 15 === 0) log.push(`${(i * dt).toFixed(2)} x=${pl.pos[0].toFixed(2)} y=${pl.pos[1].toFixed(2)} z=${pl.pos[2].toFixed(2)} g=${pl.grounded ? 1 : 0}`);
  }
  return log;
}
let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

// 1. flat run reaches cruise speed
{ const P = world(); box(P, 0, -0.5, -50, 2, 0.5, 60); const pl = new Player(P); pl.reset([0, 0.01, 0]);
  run(P, pl, 1.5); const sp = Math.hypot(pl.vel[0], pl.vel[2]);
  check('flat run cruise speed', Math.abs(sp - L.MOVE.cruise) < 0.2 && pl.grounded && Math.abs(pl.pos[1]) < 0.02, 'speed ' + sp.toFixed(2) + ' y ' + pl.pos[1].toFixed(3)); }
// 2. gap jump: 3.5 m gap, jump at the edge
{ const P = world(); box(P, 0, -0.5, -5, 2, 0.5, 5); box(P, 0, -0.5, -20, 2, 0.5, 6.5);
  const pl = new Player(P); pl.reset([0, 0.01, 0]);
  run(P, pl, 3.5, (t, p) => ({ steer: 0, pace: 0, jumpPressed: p.pos[2] < -9.4 && p.pos[2] > -9.8, jumpHeld: true }));
  check('3.5 m gap jump at cruise', pl.grounded && pl.pos[1] > -0.05 && pl.pos[2] < -14, `z ${pl.pos[2].toFixed(1)} y ${pl.pos[1].toFixed(2)}`); }
// 3. no jump: falls into the gap
{ const P = world(); box(P, 0, -0.5, -5, 2, 0.5, 5); box(P, 0, -0.5, -20, 2, 0.5, 6.5);
  const pl = new Player(P); pl.reset([0, 0.01, 0]); run(P, pl, 3);
  check('runs off edge without jump', pl.pos[1] < -5, 'y ' + pl.pos[1].toFixed(1)); }
// 4. step up 0.35 without jumping
{ const P = world(); box(P, 0, -0.5, -5, 2, 0.5, 5); box(P, 0, -0.15, -20, 2, 0.5, 10);
  const pl = new Player(P); pl.reset([0, 0.01, 0]); run(P, pl, 2.5);
  check('walks up a 0.35 step', pl.pos[1] > 0.3 && pl.pos[2] < -12 && pl.grounded, `y ${pl.pos[1].toFixed(2)} z ${pl.pos[2].toFixed(1)}`); }
// 5. slope 20 degrees up
{ const P = world(); box(P, 0, -0.5, -5, 2, 0.5, 5);
  const a = 0.35; box(P, 0, 5.2 * Math.sin(a) - 0.5 * Math.cos(a), -10 - 5.2 * Math.cos(a) - 0.5 * Math.sin(a), 2, 0.5, 5.2, { rot: qAxis([1, 0, 0], a) });
  const pl = new Player(P); pl.reset([0, 0.01, 0]); const log = run(P, pl, 3.4);
  check('climbs a 20 degree ramp', pl.pos[1] > 2.4 && pl.grounded, log[log.length - 1]); }
// 6. moving platform carries the player
{ const P = world(); const pf = box(P, 0, -0.5, -3, 2, 0.5, 6, { type: 'kin' });
  pf.motion = (W, b, dt) => { b.pos = [Math.sin(W.t) * 3, -0.5, -3]; };
  const pl = new Player(P); pl.reset([0, 0.01, 0]);
  run(P, pl, 1.0, () => ({ steer: 0, pace: -1 }));
  check('carried by moving platform', Math.abs(pl.pos[0] - Math.sin(P.t) * 3) < 0.15 && pl.grounded, `px ${pl.pos[0].toFixed(2)} plat ${(Math.sin(P.t) * 3).toFixed(2)}`); }
// 7. side-ledge protection on a narrow beam
{ const P = world(); box(P, 0, -0.5, -20, 0.4, 0.5, 25); const pl = new Player(P); pl.reset([0, 0.01, 0]);
  run(P, pl, 2, () => ({ steer: 1, pace: 0 }));
  check('steering does not slide off a beam', pl.grounded && pl.pos[1] > -0.1, `x ${pl.pos[0].toFixed(2)} y ${pl.pos[1].toFixed(2)}`); }
// 8. coyote: jump pressed 0.08 s after leaving edge still jumps
{ const P = world(); box(P, 0, -0.5, -5, 2, 0.5, 5); box(P, 0, -0.5, -20, 2, 0.5, 6.5);
  const pl = new Player(P); pl.reset([0, 0.01, 0]); let left = null;
  run(P, pl, 3.5, (t, p) => { if (!p.grounded && left === null && p.pos[2] < -9.9) left = t; return { steer: 0, pace: 0, jumpPressed: left !== null && t - left > 0.07 && t - left < 0.09, jumpHeld: true }; });
  check('coyote-time jump', pl.grounded && pl.pos[2] < -14 && pl.pos[1] > -0.1, `z ${pl.pos[2].toFixed(1)} y ${pl.pos[1].toFixed(2)}`); }
// 9. hinge sways under the player's weight (seesaw)
{ const P = world(); box(P, 0, -0.5, 0, 2, 0.5, 3); const ss = P.addBody({ type: 'hinge', pos: [0, -0.2, -8], size: [1.2, 0.2, 5], pivot: [0, 0, -8], axis: [1, 0, 0], mass: 1.2, min: -0.35, max: 0.35, damping: 2 });
  const pl = new Player(P); pl.reset([0, 0.01, 0]); let mx = 0; run(P, pl, 2.2, () => { mx = Math.max(mx, Math.abs(ss.ang)); return { steer: 0, pace: 0 }; });
  check('player weight tips a seesaw and it rocks back as they cross', mx > 0.3 && Math.abs(ss.ang) < 0.05 && pl.grounded, 'max ' + mx.toFixed(2)); }
// 10. max jump distance at sprint
{ for (const pace of [0, 1]) { const P = world(); box(P, 0, -0.5, -5, 2, 0.5, 5); box(P, 0, -0.5, -32, 2, 0.5, 20);
  const pl = new Player(P); pl.reset([0, 0.01, 2]); let z0 = null, z1 = null, air = false;
  run(P, pl, 3, (t, p) => { if (z0 !== null && !p.grounded) air = true; if (air && p.grounded && z1 === null) z1 = p.pos[2]; return { steer: 0, pace, jumpPressed: p.pos[2] < -9.7 && z0 === null ? (z0 = p.pos[2], true) : false, jumpHeld: true }; });
  console.log(`info jump distance at pace ${pace}: ${(z0 - z1).toFixed(2)} m`); } }
console.log(`${ok} passed, ${bad} failed`);
