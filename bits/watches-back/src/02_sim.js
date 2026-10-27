// =====================================================================
// The simulation: a spiral of concentric grooves (rings) that turn like
// gears, the traveller walking them, the gaze, and the eyes.
//
// Spatial model
//  - Ring k (0 = outermost) is a circular groove of radius rings[k].r.
//    Everything on a ring is stored in ring-local angles; its world angle
//    is local + phi[k].
//  - Wall k separates ring k from ring k+1 (wall N-1 separates the last
//    ring from the centre). A wall turns with the ring inside it (its
//    owner, k+1; the centre is owner N). Openings in it are doors.
//  - Barriers are radial walls across a groove (ring-local). Veils are
//    tall lashes on a wall that block sight (not movement).
//
// Rotation rule (one rule, always): the ring you stand on holds still
// under your feet; every other ring turns, alternating direction like
// gears. A held (pinned) eye in a groove is held still in the world, so
// its ring slides beneath it and it shoves whatever it meets.
// =====================================================================

function buildGeometry(def) {
  const n = def.n;
  const Ri = def.rIn || 1.9;
  const w = def.w || Math.min(2.3, (9.3 - Ri) / n);
  const rings = [], walls = [];
  for (let k = 0; k < n; k++) rings.push({ k, r: Ri + w * (n - k - 0.5), barriers: ((def.barriers && def.barriers[k]) || []).map(d => d * DEG) });
  for (let k = 0; k < n; k++) {
    const doors = ((def.doors && def.doors[k]) || []).map((d, i) => typeof d === 'number' ? { a: d * DEG } : Object.assign({}, d, { a: d.a * DEG }));
    doors.forEach((d, i) => { d.i = i; d.wscale = d.wscale || 1; d.sealed = !!d.sealed; });
    walls.push({ k, owner: k + 1, r: Ri + w * (n - k - 1), doors, veils: ((def.veils && def.veils[k]) || []).map(v => [v[0] * DEG, v[1] * DEG]) });
  }
  return { n, Ri, w, Ro: Ri + w * n, rings, walls, eyeScale: clamp(w / 2.1, 0.72, 1) };
}

