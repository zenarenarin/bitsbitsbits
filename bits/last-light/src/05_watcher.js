// =====================================================================
// The Watcher. It is never shown; it is the city's lamps acting together.
//
// What it knows comes only from the lamps' light: a lamp sees you when a
// sample point on your silhouette (feet, knees, chest, head) is inside its
// visibility polygon, which is exactly the light drawn on screen.
//
// Exposure (what you feel)       Watcher mode (what it does)
//   HIDDEN    no lamp sees you      search       lamps follow their patterns
//   EXPOSED   suspicion rising      notice       the lamp hesitates, iris tightens
//                                   investigate  a noise gave it a place to look
//   DETECTED  suspicion full        track        lamps that can reach your last known
//                                                position turn to it; lock-on rises
//                                                while you are lit
//   HUNTING   it found you twice    hunt         faster lamps, shutters drop near your
//             or held you long                   last known position, doorways open
//   LOST      you broke its sight   (track/hunt) lamps sweep the last known area, not
//                                                where you are; it gives up in time
//   CAPTURED  lock-on full          capture
//
// Suspicion and lock-on both rise with how much of you is lit and fall only
// after a short grace period out of the light, so darting in and out of a
// beam does not reset them.
// =====================================================================
const WATCH = {
  notice: 0.9,        // seconds fully lit before it is sure (EXPOSED -> DETECTED)
  lock: 1.3,          // seconds fully lit while tracked before capture
  lockHunt: 0.95,     // the same during a hunt
  grace: 0.45,        // seconds out of the light before suspicion/lock begin to fall
  decayS: 0.5, decayL: 0.35,
  reacquire: 1.6,     // suspicion rises this much faster while it is already looking for you
  lostTrack: 5.0, lostHunt: 7.5, investigate: 4.2, huntHeat: 1.8, rehunt: 12,
  searchSpeed: deg(80), trackSpeed: deg(46), huntSpeed: deg(72),
  wobble: deg(7), lostWobble: deg(16), focusNarrow: 0.22
};

