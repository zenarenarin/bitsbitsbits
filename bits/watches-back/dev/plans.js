// Intended solutions, one or more per encounter. Each must reach the centre.
module.exports = {
  1: { pin: [{ walk: -20 }, { gaze: 'first' }, { wait: 0.3 }, { walk: 25 }, { in: 1 }, { door: 'in' }] },
  2: { lure: [{ until: S => Math.abs(S.eyeTheta(S.eye('below')) - S.playerTheta()) < 0.08, max: 6 }, { gaze: 'below' }, { wait: 0.3 }, { walk: -30 }, { in: 1 }, { door: 'in' }] },
  3: { dam: [{ until: S => { const p = S.eye('pacer'); const th = S.eyeTheta(p) * 180 / Math.PI; return th > -78 && th < -55; }, max: 20 }, { gaze: 'pacer' }, { wait: 0.3 }, { walk: -30 }, { in: 1 }, { door: 'in' }] },
  4: { turn: [{ rotDoor: [0, 0, -90] }, { in: 1 }, { gaze: 'keeper' }, { wait: 0.4 }, { rotDoor: [1, 0, -60] }, { walk: -60 }, { in: 1 }, { rotDoor: [2, 0, 0] }, { door: 'in' }] },
  5: { dam: [{ walk: -128 }, { until: S => { const d = S.eye('drift'), th = S.eyeTheta(d) * 180 / Math.PI; return d.dir > 0 && th > -116 && th < -100; }, max: 40 }, { gaze: 'drift' }, { wait: 0.3 }, { walk: -88 }, { in: 1 }, { walk: 40 }, { gaze: 'low' }, { wait: 0.4 }, { rotDoor: [1, 0, 12] }, { walk: 12 }, { in: 1 }, { rotDoor: [2, 0, 50] }, { walk: 50 }, { in: 1 }] },
};
module.exports[6] = {
  lure: [{ walk: -32 }, { until: S => S.knots.length > 0, max: 25 }, { walk: -90 }, { in: 1 }, { walk: -170 }, { in: 1 }, { door: 'in' }],
};
module.exports[7] = { watch: [{ walk: -40 }, { gaze: 'shy' }, { wait: 0.3 }, { walk: -10 }, { in: 1 }, { gaze: null }, { walk: 95 }, { until: S => S.eyeTheta(S.eye('shy2')) > 80 * Math.PI / 180, max: 8 }, { gaze: 'shy2' }, { wait: 0.3 }, { walk: 30 }, { in: 1 }, { door: 'in' }] };
module.exports[8] = { feed: [{ walk: -28 }, { until: S => S.knots.length > 0, max: 30 }, { walk: -90 }, { in: 1 }, { walk: -110 }, { until: S => Math.abs(S.eyeTheta(S.eye('low')) - S.playerTheta()) < 0.1, max: 6 }, { gaze: 'low' }, { wait: 0.3 }, { walk: -55 }, { in: 1 }, { rotDoor: [2, 0, -10] }, { walk: -10 }, { in: 1 }] };
const aligned = n => S => Math.abs(require('./load')().wrap(S.eyeTheta(S.eye(n)) - S.playerTheta())) < 0.06 && S.selectTarget && true;
module.exports[9] = { narrow: [{ in: 1 }, { rotDoor: [1, 0, -60] }, { walk: -60 }, { until: aligned('v1'), max: 10 }, { gaze: 'v1' }, { wait: 0.35 }, { rotDoor: [1, 0, -72] }, { walk: -72 }, { in: 1 },
  { rotDoor: [2, 0, -130] }, { walk: -130 }, { in: 1 }, { rotDoor: [3, 0, -100] }, { walk: -100 }, { until: aligned('v2'), max: 10 }, { gaze: 'v2' }, { wait: 0.35 }, { rotDoor: [3, 0, -118] }, { walk: -118 }, { in: 1 }, { rotDoor: [4, 0, -150] }, { walk: -150 }, { in: 1 }] };
