// =====================================================================
// Every gameplay number lives here. The lab panel edits these live.
// Units: metres, seconds, metres per second.
// =====================================================================

const TUNING = {
  cat: {
    // body: a cat is long and low. The collision box is axis-aligned.
    halfWidth: 0.13, halfLength: 0.26, standHeight: 0.40, crouchHeight: 0.22,
    // forward run: automatic. The stick's vertical axis sets the pace.
    cruise: 5.6, sprint: 7.2, walk: 0, accel: 7.5, brake: 14, startBoost: 0.6,
    paceDead: 0.32,             // vertical stick travel ignored, so steering never brakes by accident
    // lateral steering (target velocity, then acceleration toward it)
    lateral: 4.2, lateralAccel: 24, lateralAccelAir: 10, lateralDecel: 30,
    // narrow surfaces (ledges, pipes): below this width the cat steadies itself
    narrowWidth: 0.75, narrowLateral: 0.55, narrowCentering: 6,
    // thin pipes are balance surfaces: careful pace, stronger roll-off. Squeezing is a crawl.
    balanceWidth: 0.4, balanceSpeed: 3.6, balancePull: 1.6, crawlSpeed: 3.0,
    // slopes: sideways pull toward the eaves; uphill slows, downhill speeds
    slopePush: 1.6, slopeClimb: 0.45, slopeDescend: 0.25,
    // edge grip: steering off a side edge is resisted this long before the cat lets go
    edgeGrip: 0.22,
    // jump. apex = jumpVel^2 / (2 * gravity) ~ 1.16 m
    gravity: 23, jumpVel: 7.3, jumpForward: 0.9, fallMul: 1.55, jumpCut: 2.6, maxFall: 26,
    jumpMinHold: 0.13,           // hold mode: a tap still gets this much full-strength rise
    coyote: 0.11, buffer: 0.14,
    stepUp: 0.2, slopeSnap: 0.28,
    // landing
    hardLanding: 10.5, hardLandingSlow: 0.55, hardLandingTime: 0.35,
    // stumble: running nose-first into a wall
    stumbleSpeed: 0.25, stumbleTime: 0.55,
    // recovery
    killDepth: 5
  },
  assist: {
    enabled: true,
    // in-air lateral nudge toward a surface the cat would narrowly miss
    lateralReach: 0.4, lateralAccel: 9,
    // on the ground: running at a narrow surface slightly off-line lines the cat up with it
    alignReach: 0.45, alignAhead: 2.2, alignStrength: 5,
    // ledge scramble: front paws catch an edge the cat came up just short of
    scramble: true, scrambleReach: 0.32, scrambleDrop: 0.42, scrambleTime: 0.26, scrambleSpeed: 0.7
  },
  hazards: {
    // steam vents cycle: idle, then a visible hissing warning, then the burst
    steamIdle: 1.5, steamWarn: 0.55, steamBurst: 0.7, steamRadius: 0.5, steamHeight: 2.4,
    steamKnockUp: 4.2, steamStumble: 0.6,
    // unstable catwalk: creaks once stood on, then gives way
    creakTime: 0.5, fallGravity: 16, resetTime: 3.5,
    // suspended rope bridges sway and carry the cat sideways
    swayAmp: 0.14, swayRate: 1.7,
    pickupRadius: 0.55, relayRadius: 1.3, waypointRadius: 3
  },
  input: {
    jumpMode: 'hold',            // 'hold' (variable height) or 'tap' (always full)
    stickRadius: 52, stickDead: 0.1, stickCurve: 1.35,
    jumpZone: 0.45               // right fraction of the screen that also jumps
  },
  camera: {
    landscape: { fov: 52, back: 1.42, up: 0.7, lookAhead: 5.5, lookUp: -0.05, follow: 0.82 },
    portrait: { fov: 60, back: 1.95, up: 1.02, lookAhead: 6, lookUp: -0.25, follow: 0.72 },
    speedBack: 0.05, speedFov: 1.2,
    posK: 7, heightK: 3.5, airHeightK: 1.6, lookK: 6,
    terrainProbe: [3, 6, 10, 14], gapLift: 0.3, gapBack: 0.25, arcFollow: 0.35,
    landDip: 0.05, nearClip: 0.4
  }
};
