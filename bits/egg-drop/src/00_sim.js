// Physics: one platform on a pivot, a counterweight carriage on a rail
// hung beneath it, and an egg. Everything is a planck (Box2D) rigid body;
// the platform angle is never set directly, only produced by torques.
// Units are SI: metres, kilograms, seconds, radians.

const SURFACES = {
  rubber:  { label: 'Rubber',  muS: 1.05, muK: 0.85, roll: 0.016, rest: 0.02 },
  wood:    { label: 'Wood',    muS: 0.55, muK: 0.42, roll: 0.005, rest: 0.06 },
  ceramic: { label: 'Ceramic', muS: 0.16, muK: 0.10, roll: 0.0035, rest: 0.10 },
  metal:   { label: 'Metal',   muS: 0.07, muK: 0.04, roll: 0.0015, rest: 0.12 }
};
const SURFACE_ORDER = ['rubber', 'wood', 'ceramic', 'metal'];

const GEOM = {
  half: 2.0,          // deck half length
  deckBottom: 0.04,   // deck sits just above the pivot axle
  deckTop: 0.20,
  railY: -0.5,        // rail rod, in platform frame
  railHalf: 1.62,     // visible rod half length
  travel: 1.36,       // carriage limit either side
  tableY: -2.6,       // the table the egg lands on
  eggA: 0.33,         // egg half length (blunt end towards +x)
  eggB: 0.305,        // egg half width
  eggK: 0.06          // asymmetry: blunt and pointed ends
};

const CAT = { DECK: 1, EGG: 2, TABLE: 4 };

// Egg outline in body coordinates. x along the long axis, blunt end at +x.
function eggOutline(n, A, B, K) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push({ x: A * c, y: B * s * (1 + K * c) });
  }
  return pts;
}

