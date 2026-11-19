// ---------------------------------------------------------------------------
// The courier. One finger:
//   press         -> leap (on the ground) / hands out (in the air)
//   keep holding  -> catch any ring that passes your hands, and hang on
//   let go        -> let go, keeping the ring's momentum
// On the ground the courier walks to the far lip of whatever carries them and
// waits there, so they never walk off anything by themselves. A leap always
// adds the same push to the velocity of the thing you leave: momentum is
// inherited, never invented.
// ---------------------------------------------------------------------------

const PHYS = {
  G: 20, JVX: 3.8, JVY: 8.2, WALK: 2.7, LIP: 0.3, HANG: 1.0, GRAB_R: 0.85,
  COYOTE: 0.12, BUFFER: 0.14, TERM: -26, DT: 1 / 120, RELEASE_UP: 1.5, RELEASE_K: 1.06
};

const _o1 = { x: 0, y: 0, a: 0 }, _o2 = { x: 0, y: 0, a: 0 }, _h1 = { x: 0, y: 0 }, _h2 = { x: 0, y: 0 };

function surfPoint(sf, s, t, o) {
  sf.pose(t, o);
  const c = Math.cos(o.a), sn = Math.sin(o.a);
  o.x += c * s; o.y += sn * s;
  return o;
}

function makePlayer(surf, s, t) {
  const p = {
    mode: 'ground', surf, s: s || 0, x: 0, y: 0, vx: 0, vy: 0, gvx: 0, gvy: 0,
    handle: null, hvx: 0, hvy: 0, cd: {}, pressT: -9, leftT: -9, leftVx: 0, leftVy: 0,
    jumped: false, atLip: false, waitT: 0, airT: 0, ev: [], checkpoint: surf.isStatic ? surf : null,
    checkpointS: 0, justLanded: true, landT: t, held: false, lastSurf: surf, grabT: 0
  };
  surfPoint(surf, p.s, t, _o1); p.x = _o1.x; p.y = _o1.y;
  return p;
}

function cloneP(p) {
  const q = Object.assign({}, p);
  q.cd = Object.assign({}, p.cd);
  q.ev = [];
  return q;
}

function findTransfer(W, sf, t) {
  surfPoint(sf, sf.len, t, _o1);
  const ex = _o1.x, ey = _o1.y;
  for (const s2 of W.surfacesNear(ex)) {
    if (s2 === sf) continue;
    s2.pose(t, _o2);
    if (_o2.x > ex - 0.5 && _o2.x < ex + 0.4 && Math.abs(_o2.y - ey) < 0.22) return s2;
  }
  return null;
}

function doJump(p, bx, by, t) {
  p.mode = 'air';
  p.vx = bx + PHYS.JVX; p.vy = by + PHYS.JVY;
  p.pressT = -9; p.jumped = true; p.leftT = t; p.airT = 0;
  p.ev.push({ type: 'jump', waited: p.waitT, vx: p.vx, vy: p.vy, surf: p.surf });
  p.waitT = 0; p.atLip = false;
}

