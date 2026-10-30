// =====================================================================
// The specimen jar: movement, the catch zone, collision against its rim
// and walls, and the pickled contents that pile up inside.
// =====================================================================

// Content slots, relative to the jar's centre line and its inner floor.
// Four short rows that stop well below the mouth so it always reads open.
const JAR_SLOTS = [[-12, 6], [0, 5], [12, 6], [-6, 14], [7, 14], [-13, 22], [0, 23], [13, 22], [-7, 31], [6, 31]];

function createJar(THREE, scene, M, art, fx, audio) {
  const group = new THREE.Group(); scene.add(group);
  const shadow = M.sprite(art.shadow, 3);
  const back = M.sprite(art.jarBack, 5);
  const liquid = new THREE.Mesh(M.plane, new THREE.MeshBasicMaterial({ color: PAL.liquid, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false }));
  liquid.renderOrder = 12;
  const surface = new THREE.Mesh(M.plane, new THREE.MeshBasicMaterial({ color: PAL.liquidHi, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  surface.renderOrder = 13;
  const front = M.sprite(art.jarFront, 190, {});
  const hurtFront = M.sprite(art.jarFront, 191, { color: '#ff6a6a' }); hurtFront.visible = false;
  liquid.material.color.convertSRGBToLinear(); surface.material.color.convertSRGBToLinear();
  group.add(back, liquid, surface, front, hurtFront);
  scene.add(shadow);
  const arrows = [M.sprite(art.arrowL, 240), M.sprite(art.arrowR, 240)];
  arrows.forEach(a => { a.visible = false; scene.add(a); });

  // pickled contents
  const contents = [];
  for (let i = 0; i < JAR_SLOTS.length; i++) {
    const g = new THREE.Group(); g.visible = false;
    const s = art.small.teal;
    const sc = M.sprite(s.sclera, 6 + i * 0.3), ir = M.sprite(s.iris, 6.1 + i * 0.3), gl = M.sprite(s.gloss, 6.2 + i * 0.3);
    g.add(sc, ir, gl); group.add(g);
    contents.push({ g, sc, ir, gl, on: false, kind: 'teal', t: 0, from: 0, phase: Math.random() * TAU, lx: 0, ly: 0, tx: 0, ty: 0, retarget: 0, order: 0 });
  }
  let order = 0;

  const J = {
    x: 0, vx: 0, target: 0, sx: 1, sy: 1, vsx: 0, vsy: 0, hurt: 0, slow: 0,
    mouthY: 0, baseY: 0, innerHalf: 18.5, rimR: 2.6, rimX: 21.5, bodyHalf: 22.5,
    caught: 0, world: null, hint: 0, moved: 0,
    setWorld(w) {
      J.world = w;
      J.baseY = w.FLOOR;                                        // canvas row 58 sits on the floor line
      J.mouthY = J.baseY + (JAR.bottom - JAR.mouthY);
      J.x = clamp(J.x, -w.PW + J.bodyHalf + 1, w.PW - J.bodyHalf - 1);
      J.target = clamp(J.target, -w.PW + J.bodyHalf + 1, w.PW - J.bodyHalf - 1);
    },
    liquidLevel() { return 9 + Math.min(4, Math.ceil(J.count() / 2.5)) * 6; },
    liquidTop() { return J.baseY + 2 + J.liquidLevel(); },
    count() { let n = 0; for (const c of contents) if (c.on) n++; return n; },
    clear() { for (const c of contents) { c.on = false; c.g.visible = false; } J.caught = 0; },

    update(dt, now) {
      const w = J.world;
      const lim = w.PW - J.bodyHalf - 1;
      J.target = clamp(J.target, -lim, lim);
      const prev = J.x;
      const maxSp = (J.slow > 0 ? 260 : 1100) * w.U;
      const want = damp(J.x, J.target, J.slow > 0 ? 7 : 24, dt);
      J.x = clamp(J.x + clamp(want - J.x, -maxSp * dt, maxSp * dt), -lim, lim);
      J.vx = (J.x - prev) / Math.max(dt, 1e-4);
      J.moved += Math.abs(J.x - prev);
      J.slow = Math.max(0, J.slow - dt); J.hurt = Math.max(0, J.hurt - dt);
      J.vsx += ((1 - J.sx) * 340 - J.vsx * 16) * dt; J.sx += J.vsx * dt;
      J.vsy += ((1 - J.sy) * 340 - J.vsy * 16) * dt; J.sy += J.vsy * dt;
      const lean = clamp(J.vx / (900 * w.U), -0.05, 0.05);
      // group origin = jar bottom centre so squash keeps it planted on the floor
      group.position.set(Math.round(J.x), J.baseY - 1, 0);
      group.scale.set(J.sx, J.sy, 1);
      const cy = JAR.H / 2;                                       // sprite centre above the group origin
      back.position.set(0, cy, 0); front.position.set(0, cy, 0); hurtFront.position.set(0, cy, 0);
      hurtFront.visible = J.hurt > 0 && (J.hurt * 20 | 0) % 2 === 0;
      const lv = J.liquidLevel();
      liquid.scale.set(38, lv, 1); liquid.position.set(Math.round(lean * 20), 3 + lv / 2, 0);
      surface.scale.set(38, 1, 1); surface.position.set(Math.round(lean * 20), 3 + lv - 0.5, 0);
      shadow.position.set(Math.round(J.x), J.baseY + 1, 0);
      // contents sink into place, then bob and stare about
      for (const c of contents) {
        if (!c.on) continue;
        const [sx, sy] = JAR_SLOTS[c.slot];
        c.t = Math.min(1, c.t + dt / 0.45);
        const k = easeOut(c.t);
        const bob = Math.round(Math.sin(now * 1.3 + c.phase) * 0.6);
        c.g.position.set(Math.round(lerp(c.fromX, sx, k)), Math.round(lerp(c.fromY, 3 + sy + 7, k)) + (c.t >= 1 ? bob : 0), 0);
        c.retarget -= dt;
        if (c.retarget <= 0) { c.retarget = 0.8 + Math.random() * 2.5; const a = Math.random() * TAU; c.tx = Math.round(Math.cos(a) * 1.4); c.ty = Math.round(Math.sin(a) * 1.4); }
        c.lx = damp(c.lx, c.tx, 10, dt); c.ly = damp(c.ly, c.ty, 10, dt);
        c.ir.position.set(Math.round(c.lx), Math.round(c.ly), 0);
      }
      // the arrows that teach the drag, until the jar has been moved
      const showHint = J.hint > 0 && J.moved < 24;
      if (J.hint > 0) J.hint -= dt;
      const blink = showHint && Math.floor(now * 3) % 2 === 0;
      arrows[0].visible = blink; arrows[1].visible = blink;
      arrows[0].position.set(Math.round(J.x) - 33, J.baseY + 24, 0);
      arrows[1].position.set(Math.round(J.x) + 33, J.baseY + 24, 0);
    },

    // eye vs jar. Returns 'catch', 'rim', 'wall' or null.
    collide(e) {
      const U = J.world.U;
      const dx = e.x - J.x;
      // the mouth: an eye whose centre drops through the opening is caught
      if (e.vy < 0 && e.prevY >= J.mouthY - 1 && e.y < J.mouthY + 1 && Math.abs(dx) <= J.innerHalf - e.r * 0.2) return 'catch';
      let res = null;
      // rim lips: small round bumpers either side of the opening
      for (const side of [-1, 1]) {
        const rx = J.x + side * J.rimX, ry = J.mouthY;
        const ex = e.x - rx, ey = e.y - ry, d = Math.hypot(ex, ey), min = e.r + J.rimR;
        if (d < min && d > 1e-4) {
          const nx = ex / d, ny = ey / d;
          e.x = rx + nx * min; e.y = ry + ny * min;
          const rvx = e.vx - J.vx, vn = rvx * nx + e.vy * ny;
          if (vn < 0) { e.vx -= 1.75 * vn * nx; e.vy -= 1.75 * vn * ny; e.sx = 1.15; e.sy = 0.88; audio.clink(-vn / (300 * U)); J.sy = Math.min(J.sy, 0.97); }
          res = 'rim';
        }
      }
      // the glass walls below the rim
      if (e.y < J.mouthY + 0.5) {
        const left = J.x - J.bodyHalf, right = J.x + J.bodyHalf;
        const cx = clamp(e.x, left, right), cy = clamp(e.y, J.baseY, J.mouthY);
        let ex = e.x - cx, ey = e.y - cy, d = Math.hypot(ex, ey);
        if (d < e.r) {
          if (d < 1e-4) { ex = dx >= 0 ? 1 : -1; ey = 0; d = 1; }
          const nx = ex / d, ny = ey / d, push = e.r - (d < 1e-4 ? 0 : d);
          e.x += nx * push; e.y += ny * push;
          const vn = (e.vx - J.vx) * nx + e.vy * ny;
          if (vn < 0) { e.vx -= 1.7 * vn * nx; e.vy -= 1.7 * vn * ny; audio.clink(-vn / (400 * U)); }
          if (Math.abs(nx) > 0.5) e.vx += J.vx * 0.35;
          // squeezed against a side wall: pop it up and over instead of trapping it
          const PW = J.world.PW;
          if (e.x - e.r < -PW + 0.5 || e.x + e.r > PW - 0.5) { e.y = Math.max(e.y, J.mouthY + e.r + 2); e.vy = Math.max(e.vy, 180 * U); e.vx = -Math.sign(e.x) * 60 * U; }
          res = res || 'wall';
        }
      }
      return res;
    },

    receive(e) {
      J.caught++;
      let c = contents.find(q => !q.on);
      if (!c) {                                                  // full: the oldest dissolves to make room
        c = contents.reduce((a, b) => (a.order < b.order ? a : b));
        fx.burst(J.x + JAR_SLOTS[c.slot][0], J.baseY + 10 + JAR_SLOTS[c.slot][1], 6, { speed: 12, angle: Math.PI / 2, spread: 1, life: 0.6, g: 40, size: 1, color: PAL.liquidHi });
      }
      const slotsUsed = new Set(contents.filter(q => q.on && q !== c).map(q => q.slot));
      let slot = c.on ? c.slot : JAR_SLOTS.findIndex((_, i) => !slotsUsed.has(i));
      if (slot < 0) slot = 0;
      const kind = e.kind;
      const s = art.small[kind];
      M.setSprite(c.sc, s.sclera); M.setSprite(c.ir, s.iris); M.setSprite(c.gl, s.gloss);
      c.on = true; c.slot = slot; c.kind = kind; c.t = 0; c.order = ++order;
      c.fromX = clamp(e.x - J.x, -10, 10); c.fromY = J.liquidLevel() + 6;
      c.g.visible = true;
      const top = J.liquidTop();
      fx.burst(e.x, top, 9, { speed: 55, angle: Math.PI / 2, spread: 1.6, life: 0.4, g: -260, sizes: [1, 1, 2], colors: [PAL.liquidHi, PAL.glassHi, PAL.liquid] });
      audio.plop();
    },

    bump(power) { J.sy = 1 - 0.12 * power; J.sx = 1 + 0.08 * power; J.vsy = 0; J.vsx = 0; },
    injure() { J.hurt = 0.45; J.slow = 0.6; J.sy = 0.8; J.sx = 1.12; },
    showHint(sec) { J.hint = sec; J.moved = 0; }
  };
  return J;
}
