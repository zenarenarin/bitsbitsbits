// ---- Alertness: the beast hears every step ---------------------------------
// One continuous level, 0 (deep sleep) .. 1 (awake). Noise comes from the
// explorer's footsteps, launches and landings, scaled by what the feet are on
// (moss is soft, mushroom caps spring, the ears and face are sensitive) and
// by height - the closer to the head, the lighter the sleep.
// Stillness lets it settle, slowly, down to a floor that rises with every
// disturbance the beast remembers, so waiting can never erase all tension.
//
//   DEEP SLEEP  < 0.3   slow breathing, quiet, still fur
//   DISTURBED   < 0.62  quicker breath, fur ripples, small reactions
//   STIRRING    < 1     heaving body, falling dust, wind - the warning
//   AWAKE       = 1     irreversible: the awakening begins

const NOISE = {
  stepCareful: 0.0016,
  stepRun: 0.0085,
  launch: 0.004,
  landSoft: 0.012, // an ordinary jump landing on fur
  landPerSpeed: 0.006, // extra per m/s of impact above 5 m/s
  hardFall: 0.16, // impact above 12 m/s
  surface: { fur: 1, moss: 0.55, cap: 0.7, skin: 2.2, ear: 2.6 },
  recoverPerSec: 0.03,
  stillAfter: 0.7, // seconds of stillness before the beast starts to settle
  memory: 0.14, // share of each noise that raises the floor
  floorMax: 0.42,
  disturbed: 0.3,
  stirring: 0.62
};

const ALERT_STATES = ["sleep", "disturbed", "stirring", "awake"];

class Alertness {
  constructor(world) {
    this.world = world;
    this.mossSeed = world.seed + 100;
    this.rng = rngFrom(world.seed + 5);
    this.reset();
  }

  reset() {
    this.level = 0;
    this.floor = 0;
    this.still = 0;
    this.state = "sleep";
    this.breath = 0; // breathing phase (radians)
    this.heave = 0; // current body rise (m)
    this.hitch = 0; // a caught breath while stirring
    this.pulses = []; // recent noises, for fur ripples and footstep rings
    this.time = 0;
  }

  // Sleep grows lighter toward the head, and the face itself is sensitive.
  get sensitivity() {
    return 1 + clamp(this.explorerY / 320, 0, 1) * 0.8 + (this.nearHead ? 0.8 : 0);
  }

  noise(amount, ex, surface) {
    if (this.state === "awake" || amount <= 0) return;
    const n = amount * (NOISE.surface[surface] || 1) * this.sensitivity * (this.scale || 1);
    this.level = Math.min(1, this.level + n);
    this.floor = Math.min(NOISE.floorMax, this.floor + n * NOISE.memory);
    this.still = 0;
    this.pulses.push({ x: ex.x, y: ex.y, amount: n, surface, t: this.time });
    if (this.pulses.length > 24) this.pulses.shift();
  }

  update(dt, ex, input) {
    this.time += dt;
    this.explorerY = ex.y;
    const h = this.world.focus.head;
    this.nearHead = Math.hypot(ex.x - h.x, ex.y - h.y) < 18;
    const surface = ex.grounded ? ex.surface(this.mossSeed) : "fur";

    for (const e of ex.events) {
      if (e.type === "step") this.noise(e.run ? NOISE.stepRun : NOISE.stepCareful, ex, surface);
      else if (e.type === "launch") this.noise(NOISE.launch, ex, surface);
      else if (e.type === "fell") this.noise(NOISE.hardFall * 1.5, ex, "fur");
      else if (e.type === "land") {
        const extra = Math.max(0, e.impact - 5) * NOISE.landPerSpeed;
        this.noise(NOISE.landSoft + extra + (e.impact > 12 ? NOISE.hardFall : 0), ex, surface);
      }
    }

    // Stillness: no input, standing on something. Settling is slow, slower
    // still once the beast is stirring, and never below the remembered floor.
    const idle = ex.grounded && input.dir === 0 && Math.hypot(ex.vx, ex.vy) < 0.1;
    this.still = idle ? this.still + dt : 0;
    if (this.state !== "awake" && this.still > NOISE.stillAfter) {
      const rate = NOISE.recoverPerSec * (this.recovery || 1) * (this.level > NOISE.stirring ? 0.55 : 1);
      this.level = Math.max(this.floor, this.level - rate * dt);
    }

    const prev = this.state;
    if (this.level >= 1) this.state = "awake";
    else if (this.state !== "awake") {
      this.state = this.level >= NOISE.stirring ? "stirring" : this.level >= NOISE.disturbed ? "disturbed" : "sleep";
    }
    if (prev !== this.state) this.changed = { from: prev, to: this.state, t: this.time };

    // Breathing: slow and deep asleep, quicker and shallower when disturbed,
    // heaving with caught breaths when stirring.
    const a = this.level;
    const period = lerp(6.5, 2.8, smoothstep(0.1, 0.9, a));
    if (this.state === "stirring" && this.hitch <= 0 && this.rng() < dt * 0.25) this.hitch = 0.9;
    this.hitch -= dt;
    if (this.hitch <= 0) this.breath += (dt / period) * Math.PI * 2;
    const amp = lerp(0.05, 0.2, smoothstep(0.2, 0.95, a));
    this.heave = Math.sin(this.breath) * amp;
  }

  // 0..1 intensity of a band, for effects.
  get stir() {
    return smoothstep(NOISE.disturbed, 1, this.level);
  }
}
