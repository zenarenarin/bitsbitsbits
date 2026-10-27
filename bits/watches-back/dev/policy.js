// Drive a simulation with a scripted plan, through the same inputs the game sends
// (a move vector, a dial value, a gaze point). Used to prove each encounter's
// intended solutions work and that naive play does not.
//
// Plan steps (executed in order; each may also carry `gaze` / `rot` to apply while it runs):
//   { walk: deg }            walk along the current groove to that world angle
//   { in: 1 } / { out: 1 }   push toward / away from the centre until the ring changes
//   { door: 'in' }           walk to the nearest open inner opening and step through
//   { gaze: 'name' }         look at an eye (follows it, like a finger on it); { gaze: null } looks at nothing
//   { rot: v, for: s }       turn the dial
//   { rotDoor: [wall, door, deg] }  turn until that opening's world angle reaches deg
//   { wait: s }
//   { until: fn, max: s, move?: fn }
const { DEG, wrap } = require('./load')();
function runPlan(S, plan, opt) {
  opt = opt || {};
  const log = [];
  let gazeName, gazePoint = undefined, i = 0, t0 = S.t;
  const maxT = opt.max || 240;
  const pos = n => S.eyePos(S.eye(n));
  const tan = s => { const th = S.playerTheta(); return [-Math.sin(th) * s, Math.cos(th) * s]; };
  const rad = s => { const th = S.playerTheta(); return [Math.cos(th) * s, Math.sin(th) * s]; };
  const stepOnce = (inp, st) => {
    if (st && 'gaze' in st) { gazeName = st.gaze; if (gazeName === null) gazePoint = null; }
    if (st && st.look) { gazeName = undefined; gazePoint = st.look; }
    if (st && st.gazeFn) { const n = st.gazeFn(S); if (n) gazeName = n; }
    if (gazeName) { const e = S.eye(gazeName); gazePoint = e && e.state !== 'dead' ? S.eyePos(e) : gazePoint; }
    inp.gaze = gazePoint;
    if (st && st.rot !== undefined && inp.rot === undefined) inp.rot = st.rot;
    if (st && st.moveFn) inp.move = st.moveFn(S);
    S.step(inp);
    if (S.events.length && opt.verbose) for (const e of S.events) if (!['target', 'ripple', 'close'].includes(e.type)) log.push(e.t.toFixed(2) + ' ' + e.type + ' ' + JSON.stringify(Object.assign({}, e, { t: undefined, type: undefined })));
  };
  const done = () => S.over || S.reached || S.t - t0 > maxT;
  for (const st of plan) {
    if (done()) break;
    const start = S.t, k0 = S.P.k;
    const lim = st.max || 30;
    if ('gaze' in st && Object.keys(st).length === 1) { stepOnce({}, st); continue; }
    if (st.walk !== undefined) {
      while (!done() && S.t - start < lim) {
        const d = wrap(st.walk * DEG - S.playerTheta());
        if (Math.abs(d) * S.playerR() < (st.tol || 0.12)) break;
        const dir = S.dirTo(S.P.k, S.P.a, wrap(st.walk * DEG - S.phi[S.P.k])) || Math.sign(d);
        const far = dir === Math.sign(d) ? Math.abs(d) : 7;
        stepOnce({ move: tan(dir * Math.min(1, far * S.playerR() * 2 + 0.25)) }, st);
      }
    } else if (st.in || st.out) {
      while (!done() && S.P.k === k0 && S.t - start < lim) stepOnce({ move: rad(st.in ? -1 : 1) }, st);
    } else if (st.door) {
      while (!done() && S.P.k === k0 && S.t - start < lim) {
        const nd = S.nearestDoor(S.P.k, S.playerTheta(), true);
        if (!nd) { stepOnce({}, st); continue; }
        if (nd.arc > 1.2) { const tl = S.doorTheta(nd.w, nd.d) - S.phi[S.P.k]; const d = S.dirTo(S.P.k, S.P.a, tl) || Math.sign(nd.dth); stepOnce({ move: tan(d) }, st); } else stepOnce({ move: rad(-1) }, st);
      }
    } else if (st.go || st.turnOnly) {
      // turn the nearest inner opening to where you stand, then step through
      while (!done() && S.P.k === k0 && S.t - start < lim) {
        const nd = S.nearestDoor(S.P.k, S.playerTheta(), true);
        if (!nd) { stepOnce({}, st); continue; }
        if (nd.arc > 0.35) { const g = S.gear(nd.w.owner); stepOnce({ rot: -Math.sign(nd.dth) * g * Math.min(1, Math.abs(nd.dth) * 3 + 0.2) }, st); }
        else if (st.turnOnly) break;
        else stepOnce({ move: rad(-1) }, st);
      }
    } else if (st.rotDoor) {
      const [wi, di, to] = st.rotDoor, w = S.walls[wi], d = w.doors[di];
      while (!done() && S.t - start < lim) {
        const diff = wrap(to * DEG - S.doorTheta(w, d));
        if (Math.abs(diff) < (st.tol || 1.5) * DEG) break;
        const g = S.gear(w.owner);
        stepOnce({ rot: Math.sign(diff) * g * Math.min(1, Math.abs(diff) * 3 + 0.15) }, st);
      }
    } else if (st.wait !== undefined || st.for !== undefined) {
      const dur = st.wait !== undefined ? st.wait : st.for;
      while (!done() && S.t - start < dur) stepOnce({}, st);
    } else if (st.until) {
      while (!done() && !st.until(S) && S.t - start < lim) stepOnce({}, st);
    }
    i++;
  }
  // finish: if the plan ends early keep stepping without input for a moment
  return { ok: !!S.reached && !S.over, t: +S.t.toFixed(1), over: S.over, ring: S.P.k, step: i, log, stats: S.stats };
}
// the naive player: walk to the nearest inner opening and push through, never looking, never turning
const NAIVE = [{ door: 'in', max: 60 }, { door: 'in', max: 60 }, { door: 'in', max: 60 }, { door: 'in', max: 60 }, { door: 'in', max: 60 }];
module.exports = { runPlan, NAIVE };