module.exports[10] = { strand: [{ until: S => S.eye('h1').k === 0 && S.eye('h2').k === 0, max: 25 }, { rotDoor: [0, 0, -100] }, { walk: -100 }, { in: 1 }, { go: 1 }, { go: 1 }, { go: 1 }] };
module.exports[11] = { read: [{ walk: -36 }, { wait: 1.2 }, { in: 1 }, { gaze: 'copy' }, { wait: 0.3 }, { walk: -120 }, { wait: 0.4 }, { in: 1 }, { gaze: 'mirror' }, { wait: 0.3 }, { rotDoor: [2, 0, -95] }, { walk: -95 }, { in: 1 }] };
const deg = v => v * Math.PI / 180;
module.exports[12] = { divide: [{ wait: 2.2 }, { gaze: 'gate' }, { wait: 0.4 }, { walk: -131 }, { until: S => Math.abs(S.eyeTheta(S.eye('low')) - S.playerTheta()) < 0.05, max: 8 },
  { until: S => { const g = S.eye('gate'); return Math.sin(2 * Math.PI * S.t / g.period + g.phase) > 0.5; }, max: 6 }, { gaze: 'low' }, { wait: 0.3 }, { walk: -110 }, { in: 1 }, { gaze: null }, { door: 'in' }, { door: 'in' }] };
module.exports[13] = { tell: [{ in: 1 }, { gaze: 'f3' }, { wait: 0.6 }, { gaze: null }, { walk: -180 }, { in: 1 }, { gaze: 'among' }, { wait: 0.3 }, { rotDoor: [2, 0, -175] }, { walk: -175 }, { in: 1 }] };
module.exports[14] = { conductor: [{ until: S => { const c = S.eye('c3'); const p = S.playerPos(), q = S.eyePos(c); const th = S.eyeTheta(c); return !S.occluded(p[0], p[1], q[0], q[1], c) && th > -0.6 && th < 0 && S.eyeTheta(S.eye('c0')) > -1.3; }, max: 40 }, { gaze: 'c3' }, { wait: 0.3 }, { gaze: null }, { in: 1 }, { walk: -150 }, { until: S => Math.abs(S.eyeTheta(S.eye('low')) - S.playerTheta()) < 0.06, max: 8 }, { gaze: 'low' }, { wait: 0.3 }, { rotDoor: [1, 0, -125] }, { walk: -125 }, { in: 1 }, { rotDoor: [2, 0, -90] }, { walk: -90 }, { in: 1 }] };
// E4's solution, replayed on E15: it must fail (the keeper is a liar now; held, it still rides its ring)
module.exports.familiar15 = [{ in: 1 }, { gaze: 'keeper' }, { wait: 0.4 }, { rotDoor: [1, 0, -60] }, { walk: -60 }, { in: 1 }, { rotDoor: [2, 0, 0] }, { door: 'in' }];
module.exports[15] = { wedge: [{ in: 1 }, { gaze: 'wedge' }, { wait: 0.35 }, { rotDoor: [1, 0, -15] }, { walk: -15 }, { in: 1 }, { rotDoor: [2, 0, 40] }, { walk: 40 }, { in: 1 }] };
const near = (n, tol) => S => Math.abs(require('./load')().wrap(S.eyeTheta(S.eye(n)) - S.playerTheta())) < (tol || 0.06);
module.exports[16] = { sequence: [{ in: 1 }, { rotDoor: [1, 0, -100] }, { until: near('low'), max: 6 }, { gaze: 'low' }, { wait: 0.3 }, { rotDoor: [1, 0, -118] }, { walk: -118 }, { in: 1 },
  { rotDoor: [2, 0, -125] }, { walk: -143 }, { until: near('shy'), max: 10 }, { gaze: 'shy' }, { wait: 0.3 }, { walk: -125 }, { in: 1 }, { rotDoor: [3, 0, -95] }, { walk: -95 }, { in: 1 }] };
