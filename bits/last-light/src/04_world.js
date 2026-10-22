// =====================================================================
// The city's moving parts: awnings, the Watcher's shutters, doorways,
// laundry and the pulley rope. `world` is also the collision view the
// runner queries: static geometry plus whatever is out right now.
// =====================================================================
function createWorld(level) {
  const W = { level };
  const solids = level.solids.slice(), plats = level.plats.slice();
  const shutterBoxes = level.shutters.map(s => ({ x0: s.x0, x1: s.x1, y0: s.y, y1: s.top, kind: 'shutter', grab: false, occ: true, shutter: s }));
  for (const a of level.awnings) {
    a.t = 0; a.hold = 0; a.cool = 0; a.target = 0; a.shake = 0;
    a.plat = { x0: Math.min(a.ax, a.ax + a.dir * a.len), x1: Math.max(a.ax, a.ax + a.dir * a.len), y: a.ay - 0.14, th: 0.12, kind: 'awning', grab: true, occ: false, awning: a };
  }
  let activePlats = plats.slice(), activeSolids = solids.concat(shutterBoxes);
  W.solids = () => activeSolids;
  W.plats = () => activePlats;
  W.pipes = () => level.pipes;
  W.ropes = () => level.ropes;
  W.shutterBoxes = shutterBoxes;

  W.reset = function () {
    for (const a of level.awnings) { a.t = 0; a.hold = 0; a.cool = 0; a.target = 0; a.shake = 0; }
    for (const s of level.shutters) { s.y = s.open; s.wait = 0; s.closing = false; s.vel = 0; }
    for (const r of level.recesses) { r.open = 0; }
    for (const r of level.ropes) { r.sway = 0; r.swayW = 0; }
    rebuild();
  };

  // an awning unrolls from its roller along a shallow pitch: rolled at t = 0,
  // fully out over the street at t = 1
  W.awningAngle = a => deg(-2.5);
  W.awningExt = a => 0.05 + 0.95 * smooth(a.t);
  W.awningTip = a => { const ang = W.awningAngle(a), e = W.awningExt(a) * a.len; return { x: a.ax + a.dir * Math.cos(ang) * e, y: a.ay + Math.sin(ang) * e }; };

  W.pullAwning = function (a) {
    if (a.cool > 0) return false;
    a.target = 1; a.hold = a.holdS * (W.holdScale || 1); a.cool = 0.6;
    return true;
  };

  function rebuild() {
    activePlats = plats.slice();
    for (const a of level.awnings) if (a.t > 0.94) activePlats.push(a.plat);
    for (const b of shutterBoxes) b.y0 = b.shutter.y;
    activeSolids = solids.concat(shutterBoxes.filter(b => b.y1 - b.y0 > 0.02));
  }

  // occluding edges that move
  W.dynamicOccluders = function (out, time) {
    out.length = 0;
    for (const a of level.awnings) {
      if (a.t < 0.02) continue;
      const tip = W.awningTip(a);
      out.push({ ax: a.ax, ay: a.ay, bx: tip.x, by: tip.y, src: a });
    }
    for (const s of level.shutters) {
      if (s.top - s.y < 0.02) continue;
      out.push({ ax: s.x0, ay: s.y, bx: s.x1, by: s.y, src: s }, { ax: s.x0, ay: s.y, bx: s.x0, by: s.top, src: s }, { ax: s.x1, ay: s.y, bx: s.x1, by: s.top, src: s });
    }
    for (const sh of level.sheets) {
      const sw = W.sheetSway(sh, time);
      out.push({ ax: sh.x - sh.w / 2, ay: sh.y, bx: sh.x - sh.w / 2 + sw, by: sh.y - sh.h, src: sh }, { ax: sh.x + sh.w / 2, ay: sh.y, bx: sh.x + sh.w / 2 + sw, by: sh.y - sh.h, src: sh }, { ax: sh.x - sh.w / 2 + sw, ay: sh.y - sh.h, bx: sh.x + sh.w / 2 + sw, by: sh.y - sh.h, src: sh });
    }
    return out;
  };
  W.sheetSway = (sh, time) => Math.sin(time * 1.1 + sh.phase) * 0.32 + Math.sin(time * 2.3 + sh.phase * 2) * 0.08;

  // advance mechanisms; `watch` tells the shutters what the Watcher wants
  W.update = function (dt, player, watch, events) {
    for (const a of level.awnings) {
      a.cool -= dt;
      if (a.target === 1 && a.t >= 1) {
        a.hold -= dt;
        a.shake = a.hold < 1.6 ? 1 : 0;
        if (a.hold <= 0) { a.target = 0; events.push({ type: 'awningBack', a }); }
      }
      const was = a.t;
      a.t = approach(a.t, a.target, dt / (a.target ? 0.45 : 0.9));
      if (was < 1 && a.t >= 1) events.push({ type: 'awningOut', a });
    }
    for (const s of level.shutters) {
      const want = watch.closeShutter(s);
      if (want) { s.wait += dt; if (s.wait > s.delay && s.y > 0) { if (!s.closing) events.push({ type: 'shutterDown', s }); s.closing = true; s.y = Math.max(0, s.y - s.speed * dt); if (s.y <= 0 && s.closing) events.push({ type: 'shutterShut', s }); } }
      else {
        s.wait = Math.min(s.wait, s.delay);
        s.wait -= dt;
        if (s.wait < -s.lift && s.y < s.open) { if (s.closing) events.push({ type: 'shutterUp', s }); s.closing = false; s.y = Math.min(s.open, s.y + 0.9 * dt); }
      }
      // the shutter never closes on someone: it nudges them out from under it
      const b = player.box();
      if (b.x1 > s.x0 && b.x0 < s.x1 && b.y0 < s.top && b.y1 > s.y && player.state !== 'caught') {
        const left = player.x < (s.x0 + s.x1) / 2;
        player.x = left ? s.x0 - player.w / 2 - 0.01 : s.x1 + player.w / 2 + 0.01;
        if (player.state === 'ground' || player.state === 'air') player.vx = 0;
      }
    }
    for (const r of level.ropes) if (player.rope !== r) { r.swayW = (r.swayW || 0) - 7 / r.len * Math.sin(r.sway || 0) * dt; r.swayW *= 1 - 0.6 * dt; r.sway = (r.sway || 0) + r.swayW * dt; }
    for (const r of level.recesses) r.open = approach(r.open, watch.doorOpen(r) ? 1 : 0, dt / 1.4);
    rebuild();
  };

  // what the act button would do here
  W.interactable = function (player) {
    if (player.state !== 'ground') return null;
    for (const a of level.awnings) {
      if (Math.abs(player.x - a.cord.x) < 0.95 && Math.abs(player.y - a.cord.y) < 0.5) return { kind: 'cord', a, ready: a.cool <= 0 && a.target === 0 };
    }
    return null;
  };

  W.inRecess = function (player) {
    if (player.state !== 'ground' && player.state !== 'pull') return null;
    for (const r of level.recesses) if (player.x > r.x0 + 0.2 && player.x < r.x1 - 0.2 && Math.abs(player.y - r.y0) < 0.1) return r;
    return null;
  };
  W.reset();
  return W;
}
