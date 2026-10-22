// =====================================================================
// The runner: one continuous body. Run, brake, jump (variable height,
// coyote time, buffered presses), vault waist-high obstacles, slide and
// crouch, grab a ledge's lip and shimmy along it, pull up, climb pipes,
// swing on a rope and drop through balconies. Every state hands its
// momentum on to the next.
// =====================================================================
const MOVE = {
  run: 6.4, accel: 58, airAccel: 34, decel: 46, airDecel: 10, turn: 90,
  gUp: 31, gDown: 44, jumpH: 2.15, cut: 0.42, maxFall: 21,
  coyote: 0.1, buffer: 0.13, w: 0.5, h: 1.6, crouchH: 0.9, crouchRun: 2.3,
  slideMin: 4.0, slideFriction: 5.5, slideMax: 0.7,
  shimmy: 2.3, climbUp: 3.6, climbDown: 4.8, pullUp: 0.3,
  vaultMax: 1.15, stepMax: 0.36, ropePump: 4.2
};

function createPlayer(world, M) {
  M = M || MOVE;
  const P = {
    x: 0, y: 0, vx: 0, vy: 0, w: M.w, h: M.h, state: 'air', face: 1,
    ground: null, coyote: 0, buf: 0, jumping: false, dropT: 0, dropPlat: null, downT: 0,
    ledge: null, pipe: null, rope: null, rAng: 0, rW: 0, rLen: 0,
    climb: null, slideT: 0, crouch: false, coolLedge: 0, coolPipe: 0, coolRope: 0,
    run: 0, airT: 0, landK: 0, pullT: 0, vaultT: 0, stunT: 0, fallFrom: 0, events: []
  };
  const ev = (type, o) => P.events.push(Object.assign({ type }, o));

  P.reset = function (x, y, face) {
    Object.assign(P, { x, y, vx: 0, vy: 0, h: M.h, state: 'ground', face: face || 1, ground: null, coyote: 0, buf: 0, jumping: false,
      dropT: 0, dropPlat: null, downT: 0, ledge: null, pipe: null, rope: null, climb: null, slideT: 0, crouch: false,
      coolLedge: 0, coolPipe: 0, coolRope: 0, airT: 0, landK: 0, pullT: 0, vaultT: 0, stunT: 0, holdDown: false, fallFrom: y });
    P.events.length = 0;
    support();
    if (!P.ground) P.state = 'air';
  };
  P.box = (h) => ({ x0: P.x - P.w / 2, x1: P.x + P.w / 2, y0: P.y, y1: P.y + (h || P.h) });

  function hitSolid(b) {
    for (const s of world.solids()) if (rectsOverlap(b, s)) return s;
    return null;
  }
  function headroom(h) { return !hitSolid({ x0: P.x - P.w / 2 + 0.02, x1: P.x + P.w / 2 - 0.02, y0: P.y + 0.05, y1: P.y + h }); }

  // what is under the feet right now (solid top or one-way slab)
  function support() {
    let best = null, by = -Infinity;
    const x0 = P.x - P.w / 2 + 0.04, x1 = P.x + P.w / 2 - 0.04;
    for (const s of world.solids()) if (x1 > s.x0 && x0 < s.x1 && Math.abs(s.y1 - P.y) < 0.06 && s.y1 > by) { best = s; by = s.y1; }
    for (const p of world.plats()) if (p !== P.dropPlat && x1 > p.x0 && x0 < p.x1 && Math.abs(p.y - P.y) < 0.06 && p.y > by) { best = p; by = p.y; }
    P.ground = best;
    if (best) P.y = by;
    return best;
  }

  function moveX(dx) {
    P.x += dx;
    const b = P.box();
    for (const s of world.solids()) {
      if (!rectsOverlap(b, s)) continue;
      const rise = s.y1 - P.y;
      // step up kerbs and low sills without breaking stride
      if (P.state === 'ground' && rise > 0 && rise <= M.stepMax && headroom(P.h + rise)) { P.y = s.y1; continue; }
      // vault waist-high obstacles at running pace
      if (P.state === 'ground' && rise > M.stepMax && rise <= M.vaultMax && Math.abs(P.vx) > 2.6 && !P.crouch) {
        P.x -= dx;
        P.state = 'air'; P.ground = null; P.jumping = false;
        P.vy = Math.sqrt(2 * M.gUp * (rise + 0.32)); P.vaultT = 0.32; P.airT = 0;
        ev('vault', { x: P.x, y: P.y });
        return;
      }
      if (dx > 0) P.x = s.x0 - P.w / 2 - 1e-4; else if (dx < 0) P.x = s.x1 + P.w / 2 + 1e-4;
      else P.x = (P.x < (s.x0 + s.x1) / 2) ? s.x0 - P.w / 2 - 1e-4 : s.x1 + P.w / 2 + 1e-4;
      P.vx = 0; b.x0 = P.x - P.w / 2; b.x1 = P.x + P.w / 2;
    }
  }

  function moveY(dy) {
    const py = P.y;
    P.y += dy;
    const b = P.box();
    let landed = null;
    for (const s of world.solids()) {
      if (!rectsOverlap(b, s)) continue;
      if (dy < 0 && py >= s.y1 - 0.02) { P.y = s.y1; landed = s; }
      else if (dy > 0) { P.y = s.y0 - P.h - 1e-4; if (P.vy > 0) { P.vy = 0; ev('bonk', {}); } }
      else if (dy < 0) { P.y = s.y1; landed = s; }
      b.y0 = P.y; b.y1 = P.y + P.h;
    }
    if (dy < 0 && !landed) {
      for (const p of world.plats()) {
        if (p === P.dropPlat) continue;
        if (b.x1 - 0.04 > p.x0 && b.x0 + 0.04 < p.x1 && py >= p.y - 0.02 && P.y < p.y) { P.y = p.y; landed = p; }
      }
    }
    return landed;
  }

  function land(s) {
    const impact = -P.vy;
    P.state = 'ground'; P.ground = s; P.vy = 0; P.jumping = false; P.vaultT = 0;
    P.landK = clamp(impact / 18, 0, 1);
    // a long drop costs a stumble
    if (P.fallFrom - P.y > 5.5) { P.stunT = 0.4; P.vx *= 0.3; }
    ev('land', { v: impact, kind: s.kind, drop: P.fallFrom - P.y, x: P.x, y: P.y });
  }

  function tryJump(I) {
    if (P.buf > 0 && (P.state === 'ground' || P.coyote > 0)) {
      if (I.my < -0.5 && P.ground && P.ground.th !== undefined && P.state === 'ground') return dropThrough();
      if (P.crouch && !headroom(M.h)) return;
      P.state = 'air'; P.ground = null; P.coyote = 0; P.buf = 0; P.jumping = true; P.crouch = false; P.slideT = 0; P.h = M.h;
      P.vy = Math.sqrt(2 * M.gUp * M.jumpH); P.airT = 0; P.fallFrom = P.y;
      ev('jump', { x: P.x, y: P.y });
    }
  }
  function dropThrough() {
    P.dropPlat = P.ground; P.dropT = 0.32; P.state = 'air'; P.ground = null; P.buf = 0; P.vy = -1.5; P.fallFrom = P.y; P.coolLedge = 0.3;
    P.crouch = false; P.h = M.h;
    ev('drop', {});
  }

  function lowerToHang() {
    const p = P.ground;
    if (!p.grab) return dropThrough();
    P.crouch = false; P.slideT = 0; P.h = M.h;
    grabLedge({ y: p.y, x0: p.x0, x1: p.x1, plat: p, lip: true, side: 0, shimmy: true });
    P.dropPlat = p; P.dropT = 0.2;
    // the stick is still held down: let it come back before down means "let go"
    P.holdDown = true;
  }

  // ---------- grabbing ----------
  function findLedge(I) {
    if (P.coolLedge > 0 || I.my < -0.5 || P.vy > 1.4) return null;
    const hy = P.y + P.h + 0.12;
    for (const p of world.plats()) {
      if (!p.grab || p === P.dropPlat) continue;
      if (P.x < p.x0 - 0.12 || P.x > p.x1 + 0.12) continue;
      if (hy > p.y - 0.26 && hy < p.y + 0.34 && P.y + P.h < p.y + 0.28) {
        return { y: p.y, x0: p.x0, x1: p.x1, plat: p, lip: true, side: 0, shimmy: true };
      }
    }
    // the top corners of solid blocks, approached from the side
    for (const s of world.solids()) {
      if (!s.grab || s.kind === 'street') continue;
      if (hy < s.y1 - 0.26 || hy > s.y1 + 0.34) continue;
      if (Math.abs(P.x + P.w / 2 - s.x0) < 0.2 && (I.mx > 0.2 || P.face > 0)) return { y: s.y1, x0: s.x0, x1: s.x1, solid: s, side: -1, corner: true };
      if (Math.abs(P.x - P.w / 2 - s.x1) < 0.2 && (I.mx < -0.2 || P.face < 0)) return { y: s.y1, x0: s.x0, x1: s.x1, solid: s, side: 1, corner: true };
    }
    return null;
  }
  function grabLedge(l) {
    P.state = 'hang'; P.ledge = l; P.vx = 0; P.vy = 0; P.jumping = false; P.crouch = false; P.h = M.h; P.slideT = 0;
    P.y = l.y - P.h - 0.14;
    if (l.corner) { P.x = l.side < 0 ? l.x0 - P.w / 2 - 0.01 : l.x1 + P.w / 2 + 0.01; P.face = -l.side; }
    else P.x = clamp(P.x, l.x0 + 0.18, l.x1 - 0.18);
    ev('grab', { x: P.x, y: l.y, what: 'ledge' });
  }
  function findPipe(I, onGround) {
    if (P.coolPipe > 0) return null;
    for (const p of world.pipes()) {
      const dx = Math.abs(P.x - p.x);
      if (onGround) {
        if (dx > 0.5) continue;
        if (I.my > 0.5 && P.y >= p.y0 - 0.2 && P.y < p.y1 - 0.5) return { p, y: P.y };
        if (I.my < -0.5 && Math.abs(P.y - p.y1) < 0.2) return { p, y: p.y1 - P.h * 0.75 };
      } else {
        if (dx > 0.34 || I.my < -0.5 || P.vy > 4) continue;
        if (P.y + 0.6 >= p.y0 && P.y + 0.6 <= p.y1 - 0.2) return { p, y: P.y };
      }
    }
    return null;
  }
  function grabPipe(g) {
    P.state = 'pipe'; P.pipe = g.p; P.x = g.p.x; P.y = clamp(g.y, g.p.y0, g.p.y1 - 0.4); P.vx = 0; P.vy = 0;
    P.jumping = false; P.crouch = false; P.h = M.h; P.slideT = 0; P.climbPhase = 0;
    ev('grab', { x: P.x, y: P.y + 1, what: 'pipe' });
  }
  function ropeEnd(r) { return { x: r.ax + Math.sin(r.sway || 0) * r.len, y: r.ay - Math.cos(r.sway || 0) * r.len }; }
  function findRope() {
    if (P.coolRope > 0) return null;
    const hx = P.x, hy = P.y + P.h;
    for (const r of world.ropes()) {
      const e = ropeEnd(r);
      const ex = e.x - r.ax, ey = e.y - r.ay, l2 = ex * ex + ey * ey;
      const t = clamp(((hx - r.ax) * ex + (hy - r.ay) * ey) / l2, 0.25, 1);
      const cx = r.ax + ex * t, cy = r.ay + ey * t;
      if (Math.hypot(hx - cx, hy - cy) < 0.55) return r;
    }
    return null;
  }
  function grabRope(r) {
    const hx = P.x, hy = P.y + P.h;
    P.state = 'rope'; P.rope = r;
    P.rLen = clamp(Math.hypot(hx - r.ax, hy - r.ay), 1.6, r.len);
    P.rAng = Math.atan2(hx - r.ax, r.ay - hy);
    P.rW = (P.vx * Math.cos(P.rAng) + P.vy * Math.sin(P.rAng)) / P.rLen;
    P.jumping = false; P.crouch = false; P.h = M.h;
    ev('grab', { x: hx, y: hy, what: 'rope' });
  }

  // ---------- the step ----------
  P.update = function (dt, I) {
    P.coolLedge -= dt; P.coolPipe -= dt; P.coolRope -= dt; P.dropT -= dt; P.vaultT -= dt;
    if (P.dropT <= 0) P.dropPlat = null;
    if (I.jumpPressed) P.buf = M.buffer; else P.buf -= dt;
    P.landK = Math.max(0, P.landK - dt * 4);

    if (P.state === 'caught' || P.state === 'gone') return;
    if (P.state === 'pull') { P.pullT -= dt; P.vx = approach(P.vx, 0, M.decel * dt); if (P.pullT <= 0) P.state = 'ground'; return; }
    if (P.state === 'climbup') return stepClimbUp(dt);
    if (P.state === 'hang') return stepHang(dt, I);
    if (P.state === 'pipe') return stepPipe(dt, I);
    if (P.state === 'rope') return stepRope(dt, I);
    stepBody(dt, I);
  };

  function stepBody(dt, I) {
    const onG = P.state === 'ground';
    if (P.stunT > 0) { P.stunT -= dt; I = { mx: I.mx * 0.15, my: 0, jumpHeld: false }; P.buf = 0; }
    // crouch and slide
    const wantDown = I.my < -0.5;
    if (onG) {
      if (wantDown && P.slideT <= 0 && !P.crouch && Math.abs(P.vx) > M.slideMin) { P.slideT = M.slideMax; P.h = M.crouchH; ev('slide', { x: P.x }); }
      if (P.slideT > 0) {
        P.slideT -= dt; P.vx = approach(P.vx, 0, M.slideFriction * dt);
        if (P.slideT <= 0 || Math.abs(P.vx) < 1.4) { P.slideT = 0; P.crouch = true; }
      }
      if (P.slideT <= 0) {
        if (wantDown) P.crouch = true;
        else if (P.crouch && headroom(M.h)) P.crouch = false;
        P.h = P.crouch ? M.crouchH : M.h;
      }
      // hold down on a slab to lower yourself and hang from its lip
      if (wantDown && Math.abs(P.vx) < 1 && P.ground && P.ground.th !== undefined) { P.downT += dt; if (P.downT > 0.24) { P.downT = 0; lowerToHang(); return; } }
      else P.downT = 0;
    } else if (P.slideT > 0) { P.slideT = 0; P.crouch = false; }

    // horizontal
    if (P.slideT <= 0) {
      const max = (P.crouch && onG ? M.crouchRun : M.run) * Math.min(1, Math.abs(I.mx) * 1.25);
      const want = sign(I.mx) * max;
      if (Math.abs(I.mx) > 0.12) {
        P.face = sign(I.mx);
        const turning = P.vx * want < 0;
        const a = onG ? (turning ? M.turn : M.accel) : M.airAccel * (turning ? 1.4 : 1);
        P.vx = approach(P.vx, want, a * dt);
      } else P.vx = approach(P.vx, 0, (onG ? M.decel : M.airDecel) * dt);
    }

    // pipes from the ground
    if (onG) { const g = findPipe(I, true); if (g) { grabPipe(g); return; } }

    tryJump(I);

    if (P.state === 'air') {
      P.airT += dt;
      if (P.jumping && !I.jumpHeld && P.vy > 0) { P.vy *= M.cut; P.jumping = false; }
      const g = P.vy > 0 ? M.gUp : M.gDown;
      P.vy = Math.max(-M.maxFall, P.vy - g * dt);
      if (P.vy <= 0 && P.fallFrom < P.y) P.fallFrom = P.y;
    }

    moveX(P.vx * dt);
    if (P.state === 'air') {
      const landed = moveY(P.vy * dt);
      if (landed && P.vy <= 0) { land(landed); return; }
      // grabs in the air: ropes, then pipes, then ledges
      const r = findRope(); if (r) { grabRope(r); return; }
      const g = findPipe(I, false); if (g) { grabPipe(g); return; }
      const l = findLedge(I); if (l) { grabLedge(l); return; }
    } else {
      // walking off an edge
      if (!support()) { P.state = 'air'; P.coyote = M.coyote; P.vy = 0; P.fallFrom = P.y; P.jumping = false; P.airT = 0; if (P.slideT > 0) { P.slideT = 0; } if (P.crouch && headroom(M.h)) { P.crouch = false; P.h = M.h; } }
    }
    if (P.state === 'air') P.coyote -= dt;
    P.run += Math.abs(P.vx) * dt;
  }

  function stepHang(dt, I) {
    const l = P.ledge;
    // the slab may vanish under the hands (an awning folding away)
    if (l.plat && world.plats().indexOf(l.plat) < 0) { release(); return; }
    if (l.shimmy && Math.abs(I.mx) > 0.25) {
      P.face = sign(I.mx);
      const nx = clamp(P.x + sign(I.mx) * M.shimmy * Math.min(1, Math.abs(I.mx) * 1.3) * dt, l.x0 + 0.18, l.x1 - 0.18);
      const ox = P.x; P.x = nx;
      if (hitSolid(P.box())) P.x = ox;
      P.run += Math.abs(P.x - ox);
      P.vx = (P.x - ox) / dt;
    } else P.vx = 0;
    if (P.buf > 0) {
      P.buf = 0;
      if (I.my < -0.5) { release(); return; }
      if (l.corner && I.mx * l.side > 0.3) { P.state = 'air'; P.vx = l.side * 4.5; P.vy = 9.5; P.jumping = true; P.coolLedge = 0.35; P.ledge = null; ev('jump', { x: P.x, y: P.y }); return; }
      // a pull-up jump: up and over the lip
      return startClimb(true);
    }
    if (I.my > -0.3) P.holdDown = false;
    if (I.my > 0.5) return startClimb(false);
    if (I.my < -0.6 && !P.holdDown) release();
  }
  function release() { P.state = 'air'; P.ledge = null; P.vy = 0; P.coolLedge = 0.35; P.fallFrom = P.y; P.airT = 0; ev('release', {}); }
  function startClimb(quick) {
    const l = P.ledge;
    const tx = l.corner ? (l.side < 0 ? l.x0 + 0.4 : l.x1 - 0.4) : P.x;
    const ox = P.x, oy = P.y;
    P.x = tx; P.y = l.y;
    const blocked = hitSolid({ x0: P.x - P.w / 2 + 0.02, x1: P.x + P.w / 2 - 0.02, y0: P.y + 0.05, y1: P.y + M.h });
    P.x = ox; P.y = oy;
    if (blocked) return;
    P.state = 'climbup';
    P.climb = { x0: ox, y0: oy, x1: tx, y1: l.y, t: 0, dur: quick ? M.pullUp * 0.75 : M.pullUp, quick, ground: l.plat || l.solid };
    P.ledge = null;
    ev('pullup', { x: tx, y: l.y });
  }
  function stepClimbUp(dt) {
    const c = P.climb;
    c.t += dt / c.dur;
    const k = smooth(Math.min(1, c.t));
    P.x = lerp(c.x0, c.x1, Math.min(1, k * 1.4)); P.y = lerp(c.y0, c.y1, k);
    if (c.t >= 1) {
      P.x = c.x1; P.y = c.y1; P.state = 'ground'; P.ground = c.ground; P.vx = c.quick ? P.face * 2.5 : 0; P.climb = null;
      if (!support()) { P.state = 'air'; }
    }
  }

  function stepPipe(dt, I) {
    const p = P.pipe;
    if (Math.abs(I.mx) > 0.3) P.face = sign(I.mx);
    if (P.buf > 0) {
      P.buf = 0;
      P.state = 'air'; P.pipe = null; P.coolPipe = 0.35; P.jumping = true; P.airT = 0;
      P.vx = (Math.abs(I.mx) > 0.2 ? sign(I.mx) : P.face) * 5.2; P.vy = 9.2; P.fallFrom = P.y;
      ev('jump', { x: P.x, y: P.y });
      return;
    }
    const v = I.my > 0.3 ? M.climbUp * Math.min(1, I.my * 1.3) : I.my < -0.3 ? -M.climbDown * Math.min(1, -I.my * 1.3) : 0;
    P.vy = v;
    P.y += v * dt;
    P.climbPhase += Math.abs(v) * dt;
    // the top: step on to whatever is there
    if (P.y + P.h * 0.75 >= p.y1 && v > 0) {
      const tops = [];
      for (const q of world.plats()) if (Math.abs(q.y - p.y1) < 0.3 && P.x > q.x0 - 1.4 && P.x < q.x1 + 1.4) tops.push({ x: clamp(P.x, q.x0 + 0.3, q.x1 - 0.3), y: q.y, g: q });
      for (const s of world.solids()) if (Math.abs(s.y1 - p.y1) < 0.3 && P.x > s.x0 - 1.4 && P.x < s.x1 + 1.4) tops.push({ x: clamp(P.x, s.x0 + 0.3, s.x1 - 0.3), y: s.y1, g: s });
      tops.sort((a, b) => Math.abs(a.x - P.x + P.face * 0.01) - Math.abs(b.x - P.x + P.face * 0.01));
      if (tops.length) {
        const t = tops[0];
        P.state = 'climbup'; P.climb = { x0: P.x, y0: P.y, x1: t.x, y1: t.y, t: 0, dur: M.pullUp, ground: t.g }; P.pipe = null; P.face = sign(t.x - P.x) || P.face;
        ev('pullup', { x: t.x, y: t.y });
        return;
      }
      P.y = p.y1 - P.h * 0.75;
    }
    // the bottom: feet on the ground
    if (P.y <= p.y0 + 0.001 && v <= 0) {
      P.y = p.y0;
      if (support()) { P.state = 'ground'; P.pipe = null; P.coolPipe = 0.3; ev('land', { v: 1, kind: 'street', drop: 0, x: P.x, y: P.y }); }
    }
    if (Math.abs(I.mx) > 0.6 && I.my < 0.3 && I.my > -0.3) {
      // step off sideways
      P.state = 'air'; P.pipe = null; P.coolPipe = 0.4; P.vx = sign(I.mx) * 2.5; P.vy = 0; P.fallFrom = P.y; P.airT = 0;
    }
  }

  function stepRope(dt, I) {
    const r = P.rope, g = M.gDown * 0.72;
    if (P.buf > 0) {
      P.buf = 0;
      const vx = P.rLen * P.rW * Math.cos(P.rAng), vy = P.rLen * P.rW * Math.sin(P.rAng);
      P.state = 'air'; P.rope = null; P.coolRope = 0.45; P.jumping = true; P.airT = 0;
      P.vx = vx * 1.05; P.vy = Math.max(vy, 0) + 4.2; P.fallFrom = P.y;
      r.sway = P.rAng; r.swayW = P.rW * 0.6;
      ev('jump', { x: P.x, y: P.y, rope: true });
      return;
    }
    let a = -(g / P.rLen) * Math.sin(P.rAng);
    if (Math.abs(I.mx) > 0.2) { a += sign(I.mx) * M.ropePump / P.rLen * Math.cos(P.rAng); P.face = sign(I.mx); }
    P.rW += a * dt; P.rW *= 1 - 0.12 * dt;
    if (Math.abs(I.my) > 0.4) P.rLen = clamp(P.rLen - sign(I.my) * 1.8 * dt, 1.6, r.len);
    const oa = P.rAng, ox = P.x, oy = P.y;
    P.rAng = clamp(P.rAng + P.rW * dt, -1.35, 1.35);
    if (Math.abs(P.rAng) >= 1.35) P.rW *= -0.2;
    const hx = r.ax + Math.sin(P.rAng) * P.rLen, hy = r.ay - Math.cos(P.rAng) * P.rLen;
    P.x = hx; P.y = hy - P.h - 0.1;
    if (hitSolid(P.box())) { P.rAng = oa; P.rW *= -0.3; P.x = ox; P.y = oy; }
    r.sway = P.rAng;
    P.run += Math.abs(P.rW) * P.rLen * dt * 0.3;
    if (I.my < -0.6 && P.rLen >= r.len - 0.01 && Math.abs(P.rW) < 0.6) { P.state = 'air'; P.rope = null; P.coolRope = 0.5; P.vx = 0; P.vy = 0; P.fallFrom = P.y; }
  }

  P.startPull = function () { P.state = 'pull'; P.pullT = 0.38; ev('pull', { x: P.x }); };
  return P;
}
