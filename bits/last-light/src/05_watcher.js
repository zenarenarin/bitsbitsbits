// =====================================================================
// The Watcher. It is never shown; it is the city's lamps acting together.
//
//   search      lamps follow their patterns
//   notice      a lamp has your silhouette; it hesitates and suspicion
//               rises. Break line of sight and it settles.
//   investigate a noise (an awning cord, a hard landing) gives it a place
//               to look. It looks there, not at you.
//   track       suspicion is full. Lamps that can reach your last known
//               position turn to it and lock-on rises while you are lit.
//               It knows where you were, not where you are.
//   hunt        you stayed lit too long, or it found you again soon after
//               losing you. Lamps move faster, shutters come down near
//               your last known position and nearby doorways open.
//   capture     lock-on reached full.
// =====================================================================
const WATCH = {
  notice: 0.85, lock: 1.15, lockHunt: 0.8, decayS: 0.55, decayL: 0.45,
  lostTrack: 5.0, lostHunt: 7.0, investigate: 4.2, huntHeat: 2.0, rehunt: 10,
  searchSpeed: deg(80), trackSpeed: deg(44), huntSpeed: deg(70), wobble: deg(9), focusNarrow: 0.22
};

function createWatcher(level, optics, world, C) {
  C = C || WATCH;
  const W = { mode: 'search', S: 0, L: 0, heat: 0, lost: 0, inv: 0, last: { x: 0, y: 0 }, seenFrac: 0, seers: [], modeT: 0,
    alarms: 0, exposure: 0, calmMode: 'search', lastTrackEnd: -99, time: 0, events: [], hidden: false };
  const ev = (type, o) => W.events.push(Object.assign({ type }, o));
  const tensionOf = { search: 0, investigate: 0.3, notice: 0.4, track: 0.7, hunt: 1, capture: 1 };

  W.reset = function () {
    Object.assign(W, { mode: 'search', S: 0, L: 0, heat: 0, lost: 0, inv: 0, seenFrac: 0, modeT: 0, calmMode: 'search', lastTrackEnd: -99 });
    W.seers.length = 0;
    for (const l of level.lights) { l.clock = l.phase * l.period / TAU; l.ang = patternAngle(l); l.focus = 0; l.halfNow = l.half; l.on = !l.huntOnly; l.seeing = false; l.engaged = false; }
  };
  W.tension = () => tensionOf[W.mode] || 0;
  function setMode(m, o) { if (W.mode === m) return; const from = W.mode; W.mode = m; W.modeT = 0; ev(m, Object.assign({ from }, o)); }

  function patternAngle(l) { return l.base + (l.amp ? l.amp * Math.sin(TAU * l.clock / l.period) : 0); }
  const hunting = () => W.mode === 'track' || W.mode === 'hunt' || W.mode === 'investigate';
  W.reaches = function (l, p) {
    const dx = p.x - l.x, dy = p.y + 0.8 - l.y;
    if (Math.hypot(dx, dy) > l.range * 0.96) return false;
    return Math.abs(angNorm(Math.atan2(dy, dx) - l.base)) <= l.maxDev + l.half * 0.5;
  };

  // A noise: somewhere to look. It does not reveal you.
  W.hear = function (x, y, what) {
    if (W.mode === 'capture') return;
    if (W.mode === 'track' || W.mode === 'hunt') { if (W.seenFrac <= 0) W.last = { x, y }; return; }
    W.last = { x, y }; W.inv = C.investigate; W.calmMode = 'investigate';
    if (W.mode === 'search') setMode('investigate', { what });
    else if (W.mode === 'investigate') ev('investigate', { what, again: true });
  };

  W.closeShutter = s => (W.mode === 'track' || W.mode === 'hunt' || W.mode === 'investigate' || (W.mode === 'notice' && W.calmMode === 'investigate')) && Math.abs(W.last.x - s.x0) < s.reach;
  W.doorOpen = r => W.mode === 'hunt' && W.modeT > 0.8 && W.last.x > r.x0 - 2.6 && W.last.x < r.x1 + 2.6 && W.last.y < 3;

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
        target = l.base + rel + (l.seeing ? 0 : C.wobble * Math.sin(time * 2.2 + l.id * 1.7));
      }
      const d = angNorm(target - l.ang);
      l.ang += clamp(d, -speed * dt, speed * dt);
      l.halfNow = l.half * (1 - C.focusNarrow * l.focus);
    }
    // 2. what do they see?
    W.seers.length = 0;
    let frac = 0;
    const rec = world.inRecess(P);
    W.hidden = !!rec && rec.open < 0.6;
    const pts = [P.y + 0.16, P.y + P.h * 0.55, P.y + P.h - 0.14];
    if (P.state !== 'caught' && P.state !== 'gone') {
      for (const l of level.lights) {
        l.seeing = false;
        if (!l.on) continue;
        let n = 0;
        for (const py of pts) if (optics.sees(l, P.x, py)) n++;
        const f = W.hidden ? 0 : n / 3;
        if (f > 0) { l.seeing = true; W.seers.push(l); frac = Math.max(frac, f); }
      }
      if (rec && rec.open >= 0.6) frac = Math.max(frac, 1);
    } else for (const l of level.lights) l.seeing = false;
    for (const l of level.lights) l.focus = approach(l.focus, l.seeing ? 1 : 0, dt * 3);
    W.seenFrac = frac;
    if (frac > 0) W.exposure += frac * dt;

    // 3. the state of the hunt
    const seen = frac > 0;
    switch (W.mode) {
      case 'search':
      case 'investigate':
        if (W.mode === 'investigate') { W.inv -= dt; if (W.inv <= 0 && !seen) { W.calmMode = 'search'; setMode('search', { lost: true }); } }
        if (seen) { W.S += dt * frac / C.notice * (W.mode === 'investigate' ? 1.5 : 1); W.calmMode = W.mode; setMode('notice'); }
        else W.S = Math.max(0, W.S - dt * C.decayS);
        break;
      case 'notice':
        if (seen) W.S += dt * frac / C.notice * (W.calmMode === 'investigate' ? 1.5 : 1);
        else W.S -= dt * C.decayS;
        if (W.S >= 1) {
          W.S = 1; W.last = { x: P.x, y: P.y }; W.alarms++; W.heat = 0; W.lost = 0;
          if (W.time - W.lastTrackEnd < C.rehunt) setMode('hunt', { again: true }); else setMode('track');
        } else if (W.S <= 0) { W.S = 0; setMode(W.calmMode === 'investigate' && W.inv > 0 ? 'investigate' : 'search', { settled: true }); }
        break;
      case 'track':
      case 'hunt': {
        const hunt = W.mode === 'hunt';
        if (seen) { W.last = { x: P.x, y: P.y }; W.L += dt * frac / (hunt ? C.lockHunt : C.lock); W.heat += dt * frac; W.lost = 0; }
        else { W.L = Math.max(0, W.L - dt * C.decayL); W.lost += dt; }
        if (W.L >= 1) { W.L = 1; setMode('capture', { x: P.x, y: P.y }); break; }
        if (!hunt && W.heat >= C.huntHeat) setMode('hunt');
        if (W.lost >= (hunt ? C.lostHunt : C.lostTrack)) {
          W.S = 0; W.L = 0; W.heat = 0; W.lastTrackEnd = W.time; W.calmMode = 'search';
          setMode('search', { lost: true });
        }
        break;
      }
    }
  };
  W.reset();
  return W;
}
