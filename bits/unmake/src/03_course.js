// =====================================================================
// Encounters: authored structures with explicit dependencies, composed
// into an endless route. Every encounter offers at least two approaches
// (usually: spend a charge to change the structure, or use movement skill).
// Validation settles each solution's physics, then checks that a route of
// walkable surfaces connects entry to exit within the traveller's jumps.
// =====================================================================

const JUMP = { cruise: 3.9, sprint: 5.4, up: 1.45 };   // conservative, from the movement model

class Builder {
  constructor(P, origin, seg, rng, d) {
    this.P = P; this.o = origin; this.seg = seg; this.rng = rng; this.d = d;
    this.keys = {}; this.decor = []; this.pickups = []; this.bodies = []; this.conns = [];
  }
  w(x, y, z) { return [this.o[0] + x, this.o[1] + y, this.o[2] + z]; }
  key(k, o) { if (k) { this.keys[k] = o; o.key = k; } return o; }
  body(o, k) {
    o.pos = this.w(o.pos[0], o.pos[1], o.pos[2]);
    if (o.pivot) o.pivot = this.w(o.pivot[0], o.pivot[1], o.pivot[2]);
    o.seg = this.seg;
    const b = this.P.addBody(o);
    this.bodies.push(b);
    return this.key(k, b);
  }
  // a walkable slab whose top is at y, running from local za down to zb (za > zb)
  deck(za, zb, opts) {
    opts = opts || {};
    const w = opts.w || 3.2, y = opts.y || 0, th = opts.th || 0.6, x = opts.x || 0;
    return this.body(Object.assign({ type: 'static', pos: [x, y - th / 2, (za + zb) / 2], size: [w / 2, th / 2, (za - zb) / 2], style: opts.style || 'deck' }, opts.extra || {}), opts.key);
  }
  conn(o, k) {
    const fix = e => e.body ? e : { world: this.w(e.world[0], e.world[1], e.world[2]) };
    o.a = fix(o.a); o.b = fix(o.b); o.seg = this.seg;
    const c = this.P.addConn(o);
    this.conns.push(c);
    return this.key(k, c);
  }
  dec(type, props) {
    const p = Object.assign({ type }, props);
    if (p.at) p.at = this.w(p.at[0], p.at[1], p.at[2]);
    if (p.to) p.to = this.w(p.to[0], p.to[1], p.to[2]);
    this.decor.push(p);
    return p;
  }
  pick(kind, x, y, z, opts) {
    const p = Object.assign({ kind, pos: this.w(x, y, z), alive: true, seg: this.seg }, opts || {});
    this.pickups.push(p);
    return p;
  }
  // jumpable steps from y0 up/down to y1, starting at local z going forward
  stairs(z, y0, y1, x, w, style) {
    const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 1.05));
    for (let i = 1; i <= n; i++) {
      const top = lerp(y0, y1, i / n);
      const bot = Math.min(y0, y1) - 0.6;
      this.body({ type: 'static', pos: [x || 0, (top + bot) / 2, z - (i - 0.5) * 1.3], size: [(w || 2.6) / 2, (top - bot) / 2, 0.65], style: style || 'terrace' });
    }
    return z - n * 1.3;
  }
  // a walkable ramp from (z, y0) forward to (z - len, y1)
  ramp(z, y0, y1, x, w, len, style) {
    const a = Math.atan2(y1 - y0, len), hl = Math.hypot(len, y1 - y0) / 2, th = 0.3;
    const rot = qAxis([1, 0, 0], a);
    const n = qRot(rot, [0, 1, 0]);
    const mid = [x || 0, (y0 + y1) / 2 - n[1] * th, z - len / 2 - n[2] * th];
    this.body({ type: 'static', pos: mid, rot, size: [(w || 2.6) / 2, th, hl], style: style || 'ramp' });
    return z - len;
  }
  salvage(z0, z1, x, y, n) { for (let i = 0; i < n; i++) this.pick('salvage', x, y + 0.9, lerp(z0, z1, n === 1 ? 0.5 : i / (n - 1))); }
}

const sol = (name, acts, o) => Object.assign({ name, acts: acts || [] }, o || {});

