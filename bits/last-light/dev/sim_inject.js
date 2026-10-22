(() => {
    window.__paused = true; // the harness loop stops; we step by hand
    const L = window.__ll;
    L.beginRun();
    // run a script: [{d, mx, my, j, jp, a, until}] at 120 Hz. Returns a trace.
    L.run = function (seq, opts) {
      opts = opts || {};
      const dt = 1 / 120, P = L.player, tr = [];
      for (const s of seq) {
        let t = 0, first = true;
        const until = s.until ? new Function('P', 'L', 'return (' + s.until + ')') : null;
        while (t < (s.d || 10)) {
          L.key.l = (s.mx || 0) < 0; L.key.r = (s.mx || 0) > 0; L.key.u = (s.my || 0) > 0; L.key.d = (s.my || 0) < 0; L.key.j = !!s.j;
          if (first && s.jp) L.I.jumpPressed = true;
          if (first && s.a) L.I.actPressed = true;
          first = false;
          if (opts.blind) { L.watcher.update = function () { }; }
          L.step(dt);
          t += dt;
          if (L.mode !== 'play') break;
          if (until && until(P, L)) break;
        }
        tr.push({ x: +P.x.toFixed(2), y: +P.y.toFixed(2), st: P.state, mode: L.mode, w: L.watcher.mode });
        if (L.mode !== 'play') break;
      }
      L.frame(0.016);
      return tr;
    };
    L.at = function (x, y, face) { L.player.reset(x, y, face || 1); L.R.follow(L.player, 1, true); };
  })();
(() => {
  const L = window.__ll;
  // is any lamp lighting the stretch [x0,x1] at height y right now?
  window.lit = (x0, x1, y) => { for (let x = x0; x <= x1; x += 0.25) for (const l of L.level.lights) if (l.on && L.optics.sees(l, x, y)) return true; return false; };
})();
(() => {
  const L = window.__ll;
  // will [x0,x1] at height y be lit in the next T seconds, if the lamps keep to their patterns?
  window.litSoon = (x0, x1, y, T) => {
    const ls = L.level.lights, saved = ls.map(l => l.ang);
    let hit = false;
    for (let t = 0; t <= T && !hit; t += 0.1) {
      for (const l of ls) { if (!l.engaged) l.ang = l.base + (l.amp ? l.amp * Math.sin(2 * Math.PI * (l.clock + t) / l.period) : 0); }
      for (let x = x0; x <= x1 && !hit; x += 0.3) for (const l of ls) if (l.on && L.optics.sees(l, x, y)) { hit = true; break; }
    }
    ls.forEach((l, i) => { l.ang = saved[i]; });
    return hit;
  };
})();
(() => {
  // a vertical stretch: the pipe column from y0 to y1
  window.colSoon = (x, y0, y1, T) => { for (let y = y0; y <= y1; y += 0.5) if (window.litSoon(x - 0.2, x + 0.2, y, T)) return true; return false; };
})();
