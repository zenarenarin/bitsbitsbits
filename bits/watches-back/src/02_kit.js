// =====================================================================
// Authoring kit. Every call writes the simulation shape(s) and a visual
// descriptor from the same numbers, so what you see is what collides,
// and what blocks your view blocks theirs.
// =====================================================================

function makeKit(B, W) {
  const V = W.visuals = [];
  const K = { B, W, V };
  let tagN = 0;
  const vis = o => { V.push(o); return o; };
  const T = () => 'h' + (tagN++);

  K.spawn = (x, z, yaw, y) => {
    yaw = yaw === undefined ? -Math.PI / 2 : yaw;
    B.spawn(x, z, yaw, y);
    // the landing you arrive on, behind the spawn point
    const d = dirYP(yaw, 0);
    B.rect({ cx: x - d[0] * 1.7, cz: z - d[2] * 1.7, hw: 1.6, hl: 1.7, yaw, y: y || 0 });
    vis({ type: 'entry', x, z, y: y || 0, yaw });
  };

  // ---- walkable ground -------------------------------------------------
  K.floor = o => { // rectangle slab; yaw = direction of its length
    const r = B.rect({ cx: o.x, cz: o.z, hw: o.w / 2, hl: o.l / 2, yaw: o.yaw === undefined ? -Math.PI / 2 : o.yaw, y: o.y || 0, y2: o.y2, mover: o.mover });
    vis({ type: 'slab', shape: 'rect', x: o.x, z: o.z, w: o.w, l: o.l, yaw: r.yaw, y: o.y || 0, y2: o.y2, thick: o.thick || 1.2, mat: o.mat || 'bone', mover: o.mover, keel: o.keel !== false, etch: o.etch, rail: o.rail });
    if (o.railings) K.railings(o);
    return r;
  };
  K.ring = o => { // annular or disc slab
    const r = B.arc({ cx: o.x, cz: o.z, r0: o.r0 || 0, r1: o.r1, a0: o.a0 === undefined ? 0 : o.a0, a1: o.a1 === undefined ? TAU : o.a1, y: o.y || 0, mover: o.mover });
    vis({ type: 'slab', shape: 'arc', x: o.x, z: o.z, r0: o.r0 || 0, r1: o.r1, a0: r.a0, a1: r.a1, y: o.y || 0, thick: o.thick || 1.4, mat: o.mat || 'bone', mover: o.mover, keel: o.keel !== false, etch: o.etch, lip: o.lip });
    return r;
  };
  K.railings = o => { /* visual only kerbs; walkability already stops edges */ };

  // ---- solids ------------------------------------------------------------
  K.pillar = o => { // vertical column: blocks movement and sight
    const tag = o.tag || T();
    if (o.block !== false && o.r > 0.2) B.blockCircle({ x: o.x, z: o.z, r: o.r, mover: o.mover, y0: o.bottom === undefined ? -60 : o.bottom, y1: o.top === undefined ? 60 : o.top });
    if (o.occlude !== false) B.occCyl({ x: o.x, z: o.z, r: o.r * (o.occScale || 0.92), y0: o.bottom === undefined ? -60 : o.bottom, y1: o.top === undefined ? 60 : o.top, mover: o.mover, tag });
    vis({ type: 'pillar', x: o.x, z: o.z, r: o.r, top: o.top === undefined ? 40 : o.top, bottom: o.bottom === undefined ? -60 : o.bottom, mat: o.mat || 'bone', style: o.style || 'fluted', mover: o.mover, tag, seed: o.seed || tagN * 13 + 1, cap: o.cap });
    return tag;
  };
  K.wall = o => { // curved wall (arc), blocks movement and sight
    // Cutaway: the half of a curved wall between the chamber and the camera (+z side)
    // is built as a low parapet, in the simulation as well as on screen.
    if (o.cut !== false && !o._piece) {
      const cuts = [];
      for (let k = Math.ceil(o.a0 / Math.PI - 1e-6); k * Math.PI < o.a1 - 1e-6; k++) cuts.push(k * Math.PI);
      const bounds = [o.a0].concat(cuts.filter(c => c > o.a0 + 1e-6 && c < o.a1 - 1e-6), [o.a1]);
      let tag0 = null;
      for (let i = 0; i < bounds.length - 1; i++) {
        const mid = (bounds[i] + bounds[i + 1]) / 2, near = Math.sin(mid) > 0;
        const t = K.wall(Object.assign({}, o, { _piece: true, a0: bounds[i], a1: bounds[i + 1], y1: near ? (o.low === undefined ? 1.8 : o.low) : o.y1, near, tag: o.tag ? o.tag + (i ? '_' + i : '') : undefined }));
        if (!tag0) tag0 = t;
      }
      return tag0;
    }
    const tag = o.tag || T();
    const y0 = o.y0 === undefined ? -2 : o.y0, y1 = o.y1 === undefined ? 30 : o.y1;
    if (o.block !== false) B.blockArc({ cx: o.x, cz: o.z, r0: o.r0, r1: o.r1, a0: o.a0, a1: o.a1, y0, y1, mover: o.mover });
    if (o.occlude !== false) B.occArc({ cx: o.x, cz: o.z, r0: o.r0, r1: o.r1, a0: o.a0, a1: o.a1, y0, y1, mover: o.mover, tag });
    vis({ type: 'wall', x: o.x, z: o.z, r0: o.r0, r1: o.r1, a0: o.a0, a1: o.a1, y0: o.vy0 === undefined ? y0 - 30 : o.vy0, y1, mat: o.mat || 'olive', style: o.near ? 'parapet' : (o.style || 'ribbed'), mover: o.mover, tag, seed: o.seed || tagN * 7 + 3 });
    return tag;
  };
  K.block = o => { // straight wall / rib slab
    const tag = o.tag || T();
    const yaw = o.yaw === undefined ? 0 : o.yaw, y0 = o.y0 === undefined ? -2 : o.y0, y1 = o.y1 === undefined ? 6 : o.y1;
    if (o.block !== false) B.blockBox({ cx: o.x, cz: o.z, hw: o.t / 2, hl: o.w / 2, yaw, y0, y1, mover: o.mover });
    if (o.occlude !== false) B.occBox({ cx: o.x, cz: o.z, cy: (y0 + y1) / 2, hw: o.t / 2, hl: o.w / 2, hh: (y1 - y0) / 2, yaw, mover: o.mover, tag });
    vis({ type: 'block', x: o.x, z: o.z, w: o.w, t: o.t, yaw, y0: o.vy0 === undefined ? y0 : o.vy0, y1, mat: o.mat || 'olive', style: o.style || 'rib', mover: o.mover, tag });
    return tag;
  };
  // A canopy over a walkway: hides you from eyes above, does not stop you.
  K.canopy = o => {
    const tag = o.tag || T();
    const y0 = o.y0 === undefined ? 2.6 : o.y0, y1 = o.y1 === undefined ? 3.2 : o.y1, yaw = o.yaw === undefined ? -Math.PI / 2 : o.yaw;
    B.occBox({ cx: o.x, cz: o.z, cy: (y0 + y1) / 2, hw: o.w / 2, hl: o.l / 2, hh: (y1 - y0) / 2, yaw, tag, mover: o.mover });
    vis({ type: 'canopy', x: o.x, z: o.z, w: o.w, l: o.l, y0, y1, yaw, mover: o.mover });
    return tag;
  };
  // A blade on a rotor: blocks sight between eyes, high above the walkway.
  K.blade = o => {
    const tag = o.tag || T();
    B.occBox({ cx: o.x, cz: o.z, cy: (o.y0 + o.y1) / 2, hw: o.t / 2, hl: o.w / 2, hh: (o.y1 - o.y0) / 2, yaw: o.yaw || 0, tag, mover: o.mover });
    vis({ type: 'blade', x: o.x, z: o.z, w: o.w, t: o.t, y0: o.y0, y1: o.y1, yaw: o.yaw || 0, mover: o.mover });
    return tag;
  };
  // A screen of ribs: sight is blocked but the traveller can't pass either.
  K.screen = o => K.block(Object.assign({ style: 'screen', mat: 'ink' }, o));

  // ---- mechanisms ----------------------------------------------------------
  K.gate = o => { // iris gate; open while signal is true
    const yaw = o.yaw === undefined ? 0 : o.yaw;
    const m = B.mover({ id: o.id, kind: 'gate', x: o.x, z: o.z, y: o.y || 0, w: o.w, h: o.h || 4.5, thick: o.thick || 0.8, yaw, signal: o.signal, speed: o.speed || 0.9, e: o.open ? 1 : 0, prime: o.prime === undefined ? 0.4 : o.prime, sight: o.sight });
    vis({ type: 'gate', id: o.id, x: o.x, z: o.z, y: o.y || 0, w: o.w, h: o.h || 4.5, yaw, mat: o.mat || 'ochre', frame: o.frame !== false });
    return m;
  };
  K.bridge = o => { // vertebral bridge extending from (ax,az) along yaw while signal is true
    const m = B.mover({ id: o.id, kind: 'bridge', ax: o.ax, az: o.az, yaw: o.yaw, len: o.len, w: o.w || 2.2, y: o.y || 0, signal: o.signal, speed: o.speed || 0.5, e: o.open ? 1 : 0, prime: o.prime === undefined ? 0.5 : o.prime });
    vis({ type: 'bridge', id: o.id, ax: o.ax, az: o.az, yaw: o.yaw, len: o.len, w: o.w || 2.2, y: o.y || 0, mat: o.mat || 'bone' });
    return m;
  };
  K.rotor = o => {
    const m = B.mover({ id: o.id, kind: 'rotor', pivot: [o.x, o.z], mode: o.mode || 'toggle', omega: o.omega || 0.3, angles: o.angles || [0, Math.PI / 2], signal: o.signal, speed: o.speed || 0.35, e: o.start || 0, angle: o.mode === 'cont' ? (o.angle || 0) : (o.angles ? o.angles[0] + (o.angles[1] - o.angles[0]) * (o.start || 0) : 0), prime: o.prime === undefined ? 0.6 : o.prime, accel: o.accel });
    vis({ type: 'rotor', id: o.id, x: o.x, z: o.z, y: o.y || 0, r: o.r || 6, hub: o.hub });
    return m;
  };
  // A tendon: an organic line that makes a mechanism's dependency visible.
  K.tendon = o => vis({ type: 'tendon', from: o.from, to: o.to, sag: o.sag === undefined ? 3 : o.sag, w: o.w || 0.18, via: o.via });

  // ---- eyes ------------------------------------------------------------------
  K.eye = o => {
    const e = B.eye(Object.assign({}, o, { ignore: (o.ignore || []).concat(o.host ? [o.host] : []) }));
    vis({ type: 'eye', id: o.id, host: o.host, mount: o.mount || (o.rail ? 'rail' : 'socket'), socket: o.socket !== false, scale: o.scale || 1 });
    if (o.rail) vis({ type: 'rail', id: o.id, pts: o.rail.pts, loop: !!o.rail.loop });
    return e;
  };
  // eye set into a pillar: returns {pos, facing} on the pillar surface facing yaw
  K.onPillar = (px, pz, pr, y, yaw, pitch, depth) => {
    const d = dirYP(yaw, 0);
    const pos = [px + d[0] * (pr + (depth === undefined ? 0.15 : depth)), y, pz + d[2] * (pr + (depth === undefined ? 0.15 : depth))];
    return { pos, facing: dirYP(yaw, pitch || 0) };
  };
  K.toward = (from, to) => vNorm(vSub(to, from));

  // ---- regions ----------------------------------------------------------------
  K.exit = o => {
    B.zone('exit', { x: o.x, z: o.z, r: o.r || 1.3 });
    vis({ type: 'portal', role: 'exit', x: o.x, z: o.z, y: o.y || 0, yaw: o.yaw === undefined ? -Math.PI / 2 : o.yaw, size: o.size || 3.2 });
  };
  K.zone = (id, o) => { const z = B.zone(id, o); if (o.show) vis({ type: 'zone', id, x: o.x, z: o.z, y: o.y || 0, r: o.r, hw: o.hw, hl: o.hl, yaw: o.yaw, style: o.show }); return z; };

  // ---- decoration (no simulation) ------------------------------------------------
  K.ribs = o => vis(Object.assign({ type: 'ribs' }, o));         // arches over a chamber
  K.shaft = o => vis(Object.assign({ type: 'shaft' }, o));       // a deep circular void with descending rings
  K.mass = o => vis(Object.assign({ type: 'mass' }, o));         // distant architectural massing
  K.lamp = o => vis(Object.assign({ type: 'lamp' }, o));
  K.roots = o => vis(Object.assign({ type: 'roots' }, o));       // hanging tendons
  K.spiral = o => vis(Object.assign({ type: 'spiral' }, o));     // a spiral ramp structure in the distance
  K.stair = o => vis(Object.assign({ type: 'stair' }, o));       // impossible stairs (decor)
  K.colonnade = o => vis(Object.assign({ type: 'colonnade' }, o));
  return K;
}