function createSim(pl, opt) {
  opt = opt || {};
  const V = pl.Vec2;
  const surf = SURFACES[opt.surface] || SURFACES.wood;
  const g = 9.81 * (opt.gravityScale || 1);
  const world = new pl.World({ gravity: V(0, -g) });
  const ground = world.createBody();

  // the table under everything, where a fallen egg ends up
  const table = world.createBody({ position: V(0, GEOM.tableY) });
  table.createFixture(new pl.Box(12, 0.3, V(0, -0.3), 0), { friction: 0.6, restitution: 0.05, filterCategoryBits: CAT.TABLE, filterMaskBits: CAT.EGG });

  // platform: deck, hangers and rail form one rigid body
  const platform = world.createBody({ type: 'dynamic', position: V(0, 0), angularDamping: opt.angularDamping != null ? opt.angularDamping : 0.55 });
  const deckH = (GEOM.deckTop - GEOM.deckBottom) / 2, deckY = (GEOM.deckTop + GEOM.deckBottom) / 2;
  const deckMass = 1.35, deckArea = GEOM.half * 2 * deckH * 2;
  const deck = platform.createFixture(new pl.Box(GEOM.half, deckH, V(0, deckY), 0), {
    density: deckMass / deckArea, friction: surf.muS, restitution: surf.rest,
    filterCategoryBits: CAT.DECK, filterMaskBits: CAT.EGG
  });
  // rail rod and two hangers carry mass but collide with nothing
  const railMass = 0.42, railArea = GEOM.railHalf * 2 * 0.05;
  platform.createFixture(new pl.Box(GEOM.railHalf, 0.025, V(0, GEOM.railY), 0), { density: railMass / railArea, filterMaskBits: 0 });
  for (const sx of [-1, 1]) {
    const hx = sx * (GEOM.railHalf - 0.02), len = GEOM.deckBottom - GEOM.railY;
    platform.createFixture(new pl.Box(0.025, len / 2, V(hx, GEOM.railY + len / 2), 0), { density: 0.06 / (0.05 * len), filterMaskBits: 0 });
  }
  const pivot = world.createJoint(new pl.RevoluteJoint({
    enableLimit: true, lowerAngle: -(opt.maxAngle || 0.31), upperAngle: (opt.maxAngle || 0.31),
    // a little bearing friction: the platform does not drift at a whisper
    enableMotor: true, motorSpeed: 0, maxMotorTorque: 0.18
  }, ground, platform, V(0, 0)));

  // counterweight carriage on the rail
  const cwMass = opt.cwMass || 0.95;
  const cw = world.createBody({ type: 'dynamic', position: V(0, GEOM.railY), fixedRotation: false });
  // the brass bell hangs below the rail; its mass centre sits in the bell
  cw.createFixture(new pl.Box(0.24, 0.22, V(0, -0.2), 0), { density: cwMass / (0.48 * 0.44), filterMaskBits: 0 });
  const rail = world.createJoint(new pl.PrismaticJoint({
    enableLimit: true, lowerTranslation: -GEOM.travel, upperTranslation: GEOM.travel,
    enableMotor: true, maxMotorForce: 7, motorSpeed: 0
  }, platform, cw, V(0, GEOM.railY), V(1, 0)));

  // egg: convex fans around the centre form the ovoid. Many small facets,
  // so the shell rolls on its curve rather than resting on flat faces
  const fans = 10, per = 11;
  const outline = eggOutline(fans * per, opt.eggA || GEOM.eggA, opt.eggB || GEOM.eggB, opt.eggK != null ? opt.eggK : GEOM.eggK);
  const eggMass = 0.55;
  let area = 0;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; area += (a.x * b.y - b.x * a.y) / 2; }
  const egg = world.createBody({ type: 'dynamic', bullet: true, position: V(opt.eggX || 0, GEOM.deckTop + GEOM.eggB + 0.002), angle: 0, linearDamping: 0.02, angularDamping: 0.02 });
  for (let f = 0; f < fans; f++) {
    const verts = [V(0, 0)];
    for (let i = 0; i <= per; i++) { const p = outline[(f * per + i) % outline.length]; verts.push(V(p.x, p.y)); }
    egg.createFixture(new pl.Polygon(verts), { density: eggMass / area, friction: surf.muS, restitution: surf.rest, filterCategoryBits: CAT.EGG, filterMaskBits: CAT.DECK | CAT.TABLE });
  }

  const s = {
    world, platform, cw, egg, pivot, rail, surf, outline, g,
    target: 0, dragging: false, driveGain: 15, driveMax: 3.4, driveForce: 46, brakeForce: 7.5,
    disturb: 0,                // external torque on the platform this step (N·m)
    eggOnDeck: false, eggOnTable: false, deckNormal: 0, tableImpact: 0, deckImpact: 0,
    rollTorque: 0, slipping: false, contactCount: 0,
    limitHit: 0, lastCwSpeed: 0, stopHit: 0, lastAngVel: 0,
    time: 0
  };

  // static vs kinetic friction, chosen from the slip speed at the contact
  world.on('pre-solve', (contact) => {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    const isDeck = fa === deck || fb === deck;
    if (!isDeck) return;
    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points.length) return;
    const p = wm.points[0], n = wm.normal;
    const va = platform.getLinearVelocityFromWorldPoint(p), vb = egg.getLinearVelocityFromWorldPoint(p);
    const rvx = vb.x - va.x, rvy = vb.y - va.y;
    const vt = rvx * -n.y + rvy * n.x;
    const slip = Math.abs(vt) > 0.025;
    s.slipping = s.slipping || slip;
    contact.setFriction(slip ? surf.muK : surf.muS);
  });

  world.on('post-solve', (contact, imp) => {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    let J = 0;
    for (let i = 0; i < imp.normalImpulses.length; i++) J += imp.normalImpulses[i];
    if (fa === deck || fb === deck) { s.deckNormal += J; s.contactCount++; }
    else if (fa.getBody() === table || fb.getBody() === table) { s.tableImpact = Math.max(s.tableImpact, J); }
  });

  world.on('begin-contact', (contact) => {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points.length) return;
    const p = wm.points[0], n = wm.normal;
    const other = (fa === deck || fb === deck) ? platform : table;
    const va = other.getLinearVelocityFromWorldPoint(p), vb = egg.getLinearVelocityFromWorldPoint(p);
    const vn = Math.abs((vb.x - va.x) * n.x + (vb.y - va.y) * n.y);
    if (other === platform) s.deckImpact = Math.max(s.deckImpact, vn);
    else s.tableImpact = Math.max(s.tableImpact, vn * eggMass);
  });

  s.step = function (h) {
    // carriage drive: a servo motor in the carriage pushes against the rail,
    // so its reaction acts on the platform as well
    const x = rail.getJointTranslation();
    const v = rail.getJointSpeed();
    if (s.dragging) {
      const want = Math.max(-s.driveMax, Math.min(s.driveMax, (s.target - x) * s.driveGain));
      rail.setMotorSpeed(want);
      rail.setMaxMotorForce(s.driveForce);
    } else {
      rail.setMotorSpeed(0);
      rail.setMaxMotorForce(s.brakeForce);
    }

    // rolling resistance: a couple opposing the egg's rolling relative to
    // the deck, proportional to the normal load (lever arm = coefficient)
    s.rollTorque = 0;
    if (s.eggOnDeck) {
      const N = s.lastNormal;
      const wr = egg.getAngularVelocity() - platform.getAngularVelocity();
      const tau = -surf.roll * N * Math.tanh(wr / 0.35);
      egg.applyTorque(tau, true);
      platform.applyTorque(-tau, true);
      s.rollTorque = tau;
    }
    if (s.disturb) platform.applyTorque(s.disturb, true);

    s.deckNormal = 0; s.contactCount = 0; s.slipping = false;
    world.step(h, 10, 4);
    s.time += h;
    s.lastNormal = s.deckNormal / h;
    s.eggOnDeck = s.contactCount > 0;

    // events the presentation listens for
    const x2 = rail.getJointTranslation();
    if (Math.abs(x2) >= GEOM.travel - 0.004 && Math.abs(v) > 0.25 && Math.sign(v) === Math.sign(x2)) s.limitHit = Math.max(s.limitHit, Math.abs(v));
    const ang = platform.getAngle(), w = platform.getAngularVelocity();
    if (Math.abs(ang) >= (opt.maxAngle || 0.31) - 0.003 && Math.abs(s.lastAngVel) > 0.08 && Math.sign(s.lastAngVel) === Math.sign(ang)) s.stopHit = Math.max(s.stopHit, Math.abs(s.lastAngVel));
    s.lastAngVel = w;
    s.lastCwSpeed = rail.getJointSpeed();
  };
  s.lastNormal = 0;

  s.cwPos = () => rail.getJointTranslation();
  s.angle = () => platform.getAngle();
  // egg centre of mass expressed in the platform frame
  s.eggLocal = () => {
    const p = egg.getWorldCenter();
    const l = platform.getLocalPoint(p);
    return { x: l.x, y: l.y };
  };
  s.eggLocalVel = () => {
    const p = egg.getWorldCenter();
    const v = egg.getLinearVelocity(), vp = platform.getLinearVelocityFromWorldPoint(p);
    const a = platform.getAngle(), c = Math.cos(a), sn = Math.sin(a);
    const rx = v.x - vp.x, ry = v.y - vp.y;
    return { x: rx * c + ry * sn, y: -rx * sn + ry * c };
  };
  // the egg has left the deck and dropped past its end
  s.eggFallen = () => {
    const l = s.eggLocal();
    if (egg.getWorldCenter().y < -1.25) return true;
    return !s.eggOnDeck && Math.abs(l.x) > GEOM.half + 0.02 && l.y < GEOM.deckTop + 0.05;
  };
  // torque balance about the pivot (for tests and the HUD's stability read)
  s.gravityTorque = () => {
    let t = 0;
    for (const b of [platform, cw, egg]) { const c = b.getWorldCenter(); t += -b.getMass() * g * c.x; }
    return t;
  };
  s.inertiaAboutPivot = () => {
    let I = 0;
    for (const b of [platform, cw, egg]) { const c = b.getWorldCenter(); I += b.getInertia() - b.getMass() * (b.getLocalCenter().x ** 2 + b.getLocalCenter().y ** 2) + b.getMass() * (c.x * c.x + c.y * c.y); }
    return I;
  };
  return s;
}