function createWatcher(level, optics, world, C) {
  C = C || WATCH;
  const W = { mode: 'search', S: 0, L: 0, heat: 0, lost: 0, inv: 0, unseen: 99, last: { x: 0, y: 0 }, seenFrac: 0, seers: [], modeT: 0,
    alarms: 0, hunts: 0, exposure: 0, calmMode: 'search', lastTrackEnd: -99, time: 0, events: [], hidden: false, litRun: 0, lastSeer: null, noiseT: -99, captureCtx: null };
  const ev = (type, o) => W.events.push(Object.assign({ type }, o));
  const tensionOf = { search: 0, investigate: 0.3, notice: 0.4, track: 0.7, hunt: 1, capture: 1 };

  W.reset = function () {
    Object.assign(W, { reacquired: false, mode: 'search', S: 0, L: 0, heat: 0, lost: 0, inv: 0, unseen: 99, seenFrac: 0, modeT: 0, calmMode: 'search', lastTrackEnd: -99, litRun: 0, lastSeer: null, noiseT: -99, captureCtx: null, last: { x: 0, y: 0 } });
    W.seers.length = 0; W.events.length = 0;
    for (const l of level.lights) { l.clock = l.phase * l.period / TAU; l.ang = patternAngle(l); l.focus = 0; l.halfNow = l.half; l.on = !l.huntOnly; l.seeing = false; l.engaged = false; }
  };
  W.tension = () => tensionOf[W.mode] || 0;
  // the player-facing exposure state
  W.exposureState = () => W.mode === 'capture' ? 'captured' : W.mode === 'hunt' ? (W.lost > 0.6 ? 'lost' : 'hunting') : W.mode === 'track' ? (W.lost > 0.6 ? 'lost' : 'detected') : W.mode === 'notice' ? 'exposed' : 'hidden';
  function setMode(m, o) { if (W.mode === m) return; const from = W.mode; W.mode = m; W.modeT = 0; ev(m, Object.assign({ from }, o)); }

  function patternAngle(l) { return l.base + (l.amp ? l.amp * Math.sin(TAU * l.clock / l.period) : 0); }
  const hunting = () => W.mode === 'track' || W.mode === 'hunt' || W.mode === 'investigate';
  W.reaches = function (l, p) {
    const dx = p.x - l.x, dy = p.y + 0.8 - l.y;
    if (Math.hypot(dx, dy) > l.range * 0.96) return false;
    return Math.abs(angNorm(Math.atan2(dy, dx) - l.base)) <= l.maxDev + l.half * 0.5;
  };

  // A noise: somewhere to look. It does not reveal you, but it tells the
  // Watcher where to point its lamps.
  W.hear = function (x, y, what) {
    if (W.mode === 'capture') return;
    W.noiseT = W.time;
    if (W.mode === 'track' || W.mode === 'hunt') { if (W.seenFrac <= 0) { W.last = { x, y }; W.lost = Math.min(W.lost, 0.5); } return; }
    W.last = { x, y }; W.inv = C.investigate; W.calmMode = 'investigate';
    if (W.mode === 'search') setMode('investigate', { what });
    else if (W.mode === 'investigate') ev('investigate', { what, again: true });
  };

  W.closeShutter = s => (W.mode === 'track' || W.mode === 'hunt' || W.mode === 'investigate' || (W.mode === 'notice' && W.calmMode === 'investigate')) && Math.abs(W.last.x - s.x0) < s.reach;
  W.doorOpen = r => W.mode === 'hunt' && W.modeT > 0.8 && W.last.x > r.x0 - 2.6 && W.last.x < r.x1 + 2.6 && Math.abs(W.last.y - r.y0) < 3;

  // silhouette sample heights, relative to the feet: feet, knees, chest, head
  const SAMPLE = [0.12, 0.4, 0.62, 0.92];

  W.update = function (dt, P, time) {
    W.time = time; W.modeT += dt;
    const speed = W.mode === 'hunt' ? C.huntSpeed : W.mode === 'track' || W.mode === 'investigate' ? C.trackSpeed : C.searchSpeed;
    // 1. aim the lamps
    for (const l of level.lights) {
      l.on = !l.huntOnly || W.mode === 'hunt';
      l.clock += dt * (l.seeing ? 0.22 : 1);
      let target = patternAngle(l);
      l.engaged = hunting() && W.reaches(l, W.last);
      if (l.engaged) {
        const to = Math.atan2(W.last.y + 0.8 - l.y, W.last.x - l.x);
        const rel = clamp(angNorm(to - l.base), -l.maxDev, l.maxDev);
        // seeing you: hold you; lost you: sweep the place it last saw you
        const wob = l.seeing ? 0 : (W.lost > 0.6 ? C.lostWobble : C.wobble) * Math.sin(time * (W.lost > 0.6 ? 1.7 : 2.2) + l.id * 1.7);
        target = l.base + rel + wob;
      }
      const d = angNorm(target - l.ang);
      l.ang += clamp(d, -speed * dt, speed * dt);
      l.halfNow = l.half * (1 - C.focusNarrow * l.focus);
    }
    // 2. what do they see?
    W.seers.length = 0;
    let frac = 0, best = null;
    const rec = world.inRecess(P);
    W.hidden = !!rec && rec.open < 0.6;
    if (P.state !== 'caught' && P.state !== 'gone') {
      for (const l of level.lights) {
        l.seeing = false;
        if (!l.on) continue;
        let n = 0;
        for (const k of SAMPLE) if (optics.sees(l, P.x, P.y + P.h * k)) n++;
        const f = W.hidden ? 0 : n / SAMPLE.length;
        if (f > 0) { l.seeing = true; W.seers.push(l); if (f > frac) { frac = f; best = l; } }
      }
      if (rec && rec.open >= 0.6) { frac = Math.max(frac, 1); best = best || { kind: 'door' }; }
    } else for (const l of level.lights) l.seeing = false;
    for (const l of level.lights) l.focus = approach(l.focus, l.seeing ? 1 : 0, dt * 3);
    W.seenFrac = frac;
    if (frac > 0) { W.exposure += frac * dt; W.unseen = 0; W.litRun += dt; W.lastSeer = best; }
    else { W.unseen += dt; W.litRun = 0; }
    const decaying = W.unseen > C.grace;

    // 3. the state of the hunt
    const seen = frac > 0;
    switch (W.mode) {
      case 'search':
      case 'investigate':
        if (W.mode === 'investigate') { W.inv -= dt; if (W.inv <= 0 && !seen) { W.calmMode = 'search'; setMode('search', { lost: true }); } }
        if (seen) { W.S += dt * frac / C.notice * (W.mode === 'investigate' ? C.reacquire : 1); W.calmMode = W.mode; setMode('notice'); }
        else if (decaying) W.S = Math.max(0, W.S - dt * C.decayS);
        break;
      case 'notice': {
        const fast = W.calmMode === 'investigate' || W.time - W.lastTrackEnd < C.rehunt;
        if (seen) W.S += dt * frac / C.notice * (fast ? C.reacquire : 1);
        else if (decaying) W.S -= dt * C.decayS;
        if (W.S >= 1) {
          W.S = 1; W.last = { x: P.x, y: P.y }; W.alarms++; W.heat = 0; W.lost = 0;
          if (W.time - W.lastTrackEnd < C.rehunt) { W.hunts++; setMode('hunt', { again: true }); } else setMode('track');
        } else if (W.S <= 0) { W.S = 0; setMode(W.calmMode === 'investigate' && W.inv > 0 ? 'investigate' : 'search', { settled: true }); }
        break;
      }
      case 'track':
      case 'hunt': {
        const hunt = W.mode === 'hunt';
        if (seen) {
          // found again after losing you: it hunts, and locks on faster
          if (W.lost > 0.6) { W.reacquired = true; ev('reacquire', {}); if (!hunt) { W.hunts++; setMode('hunt', { again: true }); } }
          W.last = { x: P.x, y: P.y }; W.L += dt * frac / (hunt ? C.lockHunt : C.lock); W.heat += dt * frac; W.lost = 0;
        } else { if (decaying) W.L = Math.max(0, W.L - dt * C.decayL); W.lost += dt; if (W.lost > 0.6 && W.lost - dt <= 0.6) ev('lost', {}); }
        if (W.L >= 1) {
          W.L = 1;
          W.captureCtx = { lamp: W.lastSeer, litRun: W.litRun, x: P.x, y: P.y, state: P.state, speed: Math.hypot(P.vx, P.vy), onAwning: !!(P.ground && P.ground.kind === 'awning'), door: !!(rec && rec.open >= 0.6), hunt: W.mode === 'hunt', reacquired: !!W.reacquired, sinceNoise: W.time - W.noiseT, heat: W.heat };
          setMode('capture', { x: P.x, y: P.y });
          break;
        }
        if (!hunt && W.heat >= C.huntHeat) { W.hunts++; setMode('hunt'); }
        if (W.lost >= (hunt ? C.lostHunt : C.lostTrack)) {
          W.S = 0; W.L = 0; W.heat = 0; W.reacquired = false; W.lastTrackEnd = W.time; W.calmMode = 'search';
          setMode('search', { lost: true });
        }
        break;
      }
    }
  };
  W.reset();
  return W;
}