const choirClear = (k, deg, gap) => S => S.eyes.filter(e => e.type === 'choir' && e.state !== 'dead').every(e => Math.abs(require('./load')().wrap(S.eyeTheta(e) - deg * Math.PI / 180)) > (gap || 0.6));
const choirNear = S => { const g = S.groups[0]; if (g.broken) return false; return g.members.some(id => { const e = S.eyes[id]; return e.state !== 'dead' && e.k === S.P.k && Math.abs(require('./load')().wrap(e.a - S.P.a)) < 1.3; }); };
const choirConductor = S => { const g = S.groups[0]; return g.broken ? null : S.eyes[g.conductor].name; };
const conductorSeen = S => { const g = S.groups[0]; if (g.broken) return false; const c = S.eyes[g.conductor]; const p = S.playerPos(), q = S.eyePos(c); return !S.occluded(p[0], p[1], q[0], q[1], c); };
const towardChoir = S => { const g = S.groups[0]; if (g.broken || conductorSeen(S)) return [0, 0]; const th = S.playerTheta(), c = S.eyeTheta(S.eyes[g.conductor]); const d = -S.dirTo(S.P.k, S.P.a, c - S.phi[S.P.k]); return [-Math.sin(th) * d, Math.cos(th) * d]; };
const guardChoir = { until: S => S.groups[0].broken, max: 20, gazeFn: S => conductorSeen(S) ? choirConductor(S) : null, moveFn: towardChoir };
module.exports[17] = { converge: [{ wait: 3 }, { in: 1 }, { walk: -20 }, { rotDoor: [1, 0, -20] }, { until: choirClear(2, -20, 0.9), max: 12 }, { in: 1 }, guardChoir,
  { rotDoor: [2, 0, -60] }, { walk: -60 }, { until: near('w3'), max: 8 }, { gaze: 'w3' }, { wait: 0.3 }, { rotDoor: [2, 0, -78] }, { walk: -78 }, { in: 1 }, { rotDoor: [3, 0, -110] }, { walk: -110 }, { in: 1 }] };
module.exports[18] = { trap: [{ until: S => S.eye('it').k === 0, max: 12 }, { wait: 0.5 }, { rotDoor: [0, 0, -100] }, { walk: -100 }, { in: 1 }, { rotDoor: [1, 0, -60] }, { walk: -60 }, { in: 1 }, { rotDoor: [2, 0, -30] }, { walk: -30 }, { in: 1 }, { rotDoor: [3, 0, 0] }, { walk: 0 }, { in: 1 }] };
// the crown: hold whichever eye is conducting, when it can be seen; three times
const conductor = S => { const g = S.groups[0]; return g && !g.broken ? S.eyes[g.conductor].name : null; };
const conductorVisible = S => { const g = S.groups[0]; if (g.broken) return true; const c = S.eyes[g.conductor]; if (c.state !== 'active') return false; const p = S.playerPos(), q = S.eyePos(c); return !S.occluded(p[0], p[1], q[0], q[1], c) && Math.hypot(q[0] - p[0], q[1] - p[1]) < 9; };
const towardConductor = S => { const g = S.groups[0]; if (g.broken) return [0, 0]; const th = S.playerTheta(), c = S.eyeTheta(S.eyes[g.conductor]); const d = S.dirTo(S.P.k, S.P.a, c - S.phi[S.P.k]); return [-Math.sin(th) * d, Math.cos(th) * d]; };
const breakOnce = n => [{ until: conductorVisible, max: 25, moveFn: towardConductor }, { gazeFn: conductor, until: S => S.groups[0].breaks >= n || S.groups[0].broken, max: 3 }, { gaze: null }];
module.exports[19] = { crown: [].concat(breakOnce(1), breakOnce(2), breakOnce(3), breakOnce(3), breakOnce(3), breakOnce(3), [{ until: S => S.groups[0].broken, max: 20 }, { go: 1 }, { go: 1 }, { go: 1 }, { go: 1 }]) };
const far = (a, b, deg) => S => Math.abs(require('./load')().wrap(S.eyeTheta(S.eye(a)) - S.playerTheta())) > deg * Math.PI / 180;
module.exports[20] = { watch: [{ in: 1 }, { go: 1 }, { turnOnly: 1 }, { until: far('echo4', null, 22), max: 20 }, { gaze: 'echo4' }, { wait: 0.3 }, { in: 1 }, { wait: 0.3 }, { until: far('echo4', null, 25), max: 6, moveFn: S => { const th = S.playerTheta(), e = S.eyeTheta(S.eye('echo4')); const d = -Math.sign(require('./load')().wrap(e - th)); return [-Math.sin(th) * d, Math.cos(th) * d]; } }, { gaze: 'first' }, { wait: 0.25 }, { go: 1 }] };
// the same idea when the traveller's habit puts the hunters on the other side
module.exports['10cw'] = { strand: [{ until: S => S.eye('h1').k === 0 && S.eye('h2').k === 0, max: 25 }, { rotDoor: [0, 0, -80] }, { walk: -80 }, { in: 1 }, { go: 1 }, { go: 1 }, { go: 1 }] };