function createSim(def, opt) {
  opt = opt || {};
  const G = buildGeometry(def);
  const N = G.n;
  const rng = makeRng((def.seed || 7) * 7919 + 13);
  const S = {
    def, G, N, t: 0, steps: 0, rings: G.rings, walls: G.walls,
    phi: new Array(N + 1).fill(0),
    eyes: [], groups: [], knots: [], causes: [],
    events: [], over: null, reached: false,
    rotVel: 0, rotInput: 0, forcedRot: 0, jam: 0, rotLocked: !def.rotation,
    gaze: { point: null, dir: [0, 1], target: null },
    stats: { pins: 0, chains: 0, bestChain: 0, reveals: 0, walked: 0, walkSigned: 0, rotated: 0, pinTime: 0, longestPin: 0, unravels: 0, choirBreaks: 0, crossings: 0, closeCalls: 0 },
    walkHist: new Float32Array(600), walkIdx: 0,
    rec: [], habit: opt.habit || { dir: 0 },
    flags: {}, hint: null,
  };
  const pupilR = G.Ri * RULES.pupilFrac;
  const gear = k => (k % 2 === 0 ? 1 : -1);
  S.gear = gear;

  // ---------- player ----------
  const pk = (def.player && def.player.k) || 0;
  S.P = { k: pk, a: (def.player && def.player.a !== undefined ? def.player.a : -90) * DEG, v: 0, rad: RULES.playerRad, crossT: 0, crossFrom: G.rings[pk].r, exposure: 0, marked: 0, stagger: 0, w: 0, moved: 0, bump: 0, alive: true };

  // ---------- eyes ----------
  const byName = {};
  (def.eyes || []).forEach((src, i) => addEye(src));
  function addEye(src) {
    const T = EYE_TYPES[src.type];
    const e = Object.assign({
      id: S.eyes.length, name: src.name || ('e' + S.eyes.length), type: src.type,
      k: src.k || 0, a: (src.a || 0) * DEG, rad: T.rad * (src.size || 1) * G.eyeScale, spd: T.spd * (src.speed || 1),
      lethal: T.lethal, solid: T.solid, pinnable: T.pinnable, inWall: !!T.inWall, anchored: !!T.anchored,
      decoy: !!T.decoy, immune: !!T.immune, feigns: !!T.feigns,
      state: src.wake || src.wakeAfterWalk ? ST.DORMANT : ST.ACTIVE, wake: src.wake || src.wakeAfterWalk || 0, wakeAfterWalk: !!src.wakeAfterWalk, wakeNear: src.wakeNear === undefined ? 1.7 : src.wakeNear,
      beh: src.beh || defaultBeh(src.type), dir: src.dir || 1, pause: 0,
      acq: 0, rel: 0, stun: 0, debt: 0, lunge: 0, pinTheta: 0, pinT: 0,
      group: null, knot: null, cause: null, causeT: -99,
      look: [0, 0], blinkAt: 1 + rng() * 4, seenT: 0, absorbT: 0,
      moved: 0, lead: src.lead || 0, delay: src.delay || 0.9, mirror: src.mirror || 1, track: src.track || null, trackI: src.trackOffset || 0,
      fix: 0, fixId: -1, fixCool: 0, aim: 0, seeing: false, acquiring: false, stare: false,
      face: src.face || 'out', sweep: (src.sweep === undefined ? 30 : src.sweep) * DEG, period: src.period || 6, phase: (src.phase || 0) * DEG,
      range: src.range || 6.5, half: (src.half || 18) * DEG, gather: 0, pulledBy: -1,
      wall: src.wall === undefined ? -1 : src.wall, crossCool: 0, stunTo: ST.ACTIVE,
    }, src.extra || {});
    if (e.inWall) { e.wall = src.wall; e.k = src.wall + 1; }
    if (e.decoy) e.lookFix = (src.lookAt || rng() * 360) * DEG;
    e.aim = 0;
    byName[e.name] = e;
    S.eyes.push(e);
    return e;
  }
  function defaultBeh(type) {
    return { watcher: 'stalk', drifter: 'drift', collector: 'collect', liar: 'stalk', mimic: 'mimic', choir: 'stalk', crown: 'stalk', unblinking: 'hunt', echo: 'echo' }[type] || 'still';
  }
  S.addEye = src => { const e = addEye(src); if (e.wake) e.state = ST.DORMANT; return e; };
  S.eye = name => byName[name];

  // formations (choirs and the crown)
  (def.choirs || []).forEach(c => {
    const g = { id: S.groups.length, name: c.name || 'choir', crown: !!c.crown, members: c.members.map(m => byName[m].id), order: c.members.map(m => byName[m].id),
      conductor: byName[c.conductor].id, dir: c.dir || 1, spd: c.spd || 0.95, pause: 0, rip: c.ripple || 2.4, period: c.ripple || 2.4, broken: false, breaks: 0, needBreaks: c.breaks || 3, reform: 0 };
    for (const id of g.members) S.eyes[id].group = g.id;
    S.groups.push(g);
  });
  // doors held open by an eye
  for (const w of S.walls) for (const d of w.doors) if (d.lid) d.lidId = byName[d.lid].id;

  // ---------- geometry helpers ----------
  const eyeR = e => (e.inWall ? S.walls[e.wall].r : S.rings[e.k].r);
  const eyeTheta = e => e.a + S.phi[e.k];
  S.eyeR = eyeR; S.eyeTheta = eyeTheta;
  S.eyePos = (e, out) => { out = out || [0, 0]; const r = eyeR(e), th = eyeTheta(e); out[0] = r * Math.cos(th); out[1] = r * Math.sin(th); return out; };
  S.playerTheta = () => S.P.a + S.phi[S.P.k];
  S.playerR = () => S.rings[S.P.k].r;
  S.playerPos = out => { out = out || [0, 0]; const r = S.playerR(), th = S.playerTheta(); out[0] = r * Math.cos(th); out[1] = r * Math.sin(th); return out; };
  S.doorTheta = (w, d) => d.a + S.phi[w.owner];
  S.doorOpen = d => !d.sealed && (d.lidId === undefined || HELD(S.eyes[d.lidId].state));
  const alive = e => e.state !== ST.DEAD;
  const groove = e => !e.inWall;
  // bodies that stop things moving in a groove
  const blocksEyes = e => alive(e) && groove(e) && e.solid && e.state !== ST.REVEALED;
  // contact: arc distance along a ring between local angles
  const arc = (k, a, b) => Math.abs(wrap(a - b)) * S.rings[k].r;

  function ev(type, o) { const e = Object.assign({ type, t: S.t }, o || {}); S.events.push(e); return e; }

  // ---------- chains: one deliberate act, several visible consequences ----------
  function newCause(eye, kind) {
    const c = { id: S.causes.length, eye: eye ? eye.id : -1, kind: kind || 'pin', t: S.t, links: new Set(), level: 0 };
    S.causes.push(c);
    if (eye) { eye.cause = c.id; eye.causeT = S.t; }
    return c;
  }
  const CAUSE_WINDOW = 7;
  function liveCause(e) { return e && e.cause !== null && S.t - S.causes[e.cause].t < CAUSE_WINDOW ? S.causes[e.cause] : null; }
  // `who` reacted because of something carrying a cause; it now carries it too
  function react(cause, whoKey, who) {
    if (!cause) return;
    if (who && who.id !== cause.eye && (who.cause !== cause.id)) { who.cause = cause.id; who.causeT = S.t; }
    if (whoKey === cause.eye) return;
    if (!cause.links.has(whoKey) && who) ev('link', { from: cause.eye, to: who.id, cause: cause.id });
    cause.links.add(whoKey);
    const n = cause.links.size;
    if (n >= 2 && n > cause.level) {
      if (cause.level < 2) S.stats.chains++;
      cause.level = n; S.stats.bestChain = Math.max(S.stats.bestChain, n);
      ev('chain', { cause: cause.id, n, eye: cause.eye });
    }
  }

  // ---------- occlusion ----------
  const _ts = [];
  // is the sight line from (ax,ay) to (bx,by) blocked? ignore up to two eyes (the looker and the looked-at)
  function occluded(ax, ay, bx, by, ig1, ig2) {
    if (segPointDist(ax, ay, bx, by, 0, 0).d < pupilR) return 'pupil';
    for (const w of S.walls) {
      if (!w.veils.length) continue;
      segCircle(ax, ay, bx, by, w.r, _ts);
      for (const t of _ts) {
        const th = Math.atan2(ay + (by - ay) * t, ax + (bx - ax) * t) - S.phi[w.owner];
        for (const v of w.veils) if (inArc(wrap0(th), wrap0(v[0]), wrap0(v[1]))) return 'veil';
      }
    }
    const p = [0, 0];
    for (const e of S.eyes) {
      if (e === ig1 || e === ig2 || !alive(e) || e.decoy || e.state === ST.REVEALED) continue;
      S.eyePos(e, p);
      const r = segPointDist(ax, ay, bx, by, p[0], p[1]);
      if (r.d < e.rad * 0.72 && r.t > 0.03 && r.t < 0.97) return e;
    }
    return null;
  }
  S.occluded = occluded;

  // ---------- movement along a ring ----------
  // obstacles for a body of radius rad at local angle a on ring k moving by dA (radians).
  // Returns { dA: allowed, hit: body|'barrier'|'player'|null }
  function probe(k, a, rad, dA, self, opts) {
    if (!dA) return { dA: 0, hit: null };
    const dir = dA > 0 ? 1 : -1, r = S.rings[k].r;
    let max = Math.abs(dA), hit = null;
    for (const b of S.rings[k].barriers) {
      const d = wrap(b - a) * dir;
      if (d > 0) { const gap = d - (rad + 0.12) / r; if (gap < max) { max = Math.max(0, gap); hit = 'barrier'; } }
    }
    for (const o of S.eyes) {
      if (o === self || o.k !== k || !blocksEyes(o)) continue;
      if (opts && opts.group !== undefined && o.group === opts.group && o.state === ST.ACTIVE) continue;
      const d = wrap(o.a - a) * dir;
      if (d > 0) { const gap = d - (rad + o.rad) / r; if (gap < max) { max = Math.max(0, gap); hit = o; } }
    }
    if (opts && opts.player && S.P.k === k) {
      const d = wrap(S.P.a - a) * dir;
      if (d > 0) { const gap = d - (rad + S.P.rad) / r; if (gap < max) { max = Math.max(0, gap); hit = 'player'; } }
    }
    return { dA: max * dir, hit };
  }
  function moveEye(e, dA, opts) {
    const res = probe(e.k, e.a, e.rad, dA, e, opts || (e.lethal ? null : { player: true }));
    e.a = wrap(e.a + res.dA);
    e.moved += Math.abs(res.dA) * S.rings[e.k].r;
    if (res.hit && typeof res.hit === 'object') {
      const c = liveCause(res.hit);
      if (c && (HELD(res.hit.state) || res.hit.cause === c.id)) react(c, e.id, e);
    }
    return res;
  }
  // which way along ring k from local a reaches local target t, respecting barriers
  function dirTo(k, a, t) {
    const bars = S.rings[k].barriers;
    const diff = wrap(t - a);
    if (!bars.length) return Math.abs(diff) < 1e-4 ? 0 : sign(diff);
    let ccwBar = TAU, cwBar = TAU;
    for (const b of bars) { ccwBar = Math.min(ccwBar, wrap0(b - a)); cwBar = Math.min(cwBar, wrap0(a - b)); }
    const ccw = wrap0(t - a), cw = wrap0(a - t);
    if (ccw < 1e-4 || cw < 1e-4) return 0;
    if (ccw < ccwBar && (cw >= cwBar || ccw <= cw)) return 1;
    if (cw < cwBar) return -1;
    // unreachable: lean against the end nearest the target
    const endCcw = a + ccwBar, endCw = a - cwBar;
    return Math.abs(wrap(t - endCcw)) < Math.abs(wrap(t - endCw)) ? 1 : -1;
  }
  S.dirTo = dirTo;

  // ---------- rotation ----------
  function pushChain(k, mover, amt, snap, depth) {
    if (depth > 16) return false;
    const dir = amt > 0 ? 1 : -1, mag = Math.abs(amt), r = S.rings[k].r;
    for (const b of S.rings[k].barriers) {
      const d = wrap(b - mover.a) * dir;
      if (d > 0 && d - (mover.rad + 0.12) / r < mag - 1e-9) return false;
    }
    for (const o of S.eyes) {
      if (o === mover || o.k !== k || !blocksEyes(o)) continue;
      const d = wrap(o.a - mover.a) * dir;
      if (d <= 0) continue;
      const gap = d - (mover.rad + o.rad) / r;
      if (gap < mag - 1e-9) {
        if (o.anchored || HELD(o.state) || o.state === ST.KNOT) return false;
        const need = (mag - Math.max(0, gap)) * dir;
        if (!pushChain(k, o, need, snap, depth + 1)) return false;
        if (!o.shoved) { o.shoved = true; const c = liveCause(mover); if (c) react(c, o.id, o); }
      }
    }
    snap.push(mover, mover.a);
    mover.a = wrap(mover.a + amt);
    return true;
  }
  function rotateStep(d) {
    const snap = [];
    const phi0 = S.phi.slice();
    for (let k = 0; k <= N; k++) if (k !== S.P.k) S.phi[k] += gear(k) * d;
    for (const e of S.eyes) {
      if (!HELD(e.state) || e.inWall || e.k === S.P.k || !alive(e)) continue;
      if (!pushChain(e.k, e, -gear(e.k) * d, snap, 0)) {
        for (let i = snap.length - 2; i >= 0; i -= 2) snap[i].a = snap[i + 1];
        S.phi = phi0;
        return false;
      }
    }
    return true;
  }
  function rotate(delta) {
    if (!delta) return 0;
    const subs = Math.ceil(Math.abs(delta) / 0.006), d = delta / subs;
    let done = 0;
    for (let i = 0; i < subs; i++) {
      if (!rotateStep(d)) { if (S.jam <= 0) ev('jam'); S.jam = 0.3; break; }
      done += d;
    }
    return done;
  }
  S.rotate = rotate;

  // ---------- the traveller ----------
  // best door on the wall in direction dirIn from the player's world angle
  function nearestDoor(wallIdx, th, needOpen) {
    if (wallIdx < 0 || wallIdx >= N) return null;
    const w = S.walls[wallIdx];
    let best = null, bd = 1e9;
    for (const d of w.doors) {
      if (needOpen && !S.doorOpen(d)) continue;
      const dth = wrap(S.doorTheta(w, d) - th), dd = Math.abs(dth);
      if (dd < bd) { bd = dd; best = { w, d, dth, arc: dd * w.r }; }
    }
    return best;
  }
  S.nearestDoor = nearestDoor;
  function landingBlock(k2, a2, rad) {
    if (k2 >= N) return null;
    const r = S.rings[k2].r;
    for (const b of S.rings[k2].barriers) if (Math.abs(wrap(b - a2)) * r < rad + 0.12) return 'barrier';
    for (const e of S.eyes) {
      if (e.k !== k2 || !groove(e) || !alive(e) || !e.solid || e.state === ST.REVEALED) continue;
      const dd = Math.abs(wrap(e.a - a2)) * r;
      if (dd < rad + e.rad) return e;
    }
    return null;
  }
  function tryCross(inward) {
    const P = S.P, th = S.playerTheta();
    const wi = inward ? P.k : P.k - 1;
    const nd = nearestDoor(wi, th, true);
    if (!nd) return false;
    if (nd.arc > RULES.doorHalf * nd.d.wscale - P.rad * 0.5) return false;
    const k2 = inward ? P.k + 1 : P.k - 1;
    if (k2 === N) { S.reached = true; P.k2 = N; ev('reach'); return true; }
    const a2 = wrap(th - S.phi[k2]);
    const blk = landingBlock(k2, a2, P.rad);
    if (blk && (blk === 'barrier' || !(blk.lethal && (blk.state === ST.ACTIVE || blk.state === ST.FEIGN)))) {
      if (P.bump <= 0) { ev('bump', { by: blk === 'barrier' ? -1 : blk.id }); P.bump = 0.5; }
      return false;
    }
    P.crossFrom = S.rings[P.k].r; P.crossT = RULES.crossTime;
    ev('cross', { from: P.k, to: k2, wall: wi, door: nd.d.i });
    P.k = k2; P.a = a2; P.v = 0; S.stats.crossings++;
    return true;
  }
  function stepPlayer(input, dt) {
    const P = S.P;
    P.bump -= dt; P.moved = 0;
    const m = input.move || [0, 0];
    const th = S.playerTheta();
    const tx = -Math.sin(th), ty = Math.cos(th), ux = Math.cos(th), uy = Math.sin(th);
    const vt = m[0] * tx + m[1] * ty, vr = m[0] * ux + m[1] * uy;
    let target = vt * RULES.walk;
    if (P.stagger > 0) { P.stagger -= dt; target = 0; }
    else if (P.crossT > 0) { P.crossT -= dt; target = 0; }
    else if (Math.abs(vr) > 0.45 && Math.abs(vr) >= Math.abs(vt) * 0.85) {
      const inward = vr < 0;
      if (tryCross(inward)) return;
      const nd = nearestDoor(inward ? P.k : P.k - 1, th, false);
      if (nd && nd.arc < RULES.doorAssist && nd.arc > 0.04) target = sign(nd.dth) * RULES.walk * Math.min(1, Math.abs(vr) * 1.2);
    }
    P.v = damp(P.v, target, RULES.walkAccel, dt);
    if (Math.abs(P.v) < 1e-3) P.v = 0;
    const r = S.rings[P.k].r;
    let dA = P.v * dt / r;
    if (dA) {
      // the traveller is stopped by barriers and by anything solid that will not kill them
      const dir = sign(dA);
      let max = Math.abs(dA);
      for (const b of S.rings[P.k].barriers) { const d = wrap(b - P.a) * dir; if (d > 0) max = Math.min(max, Math.max(0, d - (P.rad + 0.12) / r)); }
      for (const e of S.eyes) {
        if (e.k !== P.k || !groove(e) || !alive(e) || !e.solid || e.state === ST.REVEALED) continue;
        if (e.lethal && (e.state === ST.ACTIVE || e.state === ST.FEIGN)) continue;
        const d = wrap(e.a - P.a) * dir;
        if (d > 0) max = Math.min(max, Math.max(0, d - (P.rad + e.rad) / r));
      }
      if (max < Math.abs(dA) - 1e-9) { P.v = 0; }
      dA = max * dir;
      P.a = wrap(P.a + dA);
    }
    P.w = dA / dt;
    P.moved = Math.abs(dA) * r;
    S.stats.walked += P.moved; S.stats.walkSigned += dA;
    S.walkHist[S.walkIdx] = dA; S.walkIdx = (S.walkIdx + 1) % S.walkHist.length;
    if ((S.steps & 3) === 0) S.rec.push(Math.round(P.w * 1000) / 1000);
  }

  // ---------- gaze ----------
  const _pp = [0, 0], _ep = [0, 0];
  function targetable(e) { return alive(e) && e.state !== ST.REVEALED && !e.hidden; }
  function selectTarget() {
    const g = S.gaze;
    if (!g.point) return null;
    S.playerPos(_pp);
    const dx = g.point[0] - _pp[0], dy = g.point[1] - _pp[1], l = Math.hypot(dx, dy);
    if (l > 0.08) { g.dir[0] = dx / l; g.dir[1] = dy / l; }
    let best = null, bs = 1e9, bd = 1e9;
    for (const e of S.eyes) {
      if (!targetable(e)) continue;
      S.eyePos(e, _ep);
      const vx = _ep[0] - _pp[0], vy = _ep[1] - _pp[1], d = Math.hypot(vx, vy);
      if (d < 1e-3) continue;
      const off = Math.acos(clamp((vx * g.dir[0] + vy * g.dir[1]) / d, -1, 1));
      const cone = RULES.gazeCone + Math.asin(Math.min(1, e.rad / d));
      if (off > cone) continue;
      if (occluded(_pp[0], _pp[1], _ep[0], _ep[1], e, null)) continue;
      const s = off - (e.id === g.target ? RULES.gazeStick : 0);
      if (s < bs - 1e-6 || (Math.abs(s - bs) <= 1e-6 && (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && e.id < best.id)))) { best = e; bs = s; bd = d; }
    }
    return best;
  }
  S.selectTarget = selectTarget;
  function pin(e) {
    const prev = e.state;
    e.state = ST.PINNED; e.acq = 0; e.pinTheta = eyeTheta(e); e.pinT = S.t; e.wasDormant = prev === ST.DORMANT;
    S.stats.pins++;
    const c = newCause(e, 'pin');
    ev('pin', { eye: e.id });
    if (e.group !== null) onGroupPin(e, c, prev);
  }
  function unpin(e) {
    e.state = ST.ACTIVE; e.pause = 0.25;
    const held = S.t - e.pinT; S.stats.longestPin = Math.max(S.stats.longestPin, held);
    ev('release', { eye: e.id, held });
  }
  function stepGaze(dt) {
    const tgt = selectTarget();
    const prevT = S.gaze.target;
    S.gaze.target = tgt ? tgt.id : null;
    if (prevT !== S.gaze.target && tgt) ev('target', { eye: tgt.id });
    const knotHit = new Set();
    for (const e of S.eyes) {
      if (!alive(e)) continue;
      const isT = tgt === e;
      e.acquiring = false; e.stare = false;
      if (e.state === ST.KNOT) { if (isT) knotHit.add(e.knot); continue; }
      if (e.decoy) {
        if (e.state === ST.REVEALED) continue;
        if (isT) { e.acq += dt; e.acquiring = true; if (e.acq >= 0.45) { e.state = ST.REVEALED; S.stats.reveals++; ev('reveal', { eye: e.id }); } }
        else e.acq = Math.max(0, e.acq - dt);
        continue;
      }
      if (e.immune) { if (isT) { e.stare = true; if (!e.stared) ev('immune', { eye: e.id }); } e.stared = isT; continue; }
      if (e.feigns) {
        if (e.state === ST.FEIGN) {
          if (isT) e.debt = Math.min(4, e.debt + dt);
          else { e.state = ST.ACTIVE; e.lunge = e.debt * 1.75; ev('lunge', { eye: e.id, debt: e.debt }); e.debt = 0; }
        } else if (e.state === ST.ACTIVE || e.state === ST.DORMANT) {
          if (isT) { e.acq += dt; e.acquiring = true; if (e.acq >= RULES.acquire) { e.state = ST.FEIGN; e.acq = 0; e.debt = 0; S.stats.pins++; ev('feign', { eye: e.id }); } }
          else e.acq = 0;
        }
        continue;
      }
      if (!e.pinnable) continue;
      if (e.state === ST.PINNED) { S.stats.pinTime += dt; if (!isT) { e.state = ST.RELEASING; e.rel = RULES.release; } }
      else if (e.state === ST.RELEASING) { if (isT) e.state = ST.PINNED; else { e.rel -= dt; if (e.rel <= 0) unpin(e); } }
      else if (isT) { e.acq += dt; e.acquiring = true; if (e.acq >= RULES.acquire) pin(e); }
      else e.acq = Math.max(0, e.acq - dt * 2);
    }
    for (const kn of S.knots) {
      if (knotHit.has(kn.id)) { kn.unravel += dt; kn.gazed = true; } else { kn.unravel = Math.max(0, kn.unravel - dt * 0.6); kn.gazed = false; }
      if (kn.unravel >= 1.2) unravel(kn);
    }
    S.knots = S.knots.filter(k => !k.done);
  }

  // ---------- formations ----------
  function onGroupPin(e, cause, prev) {
    const g = S.groups[e.group];
    if (g.broken) return;
    if (g.crown) {
      // only the conductor of a whole, singing crown breaks; anything else held only jams it
      if (e.id !== g.conductor || prev === ST.STUNNED) return;
      // the jewel breaks: that eye closes for good; the rest reel, then reform around the next
      e.state = ST.DEAD; e.group = null; g.breaks++;
      ev('crownBreak', { eye: e.id, breaks: g.breaks });
      const rest = g.members.filter(id => S.eyes[id].state !== ST.DEAD && S.eyes[id].group === g.id);
      for (const id of rest) { const m = S.eyes[id]; m.state = ST.STUNNED; m.stun = 2.6; m.stunTo = ST.ACTIVE; react(cause, id, m); }
      if (g.breaks >= g.needBreaks || rest.length < 2) {
        g.broken = true;
        for (const id of rest) { const m = S.eyes[id]; m.state = ST.DEAD; }
        ev('crownFall', { group: g.id });
      } else {
        const ord = g.order.filter(id => rest.includes(id));
        g.conductor = ord[(ord.indexOf(g.order[(g.order.indexOf(e.id) + 1) % g.order.length]) + ord.length) % ord.length] || ord[0];
        if (!rest.includes(g.conductor)) g.conductor = ord[0];
        g.rip = 2.8;
      }
      if (S.gaze.target === e.id) S.gaze.target = null;
      return;
    }
    if (e.id === g.conductor) {
      g.broken = true;
      ev('choirBreak', { group: g.id });
      S.stats.choirBreaks++;
      for (const id of g.members) {
        const m = S.eyes[id];
        if (m.group !== g.id) continue;
        m.group = null; m.beh = 'stalk'; m.spd *= 0.55;
        if (m !== e) { m.state = ST.STUNNED; m.stun = 2.6; m.stunTo = ST.ACTIVE; react(cause, id, m); }
      }
    } else {
      e.group = null; e.beh = 'stalk'; e.spd *= 0.7;
      ev('detach', { eye: e.id, group: g.id });
    }
  }
  function stepGroups(dt) {
    for (const g of S.groups) {
      if (g.broken) continue;
      const mov = g.members.map(id => S.eyes[id]).filter(m => m.group === g.id && m.state === ST.ACTIVE);
      // ripple: the conductor blinks first, the rest follow in order of distance from it
      g.rip -= dt;
      if (g.rip <= 0) {
        g.rip = g.period;
        const ci = g.order.indexOf(g.conductor);
        g.order.forEach((id, i) => { const m = S.eyes[id]; if (m.group === g.id) m.blinkAt = S.t + 0.13 * Math.min(Math.abs(i - ci), g.order.length - Math.abs(i - ci)); });
        ev('ripple', { group: g.id, conductor: g.conductor });
      }
      if (S.t < RULES.graceStart || !mov.length) continue;
      if (g.pause > 0) { g.pause -= dt; continue; }
      const cond = S.eyes[g.conductor];
      const rRef = S.rings[(cond && cond.state !== ST.DEAD ? cond : mov[0]).k].r;
      const dA = g.dir * g.spd * dt / rRef;
      let allow = Math.abs(dA), hit = null;
      for (const m of mov) {
        const res = probe(m.k, m.a, m.rad, dA, m, { group: g.id });
        if (Math.abs(res.dA) < allow) { allow = Math.abs(res.dA); hit = res.hit; }
      }
      for (const m of mov) { m.a = wrap(m.a + allow * g.dir); m.moved += allow * S.rings[m.k].r; }
      if (allow < Math.abs(dA) * 0.5) {
        g.dir = -g.dir; g.pause = 0.3;
        ev('turn', { group: g.id, by: hit && typeof hit === 'object' ? hit.id : -1 });
        if (hit && typeof hit === 'object') { const c = liveCause(hit); if (c) react(c, 'g' + g.id, null); }
      }
    }
  }

  // ---------- gatherings ----------
  // collectors gather eyes that look; the blind drifter is never gathered
  const gatherable = o => groove(o) && o.state === ST.ACTIVE && o.group === null && o.lethal && !o.immune && !o.decoy && o.type !== 'collector';
  S.gatherable = gatherable;
  function cluster(c) {
    const out = [c], seen = new Set([c.id]);
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      for (const o of S.eyes) {
        if (seen.has(o.id) || o.k !== c.k || !gatherable(o)) continue;
        if (arc(c.k, a.a, o.a) <= a.rad + o.rad + 0.1) { seen.add(o.id); out.push(o); }
      }
    }
    return out;
  }
  function stepGather(dt) {
    for (const c of S.eyes) {
      if (c.type !== 'collector' || c.state !== ST.ACTIVE || S.t < RULES.graceStart) { if (c.type === 'collector') c.gather = Math.max(0, c.gather - dt); continue; }
      const cl = cluster(c);
      c.clusterN = cl.length;
      if (cl.length >= 3) {
        c.gather += dt;
        if (c.gather >= 1.5) {
          const kn = { id: S.knots.length ? S.knots[S.knots.length - 1].id + 1 : 0, members: cl.map(e => e.id), unravel: 0, k: c.k };
          for (const e of cl) { e.state = ST.KNOT; e.knot = kn.id; }
          S.knots.push(kn); c.gather = 0;
          ev('knot', { members: kn.members });
        }
      } else c.gather = Math.max(0, c.gather - dt * 0.5);
    }
  }
  function unravel(kn) {
    kn.done = true;
    const c = newCause(null, 'unravel');
    S.stats.unravels++;
    // the knot bursts: members are flung apart along the groove, away from its middle
    const mem = kn.members.map(id => S.eyes[id]);
    const mid = Math.atan2(mem.reduce((s, e) => s + Math.sin(e.a), 0), mem.reduce((s, e) => s + Math.cos(e.a), 0));
    for (const e of mem) { e.knot = null; e.state = ST.STUNNED; e.stun = e.type === 'collector' ? 4 : 2.2; e.stunTo = ST.ACTIVE; react(c, e.id, e); }
    const r = S.rings[kn.k].r;
    const order = mem.slice().sort((a, b) => Math.abs(wrap(b.a - mid)) - Math.abs(wrap(a.a - mid)));
    order.forEach((e, i) => {
      const d = wrap(e.a - mid);
      const dir = Math.abs(d) * r < 0.2 ? (e.id % 2 ? 1 : -1) : sign(d);
      moveEye(e, dir * (i < order.length - 1 ? 2.8 : 1.5) / r, { player: true });
    });
    ev('unravel', { members: kn.members });
  }

  // ---------- behaviours ----------
  function stalkTarget(e) {
    const P = S.P;
    let th = S.playerTheta();
    if (e.lead) th += clamp(P.w * e.lead, -1.2, 1.2);
    return wrap(th - S.phi[e.k]);
  }
  function stepEye(e, dt) {
    e.moved = 0; e.shoved = false;
    if (e.state === ST.DORMANT) {
      if (!e.wakeAfterWalk || S.stats.walked > 0.5) e.wake -= dt;
      const near = e.k === S.P.k && groove(e) && arc(e.k, e.a, S.P.a) < e.wakeNear + e.rad;
      if (e.wake <= 0 || near) { e.state = ST.ACTIVE; e.pause = 0.4; ev('wake', { eye: e.id }); }
      return;
    }
    if (e.state === ST.STUNNED) { e.stun -= dt; if (e.stun <= 0) { e.state = e.stunTo; ev('recover', { eye: e.id }); } return; }
    if (e.state !== ST.ACTIVE || e.inWall || e.group !== null) return;
    if (S.t < RULES.graceStart) return;
    if (e.pause > 0) { e.pause -= dt; return; }
    const r = S.rings[e.k].r;
    // a collector's pull overrides what an eye would otherwise do
    if (e.pulledBy >= 0) {
      const c = S.eyes[e.pulledBy];
      if (arc(e.k, e.a, c.a) <= e.rad + c.rad + 0.08) return;   // held in the gathering
      const d = dirTo(e.k, e.a, c.a);
      moveEye(e, d * Math.max(e.spd, 0.7) * 0.85 * dt / r);
      return;
    }
    switch (e.beh) {
      case 'stalk': {
        const t = stalkTarget(e), d = dirTo(e.k, e.a, t);
        let spd = e.spd;
        if (e.lunge > 0) spd = 3.4;
        let dA = d * spd * dt / r;
        if (e.k !== S.P.k) { const rem = Math.abs(wrap(t - e.a)); if (Math.abs(dA) > rem) dA = d * rem; }
        const res = moveEye(e, dA);
        if (e.lunge > 0) { e.lunge -= Math.abs(res.dA) * r; if (Math.abs(res.dA) < 1e-6) e.lunge = Math.max(0, e.lunge - dt * 3); }
        break;
      }
      case 'patrol': case 'drift': {
        const res = moveEye(e, e.dir * e.spd * dt / r);
        if (Math.abs(res.dA) < Math.abs(e.dir * e.spd * dt / r) * 0.5) {
          e.dir = -e.dir; e.pause = e.beh === 'drift' ? 0.5 : 0.3;
          ev('turn', { eye: e.id, by: res.hit && typeof res.hit === 'object' ? res.hit.id : (res.hit || -1) });
        }
        break;
      }
      case 'collect': {
        // drift toward the nearest eye on this ring that is free to gather
        let best = null, bd = 1e9;
        for (const o of S.eyes) {
          if (o === e || o.k !== e.k || !gatherable(o)) continue;
          const dd = arc(e.k, e.a, o.a);
          if (dd < bd) { bd = dd; best = o; }
        }
        e.colTarget = best ? best.id : -1;
        if ((e.clusterN || 1) >= 2) break;   // it has company; now it waits and draws the rest in
        if (best && bd > e.rad + best.rad + 0.06) {
          const d = dirTo(e.k, e.a, best.a);
          const res = moveEye(e, d * e.spd * dt / r);
          if (res.hit && typeof res.hit === 'object' && res.hit !== best && HELD(res.hit.state)) e.colBlocked = res.hit.id; else e.colBlocked = -1;
        }
        break;
      }
      case 'mimic': {
        const steps = Math.round(e.delay / SIM_DT);
        const len = S.walkHist.length;
        const d = S.walkHist[((S.walkIdx - steps) % len + len) % len];
        if (d) moveEye(e, d * (e.mirror || 1));
        break;
      }
      case 'echo': {
        if (!e.track || !e.track.length) break;
        // a recording of the traveller, sampled every 4 steps, replayed on a loop
        const w = e.track[Math.floor(e.trackI / 4) % e.track.length] * (e.trackScale || 1);
        e.trackI++;
        if (w) moveEye(e, w * dt * (S.rings[e.trackK || e.k] ? 1 : 1));
        break;
      }
      case 'hunt': hunt(e, dt); break;
    }
  }
  function hunt(e, dt) {
    const P = S.P, r = S.rings[e.k].r;
    if (e.k === P.k) { const t = stalkTarget(e); moveEye(e, dirTo(e.k, e.a, t) * e.spd * dt / r); return; }
    e.crossCool -= dt;
    const inward = P.k > e.k;
    const wi = inward ? e.k : e.k - 1;
    const th = eyeTheta(e);
    const nd = nearestDoor(wi, th, true);
    if (!nd) { const t = stalkTarget(e); moveEye(e, dirTo(e.k, e.a, t) * e.spd * dt / r); return; }
    if (nd.arc < RULES.doorHalf * nd.d.wscale * 0.5 && e.crossCool <= 0) {
      const k2 = inward ? e.k + 1 : e.k - 1;
      const a2 = wrap(th - S.phi[k2]);
      const blk = landingBlock(k2, a2, e.rad);
      if (!blk || blk === null) { ev('eyeCross', { eye: e.id, from: e.k, to: k2 }); e.k = k2; e.a = a2; e.crossCool = 0.6; e.pause = 0.25; return; }
    }
    const tLocal = wrap(S.doorTheta(nd.w, nd.d) - S.phi[e.k]);
    const d = dirTo(e.k, e.a, tLocal);
    let dA = d * e.spd * dt / r;
    const rem = Math.abs(wrap(tLocal - e.a)); if (Math.abs(dA) > rem) dA = d * rem;
    moveEye(e, dA);
  }
  function stepAbsorb(dt) {
    for (const u of S.eyes) {
      if (!u.immune || u.state !== ST.ACTIVE) continue;
      for (const o of S.eyes) {
        if (o === u || o.k !== u.k || !groove(o) || !alive(o) || o.immune || o.anchored || HELD(o.state) || o.state === ST.KNOT || o.decoy) { continue; }
        if (arc(u.k, u.a, o.a) <= u.rad + o.rad + 0.05) {
          o.absorbT += dt;
          if (o.absorbT >= 0.8) { o.state = ST.DEAD; o.group = null; ev('absorb', { eye: o.id, by: u.id }); }
        } else o.absorbT = Math.max(0, o.absorbT - dt);
      }
    }
  }

  // ---------- sentinels ----------
  function inCone(s, sp, x, y) {
    const vx = x - sp[0], vy = y - sp[1], d = Math.hypot(vx, vy);
    if (d > s.range || d < 1e-3) return false;
    return Math.abs(wrap(Math.atan2(vy, vx) - s.aim)) <= s.half;
  }
  S.inCone = inCone;
  const _sp = [0, 0], _op = [0, 0];
  function stepSentinels(dt) {
    let seen = false;
    for (const s of S.eyes) {
      if (s.type !== 'sentinel' || !alive(s)) continue;
      S.eyePos(s, _sp);
      const th = eyeTheta(s);
      const base = s.face === 'in' ? th + Math.PI : s.face === 'cw' ? th - Math.PI / 2 : s.face === 'ccw' ? th + Math.PI / 2 : th;
      let aim = base + s.sweep * Math.sin(TAU * S.t / s.period + s.phase);
      s.fixCool -= dt;
      if (s.fix > 0) {
        s.fix -= dt;
        const o = S.eyes[s.fixId];
        if (o && alive(o)) { S.eyePos(o, _op); const want = Math.atan2(_op[1] - _sp[1], _op[0] - _sp[0]); aim = base + clamp(wrap(want - base), -1.1, 1.1); }
        if (s.fix <= 0) s.fixCool = 1.6;
      }
      s.aim = aim;
      s.seeing = false;
      s.watching = s.state === ST.ACTIVE && !s.acquiring;
      if (!s.watching || S.t < RULES.graceStart) continue;
      // a moving eye crossing its gaze draws it away
      if (s.fix <= 0 && s.fixCool <= 0) {
        for (const o of S.eyes) {
          if (o === s || !alive(o) || o.inWall || o.decoy || o.moved < 1e-4 || o.state !== ST.ACTIVE) continue;
          S.eyePos(o, _op);
          if (inCone(s, _sp, _op[0], _op[1]) && !occluded(_sp[0], _sp[1], _op[0], _op[1], s, o)) {
            s.fix = 1.6; s.fixId = o.id; ev('fixate', { eye: s.id, on: o.id });
            const c = liveCause(o); if (c) react(c, s.id, s);
            break;
          }
        }
      }
      S.playerPos(_pp);
      if (inCone(s, _sp, _pp[0], _pp[1]) && !occluded(_sp[0], _sp[1], _pp[0], _pp[1], s, null)) {
        s.seeing = true; seen = true;
        S.P.exposure += RULES.exposureRate * dt;
        if (S.P.exposure >= 1) { capture('seen', s); return; }
      }
    }
    if (!seen) S.P.exposure = Math.max(0, S.P.exposure - RULES.exposureDecay * dt);
  }

  // ---------- contact ----------
  function capture(kind, e) {
    if (S.over) return;
    S.over = { kind, eye: e ? e.id : -1, type: e ? e.type : null, t: S.t };
    S.P.alive = false;
    ev('capture', S.over);
  }
  S.capture = capture;
  function strike(e) {
    const P = S.P, r = S.rings[P.k].r;
    P.marked = RULES.markTime;
    S.stats.strikes = (S.stats.strikes || 0) + 1;
    // thrown away from the eye along the groove, as far as the groove allows
    const away = sign(wrap(P.a - e.a)) || 1;
    const want = away * RULES.knockback / r;
    let max = Math.abs(want);
    for (const b of S.rings[P.k].barriers) { const dd = wrap(b - P.a) * away; if (dd > 0) max = Math.min(max, Math.max(0, dd - (P.rad + 0.12) / r)); }
    for (const o of S.eyes) {
      if (o === e || o.k !== P.k || !groove(o) || !alive(o) || !o.solid || o.state === ST.REVEALED) continue;
      const dd = wrap(o.a - P.a) * away;
      if (dd > 0) max = Math.min(max, Math.max(0, dd - (P.rad + o.rad + 0.05) / r));
    }
    P.a = wrap(P.a + away * max); P.v = 0; P.stagger = 0.35;
    // the eye recoils: it stops, and a lunging liar spends its lunge
    e.pause = Math.max(e.pause, 1.2); e.lunge = 0;
    if (e.group !== null) S.groups[e.group].pause = Math.max(S.groups[e.group].pause, 1.2);
    ev('strike', { eye: e.id });
  }
  S.strike = strike;
  function stepContact() {
    const P = S.P;
    if (P.marked > 0) P.marked -= SIM_DT;
    let nearest = 1e9;
    for (const e of S.eyes) {
      if (e.k !== P.k || !groove(e) || !e.lethal) continue;
      if (e.state !== ST.ACTIVE && e.state !== ST.FEIGN) continue;
      const d = arc(P.k, e.a, P.a);
      if (d < e.rad * RULES.contactSlack + P.rad) {
        // a first touch strikes and throws you clear; a second while marked, or anything that cannot be held, takes you
        if (P.marked > 0 || e.immune || e.type === 'crown' || def.noStrike) { capture('contact', e); return; }
        strike(e); return;
      }
      nearest = Math.min(nearest, d - e.rad - P.rad);
    }
    if (nearest < 0.35 && !S._close) { S._close = true; S.stats.closeCalls++; ev('close'); }
    if (nearest > 1.2) S._close = false;
  }

  // ---------- look targets for pupils (what each eye is attending to) ----------
  function stepLooks() {
    S.playerPos(_pp);
    for (const e of S.eyes) {
      if (!alive(e)) continue;
      if (HELD(e.state) || e.state === ST.KNOT) continue; // a held pupil stops tracking
      S.eyePos(e, _ep);
      let lx = _pp[0], ly = _pp[1];
      if (e.decoy) { lx = _ep[0] + Math.cos(e.lookFix) * 5; ly = _ep[1] + Math.sin(e.lookFix) * 5; }
      else if (e.state === ST.FEIGN) { lx = 2 * _ep[0] - _pp[0]; ly = 2 * _ep[1] - _pp[1]; }
      else if (e.type === 'sentinel') { lx = _ep[0] + Math.cos(e.aim) * 5; ly = _ep[1] + Math.sin(e.aim) * 5; }
      else if (e.beh === 'drift' && e.state === ST.ACTIVE) { const th = eyeTheta(e) + e.dir * 0.6; const r = eyeR(e); lx = r * Math.cos(th); ly = r * Math.sin(th); }
      else if (e.type === 'collector' && e.colTarget >= 0) { S.eyePos(S.eyes[e.colTarget], _op); lx = _op[0]; ly = _op[1]; }
      e.look[0] = lx; e.look[1] = ly;
    }
  }
  function stepBlinks() {
    for (const e of S.eyes) {
      if (e.decoy || e.immune || e.group !== null || HELD(e.state)) continue;
      if (S.t > e.blinkAt + 0.2) e.blinkAt = S.t + (e.state === ST.FEIGN ? 0.55 + rng() * 0.3 : 2.4 + rng() * 4.5);
    }
  }

  // ---------- step ----------
  S.step = function (input) {
    const dt = SIM_DT;
    S.events.length = 0;
    if (S.over || S.reached) return;
    input = input || {};
    S.t += dt; S.steps++;
    S.jam -= dt;
    if (input.gaze !== undefined) S.gaze.point = input.gaze ? [input.gaze[0], input.gaze[1]] : null;
    // rotation (the dial, plus anything the spiral does to itself)
    const want = S.rotLocked ? 0 : clamp(input.rot || 0, -1, 1) * (def.rotMax || RULES.rotMax);
    S.rotVel = S.jam > 0 && sign(want) === sign(S.rotVel) ? 0 : damp(S.rotVel, want, RULES.rotSmooth, dt);
    if (Math.abs(S.rotVel) < 1e-4) S.rotVel = 0;
    const turned = rotate((S.rotVel + S.forcedRot) * dt);
    S.stats.rotated += Math.abs(turned);
    S.rotDone = turned / dt;
    if (def.script && def.script.pre) def.script.pre(S, dt);
    stepPlayer(input, dt);
    if (S.reached) return;
    stepGaze(dt);
    // collector pull
    for (const e of S.eyes) e.pulledBy = -1;
    for (const c of S.eyes) {
      if (c.type !== 'collector' || c.state !== ST.ACTIVE || S.t < RULES.graceStart) continue;
      for (const o of S.eyes) {
        if (o === c || o.k !== c.k || !gatherable(o)) continue;
        // a collector already holding one eye reaches further for the next
        if (arc(c.k, c.a, o.a) < ((c.clusterN || 1) >= 2 ? 6.5 : 3.6)) o.pulledBy = c.id;
      }
    }
    for (const e of S.eyes) stepEye(e, dt);
    stepGroups(dt);
    stepAbsorb(dt);
    stepGather(dt);
    stepSentinels(dt);
    if (!S.over) stepContact();
    stepLooks();
    stepBlinks();
    if (def.script && def.script.step) def.script.step(S, dt);
  };
  S.liveCause = liveCause;
  S.newCause = newCause;
  S.react = react;
  S.ev = ev;

  if (def.script && def.script.init) def.script.init(S, opt);
  stepLooks();
  return S;
}
