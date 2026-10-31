// Rigid-body simulation (planck.js, a Box2D port).
//
// World units: the tabletop is 3.2 units long. y points up, the pivot is the
// origin. Gravity is scaled so the table reads as roughly a 1.6 m board.
//
// The table is one dynamic body hinged on a revolute joint at the pivot. Its
// tabletop sits above the pivot and a brass ballast hangs below it, so the
// assembly behaves like a real balance: an off-centre load produces a torque
// m * g * x about the pivot, the pivot supplies the reaction force, and the
// table turns until the ballast's restoring torque (M * g * L * sin(angle))
// matches the load. Tall stacks raise the combined centre of mass towards the
// pivot and erode that restoring torque, which is where late-game wobble
// comes from. Nothing about the table's angle is animated.

const PHYS = {
  g: 24,
  halfLen: 1.6,          // half the tabletop length
  thick: 0.16,
  topY: 0.22,            // tabletop surface height above the pivot
  tableMass: 5,
  ballastMass: 24,
  ballastL: 1.15,        // ballast centre distance below the pivot
  limit: 25 * DEG,       // physical end stops of the hinge
  angDamp: 7,
  pivotFriction: 3,      // joint friction torque
  floorY: -1.85,
  wallX: 2.2,            // inner face of the off-table walls (set from the screen width)
  hz: 60
};

