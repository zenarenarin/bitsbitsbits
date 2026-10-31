// =====================================================================
// The city's moving parts, as pure simulation: steam vents on a fixed,
// readable cycle; a catwalk section that creaks and gives way if you
// stall on it; rope bridges that sway; the energy fragments; the dead
// waypoint relays that wake as the core passes; the signal relay.
// The renderer reads the state; it never decides an outcome.
// =====================================================================

class Hazards {
  constructor(world, slice) {
    this.world = world; this.slice = slice; this.time = 0;
    this.vents = slice.vents.map(v => Object.assign({ state: 'idle', k: 0 }, v));
    this.unstable = slice.unstable.map(b => { b.dy = 0; return { b, state: 'stable', t: 0, vy: 0, shake: 0 }; });
    this.fragments = slice.fragments.map(f => Object.assign({ taken: false }, f));
    this.relay = Object.assign({ active: false, t: 0 }, slice.relay);
    this.bridges = (slice.bridges || []).map((b, i) => { b.dx = 0; return { b, phase: i * 1.3 }; });
    this.waypoints = (slice.waypoints || []).map(w => Object.assign({ active: false, t: 0 }, w));
    this.charge = 0;
  }
  // a fresh run: everything back where it was
  reset() {
    this.time = 0; this.charge = 0; this.relay.active = false; this.relay.t = 0;
    for (const f of this.fragments) f.taken = false;
    for (const w of this.waypoints) { w.active = false; w.t = 0; }
    this.resetUnstable();
  }
  // after a fall: fallen walkways are back, so the route is always crossable
  resetUnstable() { for (const u of this.unstable) { u.state = 'stable'; u.t = 0; u.vy = 0; u.shake = 0; u.b.dy = 0; u.b.gone = false; } }

  ventCycle() { const H = TUNING.hazards; return H.steamIdle + H.steamWarn + H.steamBurst; }
  // where in its cycle a vent is: idle -> warn (hiss, glow) -> burst
  ventAt(v, time) {
    const H = TUNING.hazards, T = this.ventCycle();
    const t = ((time + v.phase) % T + T) % T;
    if (t < H.steamIdle) return { state: 'idle', k: t / H.steamIdle };
    if (t < H.steamIdle + H.steamWarn) return { state: 'warn', k: (t - H.steamIdle) / H.steamWarn };
    return { state: 'burst', k: (t - H.steamIdle - H.steamWarn) / H.steamBurst };
  }

  step(dt, cat) {
    const H = TUNING.hazards, C = TUNING.cat, out = [];
    this.time += dt;
    // steam
    for (const v of this.vents) {
      const s = this.ventAt(v, this.time);
      if (s.state === 'warn' && v.state === 'idle') out.push({ type: 'hiss', vent: v });
      v.state = s.state; v.k = s.k;
      if (s.state !== 'burst') continue;
      const inX = Math.abs(cat.pos[0] - v.x) < H.steamRadius + C.halfWidth;
      const inZ = Math.abs(cat.pos[2] - v.z) < H.steamRadius * 0.8 + C.halfLength;
      const inY = cat.pos[1] < v.y + H.steamHeight && cat.pos[1] + cat.height > v.y - 0.1;
      if (inX && inZ && inY && cat.scalded <= 0) { cat.scald(v.x); out.push({ type: 'scald', vent: v }); }
    }
    // unstable walkways
    for (const u of this.unstable) {
      const on = cat.grounded && cat.ground === u.b;
      if (u.state === 'stable' && on) { u.state = 'creak'; u.t = 0; out.push({ type: 'creak' }); }
      else if (u.state === 'creak') {
        u.t += dt; u.shake = u.t / H.creakTime;
        if (u.t >= H.creakTime) { u.state = 'falling'; u.t = 0; u.vy = 0; out.push({ type: 'give' }); }
      } else if (u.state === 'falling') {
        u.t += dt; u.vy -= H.fallGravity * dt; u.b.dy += u.vy * dt;
        if (u.b.dy < -9) { u.state = 'gone'; u.b.gone = true; u.t = 0; }
      } else if (u.state === 'gone') {
        u.t += dt; if (u.t > H.resetTime) { u.state = 'stable'; u.b.dy = 0; u.b.gone = false; u.shake = 0; }
      }
    }
    // rope bridges: a slow, steady sway the player learns to lean against
    for (const br of this.bridges) br.b.dx = H.swayAmp * Math.sin(this.time * H.swayRate + br.phase);
    // waypoints: dead relays along the broken line wake as the core passes
    for (const w of this.waypoints) {
      if (w.active) { w.t += dt; continue; }
      if (cat.pos[2] < w.z + 1 && Math.abs(cat.pos[2] - w.z) < H.waypointRadius) { w.active = true; out.push({ type: 'waypoint', w, charge: this.charge }); }
    }
    // fragments
    for (const f of this.fragments) {
      if (f.taken) continue;
      const d = Math.hypot(cat.pos[0] - f.x, cat.pos[1] + 0.2 - f.y, cat.pos[2] - f.z);
      if (d < H.pickupRadius) { f.taken = true; this.charge++; out.push({ type: 'fragment', count: this.charge, of: this.fragments.length, f }); }
    }
    // the relay
    const r = this.relay;
    if (!r.active && Math.hypot(cat.pos[0] - r.x, cat.pos[2] - r.z) < H.relayRadius && Math.abs(cat.pos[1] - r.y) < 1) { r.active = true; out.push({ type: 'relay', charge: this.charge }); }
    if (r.active) r.t += dt;
    return out;
  }
}