const FAMILIES = {
  // ------------------------------------------------------------------
  // Old terraces of the first settlement: movement for its own sake.
  approach: {
    tier: 0, rest: true,
    build(b, rng, d) {
      let z = 0, y = 0, x = 0;
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const len = rng.range(4, 7);
        const w = rng.chance(0.25 + d * 0.3) && i > 0 ? 0.7 : rng.range(2.6, 3.6);
        b.deck(z, z - len, { x, y, w, style: w < 1 ? 'beam' : 'terrace' });
        if (i === 1 && rng.chance(0.5)) b.salvage(z - 1, z - len + 1, x, y, 3);
        z -= len;
        if (i < n - 1) {
          const hy = b.o[1] + y;
          const dy = rng.chance(0.5) ? rng.pick(hy > 3 ? [-0.35, -0.9, -0.9] : hy < -3 ? [0.3, 0.8, 0.8] : [-0.35, 0.3, -0.9, 0.8]) : 0;
          const gap = rng.chance(0.7) ? rng.range(1.4, (dy > 0.4 ? 2.3 : 2.6) + d * 0.7) : 0;
          const dx = rng.chance(0.4) ? rng.pick([-1.1, 1.1]) : 0;
          if (gap === 0 && dy > 0.4) { z -= 0.5; }
          z -= gap; y += dy; x = clamp(x + dx, -1.6, 1.6);
        }
      }
      // an optional relic on a side ledge reached by a deliberate jump
      if (rng.chance(0.35)) {
        const lz = -rng.range(4, -z - 4);
        b.deck(lz + 1.2, lz - 1.2, { x: x + 4.6, y: y + 0.9, w: 1.8, style: 'terrace' });
        b.pick('relic', x + 4.6, y + 1.9, lz);
      }
      b.deck(z, z - 3, { x: 0, y, w: 3.2, style: 'terrace' });
      z -= 3;
      b.dec('dwellings', { at: [0, y, z / 2], len: -z });
      return { len: -z, exit: [0, y], need: 0, solutions: [sol('run', [])] };
    }
  },

  // ------------------------------------------------------------------
  // The threshold: the preservers sealed this crossing. A glazed wall blocks
  // the high road; the floor before it is glazed infill over the old street.
  // Unmake the wall and keep the height (then: unmake the props and let the
  // lintel down as a bridge, or sprint and leap the gap). Or unmake the floor
  // and drop to the old street, where something was sealed away. A missed
  // leap lands in the old street too: a fall costs time, not the run.
  threshold: {
    tier: 0,
    build(b, rng, d) {
      const la = rng.range(6, 7.5);                 // entry
      const lf = rng.range(3.4, 3.9);               // glazed infill
      const lb = rng.range(5.8, 6.6);               // high road
      const gap = rng.range(4.4, 4.7) + d * 0.2;
      const zF = -la, zB = zF - lf, zG = zB - lb, zC = zG - gap;
      const ly = -3.8;
      b.deck(0, zF, { w: 3.2, style: 'terrace' });
      const floor = b.deck(zF, zB, { w: 3.2, style: 'preserved', key: 'floor', extra: { erase: true } });
      void floor;
      b.deck(zB, zG, { w: 3.2, style: 'span' });
      b.body({ type: 'static', pos: [0, 1.45, zB - 0.6], size: [1.7, 1.45, 0.35], style: 'preserved', erase: true }, 'wall');
      // the lintel, held high over the gap by a preservation scaffold
      const lz = (zG + zC) / 2, lh = gap / 2 + 1.3, top = 4.15;
      const lintel = b.body({ type: 'static', fallable: true, pos: [0, top + 0.2, lz], size: [1.5, 0.2, lh], mass: 5, style: 'lintel', holdsAny: true }, 'lintel');
      const props = [];
      for (const z of [zG + 0.4, zC - 0.4]) for (const x of [-1.3, 1.3]) props.push(b.body({ type: 'static', pos: [x, top / 2, z], size: [0.18, top / 2, 0.18], style: 'preserved', erase: true, eraseGroup: 'props' + b.seg }, null));
      b.key('props', props[0]);
      lintel.holds = props.map(p => p.id);
      // the old street below: a landing under the infill, a channel, a stair back up
      b.deck(zF - 0.2, zG - 4, { y: ly, w: 3.0, style: 'channel', extra: { low: true } });
      const zc0 = zG - 2.4, zc1 = zC - 4.5, cx = -2.9;
      b.deck(zc0, zc1, { y: ly, x: cx, w: 2.6, style: 'channel', extra: { low: true } });
      const zs = b.ramp(zc1 + 0.1, ly, 0, cx, 2.6, 8.4);
      b.deck(zC, zs, { w: 3.2, style: 'span' });
      const zEnd = zs - 5;
      b.deck(zs + 0.1, zEnd, { w: 7.0, x: -1.7, style: 'span' });
      b.pick('relic', 0, ly + 1.0, (zB + zG) / 2 - 0.5);
      b.salvage(zF - 1, zF - lf + 0.6, 0, ly, 2);
      b.salvage(zG + 1.5, zB - 2.2, 0, 0, 2);
      b.dec('dwellings', { at: [0, 0, -la / 2], len: la });
      return {
        len: -zEnd, exit: [0, 0], need: 1,
        solutions: [sol('wall, then lintel', ['wall', 'props']), sol('wall, then leap', ['wall'], { skill: true, sprint: true }), sol('floor', ['floor'], { relic: true })]
      };
    }
  },

  // ------------------------------------------------------------------
  // Shutters: a causeway the preservers closed off, wall after wall. Read
  // them at speed: the glazed ones can be unmade as you run; the old stone
  // one in the middle cannot, and the way past it is the side beam. The
  // last shutter stands at the lip of a gap, so unmake it early and keep
  // your run-up.
  shutters: {
    tier: 1,
    build(b, rng, d) {
      const side = rng.chance(0.5) ? 1 : -1;
      const z1 = -rng.range(7.5, 9), z2 = z1 - rng.range(6, 7), z3 = z2 - rng.range(6, 7);
      const zEnd = z3 - 1.6, gap = rng.range(2.8, 3.2) + d * 0.4;
      b.deck(0, -5, { w: 3.2, style: 'terrace' });
      b.deck(-5, zEnd, { w: 2.6, style: 'span' });
      b.body({ type: 'static', pos: [0, 1.4, z1], size: [1.35, 1.4, 0.3], style: 'preserved', erase: true }, 'w1');
      b.body({ type: 'static', pos: [0, 1.45, z2], size: [1.35, 1.45, 0.4], style: 'oldWall' }, 'stone');
      b.body({ type: 'static', pos: [0, 1.4, z3], size: [1.35, 1.4, 0.3], style: 'preserved', erase: true }, 'w3');
      // the way round the stone: a beam along the side, close enough to step onto
      b.deck(z2 + 2.6, z2 - 2.6, { x: side * 1.75, w: 0.9, style: 'beam' });
      b.salvage(z2 + 1.6, z2 - 1.6, side * 1.75, 0, 3);
      const zx = zEnd - gap;
      b.deck(zx, zx - 6, { w: 4.0, style: 'terrace' });
      b.dec('dwellings', { at: [0, 0, zx - 3], len: 6 });
      return { len: -(zx - 6), exit: [0, 0], need: 2, solutions: [sol('read the glaze', ['w1', 'w3'])] };
    }
  },

  // ------------------------------------------------------------------
  // A bridge leaf held up by a tension cable. Sever it and the bridge drops
  // into place — or take the restrained root along the side, if your feet
  // are good enough.
  drawbridge: {
    tier: 0,
    build(b, rng, d) {
      const gap = rng.range(6.6, 7.4);
      b.deck(0, -8, { w: 4.8, x: 0.8 });
      const z1 = -8 - gap;
      b.deck(z1, z1 - 7, { w: 4.8, x: 0.8 });
      const L = gap + 0.5;
      const raised = 1.32;
      const leaf = b.body({ type: 'hinge', pos: [0, -0.25, z1 + L / 2], size: [1.5, 0.25, L / 2], pivot: [0, 0, z1], axis: [1, 0, 0], ang: 0, min: 0, max: 0, mass: 5, style: 'leaf', comOff: [0, 0, 0] }, 'leaf');
      // raise it: rotate about the pivot so the leaf stands up toward the traveller
      leaf.ang = -raised; leaf.min = -raised; leaf.max = 0; leaf.lockAt = 'max'; leaf.damping = 0.6;
      P_hingeSet(b.P, leaf);
      const tip = b.P.toWorld(leaf, [0, 0.25, L / 2]);
      const anchor = [0, 0 + 7.6, z1 - 3.2];
      const cable = b.conn({ style: 'cable', role: 'sever', a: { body: leaf.id, local: [0, 0.25, L / 2 - 0.3] }, b: { world: anchor } }, 'cable');
      leaf.holds = [cable.id];
      b.dec('tensionTower', { at: [0, 0, z1 - 3.2], h: 7.6, toward: 1 });
      // the skill route: a restrained root running along the right side, broken in the middle
      const rx = 3.1;
      const half = gap / 2 - 1.1;
      b.body({ type: 'static', pos: [rx, -0.2, -8 - half / 2 + 0.6], size: [0.32, 0.25, half / 2 + 0.6], style: 'root' });
      b.body({ type: 'static', pos: [rx, -0.2 + 0.25, z1 + half / 2 - 0.6], size: [0.32, 0.25, half / 2 + 0.6], style: 'root' });
      b.pick('salvage', rx, 1.2, -8 - gap / 2);
      b.dec('rootClamp', { at: [rx, -0.2, -8 - 0.4] });
      b.dec('rootClamp', { at: [rx, 0.05, z1 + 0.4] });
      return {
        len: -(z1 - 7), exit: [0.8, 0], need: 1,
        solutions: [sol('sever', ['cable']), sol('root', [], { skill: true })]
      };
    }
  },

  // ------------------------------------------------------------------
  // A balance bridge pinned wrong by a hanging ballast. Cut the ballast and
  // it levels — or walk out over the pivot and let your own weight tip it.
  counterpoise: {
    tier: 1,
    build(b, rng, d) {
      const gap = rng.range(9.5, 10.5);
      b.deck(0, -6, {});
      const z1 = -6 - gap;
      b.deck(z1, z1 - 6, {});
      const pz = -6 - gap / 2;
      const half = gap / 2 + 0.3;
      b.body({ type: 'static', pos: [0, -9, pz], size: [0.7, 8.6, 0.7], style: 'pier' });
      const up = 0.3;
      const plank = b.body({ type: 'hinge', pos: [0, -0.2, pz], size: [1.5, 0.2, half], pivot: [0, 0, pz], axis: [1, 0, 0], ang: up, min: 0, max: up, mass: 2.4, comOff: [0, 0, -1.1], damping: 1.6, style: 'balance', lockAt: 'min' }, 'plank');
      P_hingeSet(b.P, plank);
      // ballast hangs from the near end on a chain
      const nearEnd = b.P.toWorld(plank, [0, -0.2, half - 0.6]);
      const ballast = b.P.addBody({ type: 'rest', pos: [nearEnd[0], nearEnd[1] - 2.2, nearEnd[2]], size: [0.7, 0.7, 0.7], mass: 1.45, style: 'counterweight', seg: b.seg, solid: true });
      ballast.restOn = plank.id; ballast.restLocal = qRot(qConj(plank.rot), vSub(ballast.pos, plank.pos)); ballast.restRot = qConj(plank.rot);
      b.bodies.push(ballast); b.key('ballast', ballast);
      const chain = b.conn({ style: 'chain', role: 'sever', a: { body: plank.id, local: [0, -0.2, half - 0.6] }, b: { body: ballast.id, local: [0, 0.7, 0] } }, 'chain');
      ballast.holds = [chain.id];
      chain.onCut = (P, tag) => { ballast.type = 'free'; ballast.vel = [0, 0, 0]; ballast.restOn = null; ballast.tag = tag; plank.tag = tag; plank.moving = true; P.emit({ type: 'release', body: ballast, tag, pos: ballast.pos.slice() }); };
      b.salvage(pz + 2, pz - 2, 0, 0.3, 3);
      b.dec('pivotFrame', { at: [0, 0, pz] });
      return { len: -(z1 - 6), exit: [0, 0], need: 1, solutions: [sol('cut ballast', ['chain']), sol('ride', [], { skill: true, dynamic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A cradle hung across a chasm from two cables. Jump across it as it
  // sways — or cut the near cable and it swings down into a ramp toward
  // an older lower route, where something has been waiting.
  cradle: {
    tier: 1,
    build(b, rng, d) {
      const g = rng.range(2.6, 3.2);
      b.deck(0, -6, { w: 6.6, x: -1.7 });
      const L = 5.2;
      const cz = -6 - g - L / 2;
      const cr = b.body({ type: 'suspend', pos: [0, -0.25, cz], size: [1.4, 0.25, L / 2], style: 'cradle', mass: 3, swingMin: -0.62, swingMax: 0.62 }, 'cradle');
      cr.attachA = [0, 0.25, L / 2 - 0.3]; cr.attachB = [0, 0.25, -L / 2 + 0.3];
      const cA = b.conn({ style: 'cable', role: 'sever', a: { body: cr.id, local: cr.attachA }, b: { world: [0, 8, cz + L / 2 - 0.3] } }, 'near');
      const cB = b.conn({ style: 'cable', role: 'sever', a: { body: cr.id, local: cr.attachB }, b: { world: [0, 8, cz - L / 2 + 0.3] } }, 'far');
      cr.cableA = cA.id; cr.cableB = cB.id;
      const z1 = cz - L / 2 - g;
      // the old lower route: a dry channel beside and below, climbing back up
      const ly = -4.2, lx = -2.9;
      b.deck(cz - L / 2 + 1.2, z1 - 2, { y: ly, x: lx, w: 2.4, style: 'channel' });
      const zs = b.stairs(z1 - 2, ly, 0, lx, 2.4);
      b.deck(z1, zs, { w: 3.2 });
      b.deck(zs, zs - 4, { w: 6.6, x: -1.7 });
      b.pick('relic', lx, ly + 1.1, cz - L / 2 - 2.2);
      b.salvage(z1 + 1, z1 - 2, lx, ly, 3);
      b.dec('gantry', { at: [0, 0, cz], h: 8, span: L - 0.6 });
      return { len: -(zs - 4), exit: [0, 0], need: 0, solutions: [sol('jump across', []), sol('swing down', ['far'], { relic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A great root held up out of the way by a restraint clamp. Pull the pin
  // and it drops across the gap as a bridge; its weight springs a sealed
  // casket on the far bank. Or sprint and leap the gap beneath it.
  root: {
    tier: 1, signature: true,
    build(b, rng, d) {
      const gap = rng.range(4.6, 4.9);
      b.deck(0, -7, { w: 4.4, x: -0.6 });
      const z1 = -7 - gap;
      b.deck(z1, z1 - 8, { w: 5.0, x: -0.9 });
      const L = gap + 2.0;
      const hy = 5.4;
      const root = b.body({ type: 'static', fallable: true, pos: [0, hy, -7 - gap / 2], size: [0.55, 0.3, L / 2], mass: 6, style: 'rootBridge' }, 'root');
      const pin = b.conn({ style: 'pin', role: 'redirect', a: { world: [0, hy + 2.6, -7 - gap / 2] }, b: { body: root.id, local: [0, 0.3, 0] } }, 'pin');
      root.holds = [pin.id];
      b.dec('restraintFrame', { at: [0, hy - 2.2, -7 - gap / 2], h: 4.9 });
      // the casket on the far bank, sealed until something heavy lands
      const cx = -2.6, czz = z1 - 3.2;
      const casket = b.body({ type: 'kin', pos: [cx, -1.5, czz], size: [0.6, 0.5, 0.6], style: 'casket', passable: true }, 'casket');
      casket.solid = false;
      casket.motion = (P, c, dt) => { if (c.rising) { c.pos[1] = Math.min(c.top, c.pos[1] + 3 * dt); if (c.pos[1] >= c.top && !c.done) { c.done = true; P.emit({ type: 'lift', body: c, tag: c.tag, pos: c.pos.slice() }); } } };
      casket.top = b.o[1] + 0.2;
      const relic = b.pick('relic', cx, -1.0, czz, { ride: casket.id, sealed: true });
      const lever = b.body({ type: 'static', pos: [-1.5, 0.15, z1 - 0.9], size: [0.12, 0.08, 0.9], style: 'lever', passable: true, walk: false }, 'lever');
      root.onLanded = (P, tag) => { if (casket.rising) return; casket.rising = true; casket.tag = tag; relic.sealed = false; P.emit({ type: 'strike', body: lever, tag, pos: lever.pos.slice() }); };
      b.dec('casketWell', { at: [cx, 0, czz] });
      return { len: -(z1 - 8), exit: [-0.9, 0], need: 1, solutions: [sol('release root', ['pin'], { chain: true }), sol('sprint jump', [], { skill: true, sprint: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A counterweight swinging across a narrow causeway. Time the crossing,
  // or cut its chain as it swings outward and send it through the old
  // repair wall beside the path.
  pendulum: {
    tier: 1,
    build(b, rng, d) {
      b.deck(0, -5, {});
      b.deck(-5, -15, { w: 1.8, style: 'causeway' });
      b.deck(-15, -21, {});
      const pz = -10;
      const L = 6.4;
      const amp = rng.range(0.85, 0.95);
      const bob = b.body({ type: 'pend', pos: [0, 0, pz], size: [0.75, 0.75, 0.75], shape: 'sphere', r: 0.75, pivot: [0, L + 0.9, pz], axis: [0, 0, 1], L, mode: 'driven', amp, omega: lerp(1.25, 1.55, d), phase: rng.range(0, TAU), phi: 0, phiVel: 0, style: 'weight', brittle: true, passable: true }, 'bob');
      const rod = b.conn({ style: 'chain', role: 'redirect', a: { world: [0, L + 0.9, pz] }, b: { body: bob.id, local: [0, 0.75, 0] } }, 'rod');
      bob.rod = rod.id;
      // the repair wall out to the side, with a sealed alcove behind it
      const side = 2.9;
      b.body({ type: 'static', pos: [side + 0.35, 0.8, pz], size: [0.35, 2.4, 2.0], style: 'repairWall', hp: 3, fragile: true }, 'wall');
      b.deck(pz + 2.2, pz - 2.2, { x: side + 2.3, y: 0, w: 3.6, style: 'terrace' });
      b.pick('relic', side + 2.6, 1.0, pz);
      b.deck(pz + 3.5, pz - 3.5, { x: 0, y: -5.2, w: 5, style: 'net' });
      b.body({ type: 'static', pos: [0, -2.6, pz - 4.6], size: [1.5, 2.6, 1.1], style: 'terrace' });
      b.dec('gantry', { at: [0, 0, pz], h: L + 0.9, span: 0.5, across: true });
      return { len: 21, exit: [0, 0], need: 0, solutions: [sol('time it', [], { timing: true }), sol('redirect', ['rod'], { relic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // Terraces held up by a frayed brace. Step on and they start to go: ride
  // them down to the lower route. Or break through the repair wall ahead
  // and keep the high road.
  collapse: {
    tier: 2,
    build(b, rng, d) {
      b.deck(0, -4, { w: 6.8, x: 1.8 });
      const n = 4, len = 3.0, drop = 1.2;
      const ts = [];
      for (let i = 0; i < n; i++) {
        const za = -4 - i * len, zb = za - len + 0.15;
        const t = b.body({ type: 'kin', pos: [0, -0.3, (za + zb) / 2], size: [1.6, 0.3, (za - zb) / 2], style: 'terraceSlab', crusher: false }, 't' + i);
        t.y0 = t.pos[1]; t.y1 = t.y0 - drop * (i + 1) - 0.6; t.delay = 0.35 * i;
        t.motion = (P, s, dt) => {
          const start = s.start;
          if (start === undefined) return;
          const k = clamp((P.t - start - s.delay) / 1.1, 0, 1);
          const prev = s.pos[1];
          s.pos[1] = lerp(s.y0, s.y1, k * k * (3 - 2 * k));
          s.vy = (s.pos[1] - prev) / Math.max(dt, 1e-4);
          if (k >= 1 && !s.settled) { s.settled = true; P.emit({ type: 'impact', body: s, pos: s.pos.slice(), power: 9 }); }
        };
        ts.push(t);
      }
      const brace = b.conn({ style: 'brace', role: 'sever', a: { world: [-2.4, -3.4, -4.3] }, b: { body: ts[0].id, local: [-1.4, -0.3, 1.0] } }, 'brace');
      const startAll = (P, tag) => { for (const t of ts) if (t.start === undefined) { t.start = P.t; t.tag = tag; } P.emit({ type: 'release', body: ts[0], tag, pos: ts[0].pos.slice() }); };
      brace.onCut = (P, tag) => startAll(P, tag);
      brace.fray = { warn: 0.7, trigger: P => P.player && P.player.pos[2] < b.o[2] - 4.6 && P.player.pos[1] > b.o[1] - 0.5 };
      brace.onSnap = startAll;
      const zEnd = -4 - n * len;
      // the lower route the terraces settle onto
      const ly = -drop * n - 0.6;
      b.deck(zEnd, zEnd - 6, { y: ly, style: 'channel' });
      b.salvage(zEnd - 1, zEnd - 5, 0, ly, 3);
      // the high road: blocked by generations of repairs
      b.deck(-4, zEnd - 9, { x: 3.8, y: 0, w: 2.0, style: 'terrace' });
      b.body({ type: 'static', pos: [3.8, 1.4, zEnd - 2.2], size: [1.0, 1.4, 0.35], style: 'preserved', erase: true }, 'wall');
      b.pick('relic', 3.8, 1.0, zEnd - 6);
      // the two roads rejoin
      const zs = b.stairs(zEnd - 6, ly, 0, 0, 2.6);
      b.deck(Math.min(zs, zEnd - 9), Math.min(zs, zEnd - 9) - 4, { y: 0, w: 6.8, x: 1.8 });
      if (zs > zEnd - 9) b.deck(zs, zEnd - 9, { y: 0, w: 2.6 });
      const rz = Math.min(zs, zEnd - 9) - 4;
      return { len: -rz, exit: [0, 0], need: 0, solutions: [sol('ride down', ['brace']), sol('high road', ['wall'], { relic: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A drained lock basin. Dismantle the sluice gate and the water returns,
  // floating the old barge up to the walkway. Or cross on the staggered
  // posts the lock-keepers once used.
  sluice: {
    tier: 2,
    build(b, rng, d) {
      b.deck(0, -6, { w: 6.4, x: -1.2 });
      const len = 9.5;
      const z1 = -6 - len;
      b.deck(z1, z1 - 6, { w: 6.4, x: -1.2 });
      const floorY = -6;
      b.body({ type: 'static', pos: [-1.2, floorY - 0.5, -6 - len / 2], size: [3.4, 0.5, len / 2], style: 'basin' });
      const water = b.P.addWater({ x0: b.o[0] - 4.5, x1: b.o[0] + 2.1, z0: b.o[2] - 6, z1: b.o[2] + z1, level: b.o[1] + floorY, target: b.o[1] + floorY, rate: 2.2, center: b.w(-1.2, -1, -6 - len / 2), seg: b.seg });
      b.key('water', water);
      const barge = b.body({ type: 'kin', pos: [0, floorY + 0.35, -6 - len / 2], size: [1.3, 0.35, len / 2 - 0.25], style: 'barge' }, 'barge');
      barge.motion = (P, s) => { s.pos[1] = Math.max(b.o[1] + floorY + 0.35, water.level - 0.05); };
      // the gate sits low in a side channel, below the walkway: it can be reached by
      // intervention, never walked on
      const gate = b.body({ type: 'static', pos: [-4.6, -3.6, -6 - len / 2], size: [0.3, 1.6, 1.2], style: 'preserved', erase: true }, 'gate');
      gate.onBreak = (P, tag) => { water.target = b.o[1] - 0.45; water.tag = tag; water.done = false; P.emit({ type: 'release', body: gate, tag, pos: gate.pos.slice() }); };
      // the lock-keepers' posts
      const posts = [[-2.7, -3.6, 0.1], [-3.0, -8.35, 0.35]];
      for (const [x, z, y] of posts) b.body({ type: 'static', pos: [x, y - 3.5, -6 + z], size: [0.85, 3.5, 0.85], style: 'post' });
      b.pick('salvage', -3.0, 1.8, -6 - 8.35);
      // a lock-keeper's stair out of the basin: a fall costs time, not the run
      b.stairs(-6.8, floorY, 0, 1.75, 0.9, 'post');
      b.dec('reservoir', { at: [-6.5, 0, -6 - len / 2] });
      return { len: -(z1 - 6), exit: [-1.2, 0], need: 1, solutions: [sol('flood', ['gate']), sol('posts', [], { skill: true })] };
    }
  },

  // ------------------------------------------------------------------
  // A counterweighted lift to the upper city. Unlatch the counterweight and
  // ride up — or climb the root knuckles.
  lift: {
    tier: 1,
    build(b, rng, d) {
      const H = 4.6;
      b.deck(0, -6, { w: 8.4, x: -0.5 });
      const lift = b.body({ type: 'kin', pos: [-2.2, -0.2, -7.6], size: [1.3, 0.2, 1.4], style: 'liftDeck' }, 'lift');
      lift.y0 = lift.pos[1]; lift.y1 = lift.y0 + H; lift.vy = 0;
      lift.motion = (P, s, dt) => {
        if (!s.go) return;
        const prev = s.pos[1];
        s.pos[1] = Math.min(s.y1, s.pos[1] + 2.9 * dt);
        s.vy = (s.pos[1] - prev) / dt;
        if (s.pos[1] >= s.y1 && !s.done) { s.done = true; P.emit({ type: 'lift', body: s, tag: s.tag, pos: s.pos.slice() }); }
      };
      lift.onRelease = (P, tag) => { lift.go = true; lift.tag = tag; };
      const latch = b.conn({ style: 'pin', role: 'sever', a: { world: [-3.9, 0.9, -7.6] }, b: { body: lift.id, local: [-1.2, 0.2, 0] } }, 'latch');
      lift.holds = [latch.id];
      b.dec('liftFrame', { at: [-2.2, 0, -7.6], h: H + 3 });
      // the knuckle climb on the right
      const steps = [[3.2, -7.8, 1.2], [3.5, -10.0, 2.4], [3.15, -12.3, 3.6]];
      for (const [x, z, y] of steps) b.body({ type: 'static', pos: [x, y - 0.6, z], size: [0.85, 0.6, 0.85], style: 'knuckle' });
      b.deck(-5.9, -9.2, { w: 1.7, x: 3.2, y: 0, style: 'terrace' });
      b.deck(-9.2, -24, { y: H, w: 6.6, x: -1.0, style: 'terrace' });
      b.pick('salvage', 3.5, 2.4 + 1, -10);
      return { len: 24, exit: [-1.0, H], need: 1, solutions: [sol('ride lift', ['latch'], { ride: 'lift' }), sol('climb', [], { skill: true })] };
    }
  }
};

// set hinge transform after manual angle edits during building
function P_hingeSet(P, b) { b.lastRest = b.ang; P.hingeTransform(b); P.updateAxes(b); }

// root settle hook: called when the root bridge locks into place
(function hookSettle() {
  const orig = Phys.prototype.stepHinge;
  Phys.prototype.stepHinge = function (b, dt) {
    const was = b.lockedAt;
    orig.call(this, b, dt);
    if (was === undefined && b.lockedAt !== undefined && b.onSettle) b.onSettle(this, b.tag);
  };
  const origStep = Phys.prototype.step;
  Phys.prototype.step = function (dt) {
    // snapped connections may carry a custom consequence
    const before = this.conns.filter(c => c.alive && c.fray && c.onSnap);
    origStep.call(this, dt);
    for (const c of before) if (!c.alive && !c.snapHandled) { c.snapHandled = true; c.onSnap(this, null); }
  };
})();

// =====================================================================
// Validation: settle each solution, then search the walkable surfaces
// =====================================================================
function buildSegment(P, name, seed, d, origin, seg) {
  const rng = makeRng(seed);
  const b = new Builder(P, origin, seg, rng, d);
  const meta = FAMILIES[name].build(b, rng, d);
  Object.assign(meta, { name, keys: b.keys, decor: b.decor, pickups: b.pickups, bodies: b.bodies, conns: b.conns, origin: origin.slice(), seed, d });
  meta.exitPos = [origin[0] + meta.exit[0], origin[1] + meta.exit[1], origin[2] - meta.len];
  // how many things this stretch lets you unmake: enough for its biggest solution, no more
  if (meta.budget === undefined) meta.budget = Math.max(1, ...meta.solutions.map(s => s.acts.length));
  return meta;
}

function surfacesOf(P, bodies) {
  const out = [];
  for (const b of bodies) {
    if (!b.alive || !b.solid || b.walk === false || b.passable) continue;
    if (b.shape === 'sphere') continue;
    // the face whose normal points most upward
    let best = -1, bi = 1, sg = 1;
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) { const ny = b.ax[i][1] * s; if (ny > best) { best = ny; bi = i; sg = s; } }
    if (best < 0.75) continue;
    const j = (bi + 1) % 3, k = (bi + 2) % 3;
    const c = vAdd(b.pos, vScale(b.ax[bi], sg * b.size[bi]));
    const corners = [];
    for (const [a, e] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) corners.push(vAdd(c, vAdd(vScale(b.ax[j], a * b.size[j]), vScale(b.ax[k], e * b.size[k]))));
    out.push({ body: b, corners, minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])), minZ: Math.min(...corners.map(p => p[2])), maxZ: Math.max(...corners.map(p => p[2])), n: vScale(b.ax[bi], sg), c });
  }
  return out;
}
function surfY(s, x, z) { const n = s.n; return s.c[1] - (n[0] * (x - s.c[0]) + n[2] * (z - s.c[2])) / n[1]; }
function surfGap(a, b) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  const px = clamp((a.minX + a.maxX) / 2, b.minX, b.maxX), pz = clamp((a.minZ + a.maxZ) / 2, b.minZ, b.maxZ);
  const qx = clamp(px, a.minX, a.maxX), qz = clamp(pz, a.minZ, a.maxZ);
  return { h: Math.hypot(dx, dz), dy: surfY(b, px, pz) - surfY(a, qx, qz) };
}
function reachable(surfs, from, to, sprint) {
  const maxD = sprint ? JUMP.sprint : JUMP.cruise;
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const s = q.shift();
    if (s === to) return true;
    for (const t of surfs) {
      if (seen.has(t)) continue;
      const g = surfGap(s, t);
      let ok = false;
      if (g.h < 0.3 && g.dy <= MOVE.stepUp && g.dy > -1.4) ok = true;           // walk / step
      else if (g.dy <= JUMP.up && g.dy > -9) {
        const lim = maxD - Math.max(0, g.dy) * 1.1 + Math.min(1.2, Math.max(0, -g.dy) * 0.35);
        ok = g.h <= lim;
      }
      if (ok) { seen.add(t); q.push(t); }
    }
  }
  return false;
}

function validateSegment(name, seed, d) {
  const results = [];
  const probe = buildSegment(new Phys(), name, seed, d, [0, 0, 0], 0);
  for (const s of probe.solutions) {
    if (s.dynamic) { results.push({ name: s.name, ok: true, note: 'dynamic route (tested by simulation)' }); continue; }
    const P = new Phys();
    const lead = new Builder(P, [0, 0, 6], -1, makeRng(1), d); lead.deck(0, -6, {});
    const meta = buildSegment(P, name, seed, d, [0, 0, 0], 0);
    const tail = new Builder(P, meta.exitPos, 1, makeRng(2), d); tail.deck(0, -6, {});
    P.player = { pos: [0, 0, -1000] };
    for (const a of s.acts) {
      const o = meta.keys[a];
      if (!o) { results.push({ name: s.name, ok: false, why: 'missing ' + a }); continue; }
      if (o.isConn) P.sever(o); else if (o.erase) P.erase(o); else if (o.hp) P.dismantle(o, o.hp);
    }
    for (let i = 0; i < 60 * 6; i++) P.step(1 / 60);
    const surfs = surfacesOf(P, [...lead.bodies, ...meta.bodies, ...tail.bodies]);
    const from = surfs.find(x => x.body === lead.bodies[0]);
    const to = surfs.find(x => x.body === tail.bodies[0]);
    const ok = !!(from && to && reachable(surfs, from, to, !!s.sprint));
    let relic = true;
    if (s.relic) {
      const rp = meta.pickups.find(p => p.kind === 'relic');
      const rs = rp && surfs.filter(x => Math.abs(surfY(x, rp.pos[0], rp.pos[2]) - (rp.pos[1] - 1.0)) < 1.3 && rp.pos[0] >= x.minX - 0.5 && rp.pos[0] <= x.maxX + 0.5 && rp.pos[2] >= x.minZ - 0.5 && rp.pos[2] <= x.maxZ + 0.5);
      relic = !!(rs && rs.length && rs.some(x => reachable(surfs, from, x, !!s.sprint)));
    }
    results.push({ name: s.name, ok, relic, acts: s.acts.length });
  }
  const primaryOk = results[0].ok;
  const anyAlt = results.length < 2 || results.slice(1).some(r => r.ok);
  return { ok: primaryOk && anyAlt, results, meta: probe };
}

// =====================================================================
// Pacing: one idea at a time, then combinations, with breathing room.
// =====================================================================
const OPENING = ['approach', 'threshold', 'approach', 'drawbridge', 'cradle', 'approach', 'lift', 'counterpoise', 'approach', 'shutters', 'pendulum', 'approach', 'threshold', 'root', 'collapse', 'approach', 'sluice'];

class Sequencer {
  constructor(seed, opening) { this.rng = makeRng(seed); this.i = 0; this.opening = opening; this.hist = []; this.since = 0; }
  next(d, y) {
    let name;
    if (this.opening && this.i < OPENING.length) name = OPENING[this.i];
    else if (this.since >= (d > 0.6 ? 3 : 2)) name = 'approach';
    else {
      const maxTier = d < 0.2 ? 1 : 2;
      // keep the route within the basin's comfortable band of heights
      const pool = Object.keys(FAMILIES).filter(k => !FAMILIES[k].rest && FAMILIES[k].tier <= maxTier && k !== this.hist[this.hist.length - 1] && !(k === 'lift' && (y || 0) > 3));
      const wts = pool.map(k => { const recent = this.hist.slice(-6).filter(h => h === k).length; return Math.pow(0.3, recent) * (FAMILIES[k].tier === 2 ? lerp(0.6, 1.4, d) : 1); });
      let r = this.rng() * wts.reduce((a, c) => a + c, 0);
      name = pool[0];
      for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) { name = pool[i]; break; } }
    }
    this.i++;
    this.hist.push(name);
    this.since = FAMILIES[name].rest ? 0 : this.since + 1;
    return name;
  }
}
