// =====================================================================
// Rules of the spiral. Every number a player learns lives here.
// =====================================================================

const SIM_DT = 1 / 60;

const RULES = {
  // the traveller
  walk: 2.6,            // units per second along a groove
  walkAccel: 16,        // how quickly the walk reaches the stick (exponential, per second)
  playerRad: 0.3,
  crossTime: 0.2,       // the step through an opening
  doorHalf: 0.68,       // half the opening, in units of arc
  doorAssist: 1.7,      // within this arc, pushing toward an opening slides you to it
  // gaze
  gazeCone: 0.17,       // half-angle of the gaze, before the eye's own size is added
  gazeStick: 0.03,      // the held eye keeps priority unless another is this much nearer the gaze
  acquire: 0.2,         // seconds of gaze before an eye is pinned
  release: 0.35,        // a pinned eye stays held this long after the gaze leaves
  // the spiral
  rotMax: 1.25,         // radians per second at full dial
  rotSmooth: 14,
  wallThick: 0.5,
  pupilFrac: 0.62,      // the centre's dark pupil, as a fraction of the innermost wall radius
  // threat
  contactSlack: 0.85,   // lethal contact uses this fraction of the eye's radius
  exposureRate: 1.15,   // a sentinel's gaze fills exposure at this rate (1 = caught)
  exposureDecay: 1.4,
  graceStart: 1.0,
  markTime: 6,          // after being struck, the next touch within this time is fatal
  knockback: 1.4,       // units the traveller is thrown clear by a strike      // nothing moves for this long when an encounter opens
};

// type: rad (units), spd (units/s), lethal on contact, solid to walking,
// pinnable by gaze, inWall (sits in a wall, not a groove), anchored (cannot be pushed)
const EYE_TYPES = {
  watcher:    { rad: 0.55, spd: 0.92, lethal: true,  solid: true,  pinnable: true },
  drifter:    { rad: 0.74, spd: 0.85, lethal: false, solid: true,  pinnable: true },
  collector:  { rad: 0.64, spd: 0.8,  lethal: true,  solid: true,  pinnable: true },
  liar:       { rad: 0.52, spd: 0.85, lethal: true,  solid: true,  pinnable: true, feigns: true },
  mimic:      { rad: 0.55, spd: 0,    lethal: true,  solid: true,  pinnable: true },
  sentinel:   { rad: 0.5,  spd: 0,    lethal: false, solid: false, pinnable: true, inWall: true, anchored: true },
  warden:     { rad: 0.46, spd: 0,    lethal: false, solid: false, pinnable: true, inWall: true, anchored: true },
  choir:      { rad: 0.46, spd: 0.95, lethal: true,  solid: true,  pinnable: true },
  crown:      { rad: 0.5,  spd: 0.7,  lethal: true,  solid: true,  pinnable: true },
  falseeye:   { rad: 0.55, spd: 0,    lethal: false, solid: false, pinnable: false, decoy: true },
  unblinking: { rad: 0.86, spd: 0.78, lethal: true,  solid: true,  pinnable: false, immune: true },
  echo:       { rad: 0.5,  spd: 0,    lethal: true,  solid: true,  pinnable: true },
};

// eye states
const ST = {
  DORMANT: 'dormant',     // closed, waiting to wake
  ACTIVE: 'active',
  ACQUIRING: 'acquiring',
  PINNED: 'pinned',
  RELEASING: 'releasing',
  STUNNED: 'stunned',     // disrupted: harmless, still, rides its ring
  FEIGN: 'feign',         // the liar, pretending to be pinned
  REVEALED: 'revealed',   // a false eye, seen for what it is
  KNOT: 'knot',           // gathered into an obstruction by a collector
  DEAD: 'dead',           // closed for good (absorbed, or a broken crown jewel)
};
const HELD = s => s === ST.PINNED || s === ST.RELEASING;
