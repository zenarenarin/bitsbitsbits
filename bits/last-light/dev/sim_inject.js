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
  })()
