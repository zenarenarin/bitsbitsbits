// =====================================================================
// The run: an endless journey and seven lives. Pure simulation (no
// three.js), so it can be soak-tested headless.
//
// Streaming: sections are built ahead of the cat (at least `ahead` metres
// of route) and disposed once they are `behind` metres behind it, along
// with their shapes and hazards. The renderer follows through hooks.
//
// Lives, and the rules that hold for the whole run:
//  - a fall (off a surface, through a gap, onto scenery, with a walkway)
//    costs a life and respawns at the last safe footing;
//  - a lethal hazard (steam) costs a life; the cat is knocked back and
//    keeps going;
//  - after either, `invuln` seconds of invulnerability to hazards (steam),
//    and one incident never costs two lives: a fall is latched until its
//    respawn completes. A new fall is always a new incident: invulnerability
//    never makes falling free, or a careless player could fall forever;
//  - fragments collected stay collected; the core never drains;
//  - distance is the furthest point reached; it never goes backward;
//  - score = distance + fragments x 50 + relays x 250; never deducted;
//  - a relay is a milestone: it becomes the checkpoint, restores a life
//    (up to the maximum) and reveals the next destination;
//  - the run ends only when the last life is lost.
//
// Safe footing is recorded twice a second, and only where a respawn is
// fair: walkable, stable (not a swaying bridge or a walkway that gives
// way), not a balance pipe, not under anything, not at an edge, gentle
// slope, and clear of steam.
// =====================================================================

class Run {
  constructor(world, hazards, hooks) {
    this.world = world; this.hazards = hazards; this.hooks = hooks || {};
    this.sections = []; this.events = [];
    this.reset();
  }
  reset() {
    for (const s of this.sections) this.dropSection(s);
    this.sections = []; this.nextIndex = 0; this.nextZ = 0;
    const R = TUNING.run;
    this.lives = R.lives; this.invuln = 0; this.latched = false; this.over = false;
    this.distance = 0; this.relays = 0; this.fragments = 0; this.score = 0; this.time = 0;
    this.safe = []; this.safeT = 0; this.respawnAt = null;
    this.hazards.reset(); this.hazards.charge = 0;
    this.addSection();
    this.spawn = this.sections[0].spawn.slice();
  }

  // ---------------- streaming ----------------
  addSection() {
    const sec = buildSlice(this.world, { z0: this.nextZ, index: this.nextIndex++ });
    sec.hz = this.hazards.addSection(sec);
    this.sections.push(sec); this.nextZ = sec.exitZ;
    if (this.hooks.add) this.hooks.add(sec, sec.hz);
    return sec;
  }
  dropSection(sec) {
    this.world.remove(sec.boxes);
    this.hazards.removeSection(sec.index);
    if (this.hooks.remove) this.hooks.remove(sec.index);
  }
  stream(catZ) {
    const R = TUNING.run;
    while (this.nextZ > catZ - R.ahead) this.addSection();
    // never dispose the section holding the latest safe footing
    const keepZ = Math.max(catZ, this.safe.length ? this.safe[this.safe.length - 1][2] : catZ);
    while (this.sections.length > 1 && this.sections[0].exitZ > keepZ + R.behind) this.dropSection(this.sections.shift());
  }
  sectionAt(z) { return this.sections.find(s => z <= s.z0 + 3 && z > s.exitZ) || null; }
  // the next relay ahead that has not woken yet, and where its destination tower stands
  nextRelay() { return this.hazards.relays.find(r => !r.active) || null; }

  // ---------------- per step ----------------
  step(dt, cat, events) {
    const R = TUNING.run;
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    cat.invuln = this.invuln;
    if (!this.respawnAt) this.latched = false;
    this.distance = Math.max(this.distance, -cat.pos[2]);
    this.recordSafe(dt, cat);
    for (const e of events) {
      if (e.type === 'fragment') this.fragments++;
      else if (e.type === 'relay') {
        this.relays++;
        const before = this.lives; this.lives = Math.min(R.lives, this.lives + R.relayLife);
        this.safe.push([e.relay.x, e.relay.y, e.relay.z + 2.5]);
        this.events.push({ type: 'milestone', relay: e.relay, lifeGained: this.lives > before });
      } else if (e.type === 'scald') this.loseLife('steam', false);
      else if (e.type === 'fall' && !this.respawnAt) {
        this.loseLife(e.reason || 'fall', true);
        if (!this.over) this.respawnAt = this.pickRespawn(cat);
      }
    }
    this.score = Math.floor(this.distance) + this.fragments * R.scoreFragment + this.relays * R.scoreRelay;
    this.stream(cat.pos[2]);
  }
  loseLife(reason, fell) {
    // one incident, one life: a fall in progress is latched; hazards respect invulnerability
    if (this.over || this.latched || (!fell && this.invuln > 0)) return false;
    this.lives--; this.latched = true; this.invuln = TUNING.run.invuln;
    this.events.push({ type: 'lifeLost', reason, lives: this.lives });
    if (this.lives <= 0) { this.over = true; this.events.push({ type: 'gameOver', distance: this.distance, score: this.score }); }
    return true;
  }
  // the game calls this once the cat has been placed back
  respawned() { this.respawnAt = null; this.invuln = Math.max(this.invuln, TUNING.run.invuln); }

  recordSafe(dt, cat) {
    this.safeT += dt;
    if (this.safeT < 0.5 || !cat.grounded || !cat.ground) return;
    const b = cat.ground, W = this.world, C = TUNING.cat;
    if (!b.walk || b.far || b.unstable || b.dx !== undefined || cat.surf === 'balance' || cat.crouch || cat.scr) return;
    if (cat.edgeAhead > 0 || Math.abs(cat.slope[0]) > 0.35 || Math.abs(cat.slope[1]) > 0.35) return;
    for (const sx of [-0.25, 0.25]) if (W.groundAt(cat.pos[0] + sx, cat.pos[2], cat.pos[1] + 0.3, 0.02, 0.02).y < cat.pos[1] - 0.3) return;
    if (W.ceilingAt(cat.pos[0], cat.pos[2], cat.pos[1] + 0.02, C.halfWidth, C.halfLength).y - cat.pos[1] < C.standHeight + 0.2) return;
    for (const v of this.hazards.vents) if (Math.abs(v.z - cat.pos[2]) < 2.2 && Math.abs(v.x - cat.pos[0]) < 1.5) return;
    this.safeT = 0;
    this.safe.push(cat.pos.slice()); if (this.safe.length > 8) this.safe.shift();
  }
  pickRespawn(cat) {
    // the most recent safe footing behind the cat whose ground is still there
    for (let i = this.safe.length - 1; i >= 0; i--) {
      const p = this.safe[i];
      if (p[2] < cat.pos[2] - 0.5) continue;    // never ahead of where the cat failed
      const g = this.world.groundAt(p[0], p[2], p[1] + 0.3, 0.05, 0.05);
      if (g.box && !g.box.gone && Math.abs(g.y - p[1]) < 0.3) return [p[0], g.y, p[2]];
    }
    return this.spawn.slice();
  }
}