function createSim(planck, opts) {
  const P = Object.assign({}, PHYS, opts || {});
  const V = planck.Vec2;
  const world = new planck.World({ gravity: V(0, -P.g), allowSleep: false });

  const ground = world.createBody({ type: 'static' });
  ground.setUserData({ kind: 'floor' });
  // Floor, side walls (off screen) and the pedestal plinth: these catch what
  // falls so it stays physical after a failure.
  const floorFix = [
    ground.createFixture(planck.Box(9, 0.5, V(0, P.floorY - 0.5), 0), { friction: 0.7 }),
    ground.createFixture(planck.Box(0.3, 4, V(-P.wallX - 0.3, P.floorY + 3.5), 0), { friction: 0.4 }),
    ground.createFixture(planck.Box(0.3, 4, V(P.wallX + 0.3, P.floorY + 3.5), 0), { friction: 0.4 }),
    ground.createFixture(planck.Polygon([V(-0.75, P.floorY), V(0.75, P.floorY), V(0.55, P.floorY + 0.28), V(-0.55, P.floorY + 0.28)]), { friction: 0.6 })
  ];
  for (const f of floorFix) f.setUserData({ kind: 'floor' });

  const table = world.createBody({ type: 'dynamic', position: V(0, 0), angularDamping: P.angDamp, bullet: true });
  table.setUserData({ kind: 'table' });
  const topFix = table.createFixture(planck.Box(P.halfLen, P.thick / 2, V(0, P.topY - P.thick / 2), 0), { friction: 0.62, restitution: 0.05, density: 1 });
  topFix.setUserData({ kind: 'table' });
  // The ballast is a weight on a rod; it never collides with anything.
  const ballastFix = table.createFixture(planck.Circle(V(0, -P.ballastL), 0.24), { density: 1, filterMaskBits: 0, filterCategoryBits: 0 });
  ballastFix.setUserData({ kind: 'ballast' });
  setTableMass();

  const joint = world.createJoint(planck.RevoluteJoint({
    enableLimit: true, lowerAngle: -P.limit, upperAngle: P.limit,
    enableMotor: true, motorSpeed: 0, maxMotorTorque: P.pivotFriction
  }, ground, table, V(0, 0)));

  // Explicit mass properties for the table assembly: tabletop plank plus a
  // point-like ballast, combined with the parallel-axis theorem.
  function setTableMass() {
    const mt = P.tableMass, mb = P.ballastMass;
    const L = P.halfLen * 2, cyT = P.topY - P.thick / 2, cyB = -P.ballastL;
    const m = mt + mb;
    const cy = (mt * cyT + mb * cyB) / m;
    const It = mt * (L * L + P.thick * P.thick) / 12 + mt * cyT * cyT;
    const Ib = mb * 0.5 * 0.24 * 0.24 + mb * cyB * cyB;
    table.setMassData({ mass: m, center: V(0, cy), I: It + Ib });
  }

  // ---- objects ----
  const bodies = [];

  function makeBody(def, x, y, angle) {
    const b = world.createBody({
      type: 'dynamic', position: V(x, y), angle: angle || 0,
      angularDamping: def.angDamp || 0.08, linearDamping: 0.02, bullet: false
    });
    for (const piece of def.pieces) {
      let shape;
      if (piece.circle) shape = planck.Circle(V(piece.circle[0], piece.circle[1]), piece.circle[2]);
      else shape = planck.Polygon(piece.map(p => V(p[0], p[1])));
      const f = b.createFixture(shape, { density: 1, friction: def.friction, restitution: def.restitution });
      f.setUserData({ kind: 'object' });
    }
    // Override mass and centre of mass with the object's authored values,
    // keeping the shape's inertia distribution (scaled to the new mass).
    const md = { mass: 0, center: V(0, 0), I: 0 };
    b.getMassData(md);
    const c0 = md.center, m0 = md.mass;
    const Ic0 = md.I - m0 * (c0.x * c0.x + c0.y * c0.y);
    const com = def.com ? V(def.com[0], def.com[1]) : V(c0.x, c0.y);
    const Ic = Ic0 * (def.mass / m0) * (def.inertiaScale || 1);
    b.setMassData({ mass: def.mass, center: com, I: Ic + def.mass * (com.x * com.x + com.y * com.y) });
    return b;
  }

  function overlapsAny(body) {
    const xf = body.getTransform();
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      const aabb = f.getAABB(0);
      let hit = false;
      world.queryAABB(aabb, other => {
        if (other.getBody() === body) return true;
        const od = other.getUserData();
        if (od && od.kind === 'ballast') return true;
        if (!other.getBody().isActive()) return true;
        if (planck.testOverlap(f.getShape(), 0, other.getShape(), 0, xf, other.getBody().getTransform())) { hit = true; return false; }
        return true;
      });
      if (hit) return true;
    }
    return false;
  }

  // What is directly below a point: { kind: 'table' | 'object' | 'floor', y }
  // or null. `skip` is a body to ignore (the one being held).
  function supportBelow(x, y, skip) {
    let best = null, bestF = 2;
    const y1 = P.floorY - 1;
    world.rayCast(V(x, y), V(x, y1), (fix, point, normal, fraction) => {
      const d = fix.getUserData();
      if (!d || d.kind === 'ballast') return -1;
      if (!fix.getBody().isActive() || fix.getBody() === skip) return -1;
      if (fraction < bestF) { bestF = fraction; best = { kind: d.kind, y: point.y }; }
      return fraction;
    });
    return best;
  }

  // Place a body at (x, y), nudging it upward until it no longer overlaps
  // anything, so a release never starts inside another body.
  function placeClear(body, x, y) {
    let yy = y;
    for (let i = 0; i < 200; i++) {
      body.setTransform(V(x, yy), 0);
      if (!overlapsAny(body)) return yy;
      yy += 0.025;
    }
    return yy;
  }

  function addObject(def, x, y, vx, vy) {
    const b = makeBody(def, x, y, 0);
    placeClear(b, x, y);
    b.setLinearVelocity(V(vx || 0, vy || 0));
    bodies.push(b);
    return b;
  }

  function lift(b) { b.setActive(false); }
  function drop(b, x, y, vx, vy) {
    b.setActive(true);
    b.setAngularVelocity(0);
    placeClear(b, x, y);
    b.setLinearVelocity(V(vx || 0, vy || 0));
    b.setAwake(true);
  }
  function remove(b) {
    const i = bodies.indexOf(b);
    if (i >= 0) bodies.splice(i, 1);
    world.destroyBody(b);
  }

  // Does the body touch the floor, the plinth or a wall?
  function touchesGround(b) {
    for (let ce = b.getContactList(); ce; ce = ce.next) {
      if (ce.other === ground && ce.contact.isTouching()) return true;
    }
    return false;
  }
  function touchesTableOrStack(b) {
    for (let ce = b.getContactList(); ce; ce = ce.next) {
      if (!ce.contact.isTouching()) continue;
      if (ce.other === table) return true;
      const ud = ce.other.getUserData();
      if (ud && ud.kind === 'object') return true;
    }
    return false;
  }

  function step() { world.step(1 / P.hz, 10, 4); }

  // Net gravitational torque about the pivot from everything resting on the
  // table (sum of m * g * x), and the combined load.
  function loadTorque() {
    let t = 0, m = 0;
    for (const b of bodies) {
      if (!b.isActive()) continue;
      const c = b.getWorldCenter();
      if (c.y < P.floorY + 0.6) continue;
      t += b.getMass() * P.g * c.x;
      m += b.getMass();
    }
    return { torque: t, mass: m };
  }

  return {
    P, world, table, joint, ground, bodies, planck,
    angle: () => table.getAngle(),
    angVel: () => table.getAngularVelocity(),
    addObject, lift, drop, remove, overlapsAny, supportBelow, placeClear,
    touchesGround, touchesTableOrStack, step, loadTorque, setTableMass,
    // Surface height of the tabletop at world x (for the current angle).
    surfaceY(x) { const a = table.getAngle(); return P.topY / Math.cos(a) + Math.tan(a) * x; }
  };
}