function playerStep(p, W, t, dt, held, pressed) {
  const tp = t - dt;
  p.held = held;
  if (pressed) p.pressT = t;

  if (p.mode === 'ground') {
    let sf = p.surf;
    const lipS = Math.max(0, sf.len - PHYS.LIP);
    if (p.s < lipS - 1e-6) {
      p.s = Math.min(lipS, p.s + PHYS.WALK * dt);
      p.atLip = false;
    } else {
      const tr = findTransfer(W, sf, t);
      if (tr) {
        sf.pose(t, _o1);
        p.surf = sf = tr; p.s = 0.02; p.justLanded = true;
        if (tr.isStatic) { p.checkpoint = tr; p.checkpointS = 0; }
        if (tr.isGoal) p.ev.push({ type: 'goal', surf: tr });
        p.ev.push({ type: 'step', surf: tr });
      } else {
        if (p.s > lipS) p.s = Math.max(lipS, p.s - 1.2 * dt);
        if (!p.atLip) p.ev.push({ type: 'lip', surf: sf });
        p.atLip = true; p.waitT += dt;
      }
    }
    surfPoint(sf, p.s, t, _o1);
    surfPoint(sf, p.s, tp, _o2);
    const vx = (_o1.x - _o2.x) / dt, vy = (_o1.y - _o2.y) / dt;
    if (!p.justLanded) {
      // Thrown off when the ground decelerates harder than gravity can hold you.
      const nx = -Math.sin(_o1.a), ny = Math.cos(_o1.a);
      const an = ((vx - p.gvx) * nx + (vy - p.gvy) * ny) / dt;
      const vnPrev = p.gvx * nx + p.gvy * ny;
      if (an < -PHYS.G * 1.05 && vnPrev > 0.8) {
        p.mode = 'air'; p.vx = p.gvx; p.vy = p.gvy; p.x = _o1.x; p.y = _o1.y;
        p.leftT = t; p.leftVx = p.gvx; p.leftVy = p.gvy; p.jumped = false; p.airT = 0;
        p.ev.push({ type: 'launch', speed: Math.hypot(p.gvx, p.gvy), surf: sf });
        // A leap pressed during the throw itself still counts (handled below via coyote).
        if (t - p.pressT <= PHYS.BUFFER) doJump(p, p.leftVx, p.leftVy, t);
        return;
      }
    }
    p.justLanded = false;
    p.gvx = vx; p.gvy = vy; p.x = _o1.x; p.y = _o1.y;
    if (t - p.pressT <= PHYS.BUFFER) { p.leftVx = vx; p.leftVy = vy; doJump(p, vx, vy, t); }
    return;
  }

  if (p.mode === 'air') {
    if (pressed && !p.jumped && t - p.leftT <= PHYS.COYOTE) doJump(p, p.leftVx, p.leftVy, t);
    const ox = p.x, oy = p.y;
    p.vy = Math.max(PHYS.TERM, p.vy - PHYS.G * dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.airT += dt;

    if (held && t - p.leftT > 0.03) {
      const hx = p.x, hy = p.y + PHYS.HANG;
      for (const h of W.handlesNear(p.x)) {
        if (hx < h.xmin - 1 || hx > h.xmax + 1 || hy < h.ymin - 1 || hy > h.ymax + 1) continue;
        if ((p.cd[h.id] || 0) > t) continue;
        if (!h.pos(t, _h1)) continue;
        const d = Math.hypot(_h1.x - hx, _h1.y - hy);
        if (d < PHYS.GRAB_R) {
          if (!h.pos(tp, _h2)) { _h2.x = _h1.x; _h2.y = _h1.y; }
          p.hvx = (_h1.x - _h2.x) / dt; p.hvy = (_h1.y - _h2.y) / dt;
          p.ev.push({ type: 'grab', handle: h, impact: Math.hypot(p.vx - p.hvx, p.vy - p.hvy) });
          p.mode = 'hang'; p.handle = h; p.grabT = t;
          p.x = _h1.x; p.y = _h1.y - PHYS.HANG;
          return;
        }
      }
    }

    let best = null, bestTau = 2, bestS = 0;
    const x0 = Math.min(ox, p.x), x1 = Math.max(ox, p.x);
    for (const sf of W.surfacesNear(p.x)) {
      if (x1 < sf.xmin || x0 > sf.xmax || Math.min(oy, p.y) > sf.ymax + 0.5 || Math.max(oy, p.y) < sf.ymin - 0.5) continue;
      sf.pose(tp, _o2);
      let c = Math.cos(_o2.a), sn = Math.sin(_o2.a);
      let dx = ox - _o2.x, dy = oy - _o2.y;
      const py0 = -dx * sn + dy * c, ps0 = dx * c + dy * sn;
      if (py0 < -0.04) continue;
      sf.pose(t, _o1);
      c = Math.cos(_o1.a); sn = Math.sin(_o1.a);
      dx = p.x - _o1.x; dy = p.y - _o1.y;
      const py1 = -dx * sn + dy * c, ps1 = dx * c + dy * sn;
      if (py1 > 0) continue;
      const tau = py0 / Math.max(1e-6, py0 - py1);
      const sAt = lerp(ps0, ps1, clamp(tau, 0, 1));
      if (sAt < -0.12 || sAt > sf.len + 0.12) continue;
      if (tau < bestTau) { bestTau = tau; best = sf; bestS = sAt; }
    }
    if (best) {
      const rvx = p.vx, rvy = p.vy;
      p.mode = 'ground'; p.surf = best; p.s = clamp(bestS, 0, best.len);
      surfPoint(best, p.s, t, _o1); surfPoint(best, p.s, tp, _o2);
      p.gvx = (_o1.x - _o2.x) / dt; p.gvy = (_o1.y - _o2.y) / dt;
      p.x = _o1.x; p.y = _o1.y; p.justLanded = true; p.landT = t; p.waitT = 0; p.atLip = false;
      p.ev.push({ type: 'land', surf: best, impact: Math.hypot(rvx - p.gvx, rvy - p.gvy), airT: p.airT, from: p.lastSurf });
      p.lastSurf = best;
      if (best.isStatic) { p.checkpoint = best; p.checkpointS = p.s; }
      if (best.isGoal) p.ev.push({ type: 'goal', surf: best });
      return;
    }
    if (p.y < W.floorAt(p.x)) { p.mode = 'fall'; p.ev.push({ type: 'fall' }); }
    return;
  }

  if (p.mode === 'hang') {
    const h = p.handle;
    const vis = h.pos(t, _h1);
    if (vis) {
      if (!h.pos(tp, _h2)) { _h2.x = _h1.x; _h2.y = _h1.y; }
      p.hvx = (_h1.x - _h2.x) / dt; p.hvy = (_h1.y - _h2.y) / dt;
      p.x = _h1.x; p.y = _h1.y - PHYS.HANG;
    }
    if (!vis || !held) {
      p.mode = 'air'; p.vx = p.hvx * PHYS.RELEASE_K; p.vy = p.hvy * PHYS.RELEASE_K + PHYS.RELEASE_UP;
      p.cd[h.id] = t + 0.4; p.handle = null; p.leftT = t; p.jumped = true; p.airT = 0;
      p.ev.push({ type: 'release', forced: !vis, handle: h, vx: p.vx, vy: p.vy });
    }
  }
}

// Put a fallen courier back on their last sound footing.
function respawnPlayer(p, t) {
  const sf = p.checkpoint;
  p.mode = 'ground'; p.surf = sf; p.s = Math.max(0, Math.min(sf.len - PHYS.LIP - 0.6, 0.4));
  p.vx = p.vy = 0; p.handle = null; p.justLanded = true; p.waitT = 0; p.atLip = false; p.pressT = -9;
  p.lastSurf = sf;
  surfPoint(sf, p.s, t, _o1); p.x = _o1.x; p.y = _o1.y;
}
