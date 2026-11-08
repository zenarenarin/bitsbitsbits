// =====================================================================
// The city's moving parts, as pure simulation: steam vents on a fixed,
// readable cycle; walkway sections that creak and give way if you stall
// on them; rope bridges that sway; energy fragments; the dead waypoint
// relays that wake as the core passes; and signal relays, which are the
// milestones of the endless journey.
//
// Sections register their hazards as they stream in (addSection) and drop
// them as they are disposed (removeSection). The renderer reads the state;
// it never decides an outcome.
// =====================================================================

class Hazards {
  constructor(world, slice) {
    this.world = world; this.time = 0; this.charge = 0;
    this.sections = [];
    this.vents = []; this.unstable = []; this.bridges = []; this.fragments = []; this.waypoints = []; this.relays = [];
    if (slice) this.addSection(slice);
  }
  // the first relay ahead (kept for single-section callers and tests)
  get relay() { return this.relays.find(r => !r.active) || this.relays[this.relays.length - 1]; }

  addSection(sec) {
    const hz = {
      id: sec.index,
      vents: sec.vents.map(v => Object.assign({ state: 'idle', k: 0 }, v)),
      unstable: sec.unstable.map(b => { b.dy = 0; return { b, state: 'stable', t: 0, vy: 0, shake: 0 }; }),
      bridges: (sec.bridges || []).map((b, i) => { b.dx = 0; return { b, phase: i * 1.3 + sec.index * 0.7 }; }),
      fragments: sec.fragments.map(f => Object.assign({ taken: false }, f)),
      waypoints: (sec.waypoints || []).map(w => Object.assign({ active: false, t: 0 }, w)),
      relays: sec.relay ? [Object.assign({ active: false, t: 0, section: sec.index }, sec.relay)] : []
    };
    this.sections.push(hz); this.rebuild();
    return hz;
  }
  removeSection(id) { this.sections = this.sections.filter(s => s.id !== id); this.rebuild(); }
  rebuild() {
    for (const k of ['vents', 'unstable', 'bridges', 'fragments', 'waypoints', 'relays']) this[k] = [].concat(...this.sections.map(s => s[k]));
  }
  // a fresh run: everything back where it was
  reset() {
    this.time = 0; this.charge = 0;
    for (const r of this.relays) { r.active = false; r.t = 0; }
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
    for (const v of this.vents) {
      const s = this.ventAt(v, this.time);
      if (s.state === 'warn' && v.state === 'idle') out.push({ type: 'hiss', vent: v });
      v.state = s.state; v.k = s.k;
      if (s.state !== 'burst' || cat.invuln > 0) continue;
      const inX = Math.abs(cat.pos[0] - v.x) < H.steamRadius + C.halfWidth;
      const inZ = Math.abs(cat.pos[2] - v.z) < H.steamRadius * 0.8 + C.halfLength;
      const inY = cat.pos[1] < v.y + H.steamHeight && cat.pos[1] + cat.height > v.y - 0.1;
      if (inX && inZ && inY && cat.scalded <= 0) { cat.scald(v.x); out.push({ type: 'scald', vent: v }); }
    }
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
    for (const br of this.bridges) br.b.dx = H.swayAmp * Math.sin(this.time * H.swayRate + br.phase);
    for (const w of this.waypoints) {
      if (w.active) { w.t += dt; continue; }
      if (cat.pos[2] < w.z + 1 && Math.abs(cat.pos[2] - w.z) < H.waypointRadius) { w.active = true; out.push({ type: 'waypoint', w, charge: this.charge }); }
    }
    for (const f of this.fragments) {
      if (f.taken) continue;
      const d = Math.hypot(cat.pos[0] - f.x, cat.pos[1] + 0.2 - f.y, cat.pos[2] - f.z);
      if (d < H.pickupRadius) { f.taken = true; this.charge++; out.push({ type: 'fragment', count: this.charge, of: this.fragments.length, f }); }
    }
    for (const r of this.relays) {
      if (r.active) { r.t += dt; continue; }
      // crossing the relay's line anywhere on its terrace wakes it: a milestone is never missed
      if (cat.pos[2] < r.z + 0.5 && cat.pos[2] > r.z - 4 && Math.abs(cat.pos[0] - r.x) < H.relayReach && Math.abs(cat.pos[1] - r.y) < 1) { r.active = true; out.push({ type: 'relay', relay: r, charge: this.charge }); }
    }
    return out;
  }
}
