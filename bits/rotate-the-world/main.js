// ---------------------------------------------------------------------------
// ROTATE THE WORLD
// A kinetic sculpture you turn with one finger. Gravity stays screen-down;
// the world turns underneath a small light trapped in glass.
//
// Everything above window.plethoraBit is pure (no DOM, no THREE): level data
// and the rotating-frame physics. Positions live in world-local coordinates,
// velocities in screen space, so turning the world genuinely sweeps surfaces
// under the ball and water.
// ---------------------------------------------------------------------------

const RTW = (() => {
  const D2R = Math.PI / 180;
  const BALL_R = 0.42;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ---- authoring helpers --------------------------------------------------
  function arc(cx, cy, R, a0, a1, step) {
    step = step || 0.3;
    const len = Math.abs(a1 - a0) * D2R * R;
    const n = Math.max(2, Math.ceil(len / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * D2R;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    return pts;
  }
  function spiral(cx, cy, r0, pitch, a0, turns, step) {
    step = step || 0.3;
    const pts = [];
    let phi = 0;
    const end = turns * Math.PI * 2;
    while (phi <= end + 1e-6) {
      const r = r0 - (pitch * phi) / (Math.PI * 2);
      const a = a0 * D2R + phi;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      phi += step / Math.max(1, r);
      if (phi > end && phi - step / Math.max(1, r) < end - 1e-6) phi = end;
    }
    return pts;
  }
  // Chaikin rounding keeps architecture soft without hand-placing arcs.
  function soften(pts, iters) {
    let p = pts;
    for (let k = 0; k < (iters || 2); k++) {
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }
  function S(pts, o) {
    return Object.assign(
      { pts, h: 0.24, depth: 2.2, mat: "porcelain", z: 0, layer: 0, deco: false, closed: false },
      o || {}
    );
  }

  // ---- levels --------------------------------------------------------------
  // Units: the sculpture sits inside a radius of about 10. y is up; at world
  // angle 0 gravity points to -y. Each level teaches one relationship.
  const LEVELS = [
    // 01 TILT — rotate and gravity changes relative to architecture.
    () => ({
      name: "TILT",
      hint: "TURN",
      ball: [0, -1.3],
      bounds: 11.5,
      fit: 9.6,
      root: 0,
      strokes: [
        S(arc(0, 11, 13.2, 242, 295.1), { id: "ramp", h: 0.3, depth: 2.6, layer: 0 }),
        S(arc(7.1, -0.9, 1.15, 205, 425), { id: "cup", h: 0.2, depth: 2.0, mat: "charcoal", layer: 1 }),
        S([[0, -2.9], [0, -7.2]], { deco: true, h: 0.5, depth: 1.2, mat: "stone", z: -1.7, layer: -1 }),
        S(arc(0, -1.2, 7.4, 18, 162), { deco: true, h: 0.16, depth: 0.8, mat: "stone", z: -2.4, layer: -2 }),
        S([[0, 0]], { deco: true, h: 0.36, depth: 0.5, mat: "alu", z: -1.6, layer: -1 }),
        S([[-4.6, -7.2], [4.6, -7.2]], { deco: true, h: 0.34, depth: 2.4, mat: "stone", z: -1.7, layer: -1 })
      ],
      goal: { x: 7.1, y: -0.9, r: 1.0 },
      reveal: [S(arc(7.1, -0.9, 1.9, 190, 440), { deco: true, h: 0.05, depth: 0.2, mat: "alu", z: -0.9, layer: 2 })]
    }),

    // 02 LOOP — walls become floors; a conical spiral that descends into itself.
    () => {
      const r0 = 8.4, pitch = 1.75, turns = 2.25;
      const zf = (x, y) => -0.32 * (r0 - Math.hypot(x, y));
      const rEnd = r0 - pitch * turns;
      const rPrev = r0 - pitch * (turns - 1);
      return {
        name: "LOOP",
        hint: "AGAIN",
        ball: [7.35, 1.2],
        bounds: 11.5,
        fit: 9.6,
        root: 3,
        zField: zf,
        strokes: [
          S(spiral(0, 0, r0, pitch, 0, turns, 0.32), { id: "spiral", h: 0.22, depth: 2.0, layer: 0 }),
          S([[r0, 0], [r0 - pitch, 0]], { id: "capA", h: 0.22, depth: 2.0, mat: "charcoal", layer: 1 }),
          S([[0, rEnd], [0, rPrev]], { id: "capB", h: 0.22, depth: 2.0, mat: "charcoal", layer: 1 }),
          S([[0, 0]], { deco: true, h: 3.2, depth: 0.5, mat: "stone", z: -2.2, layer: -2 }),
          S(arc(0, 0, 2.4, 0, 360), { deco: true, closed: true, h: 0.12, depth: 0.6, mat: "alu", z: -1.7, layer: -1 })
        ],
        goal: { x: 1.4, y: 5.2, r: 1.15 },
        reveal: [0, 60, 120, 180, 240, 300].map((a) =>
          S(soften([[0, 0], [1.2 * Math.cos((a + 20) * D2R), 1.2 * Math.sin((a + 20) * D2R)], [2.3 * Math.cos(a * D2R), 2.3 * Math.sin(a * D2R)]], 2),
            { deco: true, h: 0.16, depth: 0.3, mat: "resin", z: -1.3, layer: 2 })
        )
      };
    },

    // 03 FOLD — a wall that becomes a bridge, a floor that becomes a hole.
    () => ({
      name: "FOLD",
      hint: "WAKE IT",
      ball: [-4.6, 0.6],
      bounds: 12,
      fit: 9.8,
      root: 5,
      strokes: [
        S(soften([[-7.6, 3.0], [-8.4, 1.6], [-8.2, 0.0], [-7.4, -0.05], [-2.6, 0.0]], 2), { id: "p1", h: 0.28, depth: 2.4 }),
        S([[2.6, 0], [4.0, 0]], { id: "p2a", h: 0.28, depth: 2.4 }),
        S(soften([[6.0, 0], [8.0, 0.0], [8.6, 0.8], [8.6, 2.8], [7.9, 3.6]], 2), { id: "p2b", h: 0.28, depth: 2.4 }),
        S([[2.6, 0], [-2.8, 0]], { id: "bridge", h: 0.22, depth: 1.8, mat: "alu", layer: 1,
          dyn: { pivot: [2.6, 0], a0: -90, a1: 0, trigger: "bud", delay: 0.35, dur: 1.7 } }),
        S([[4.0, 0], [6.0, 0]], { id: "trap", h: 0.24, depth: 2.0, mat: "charcoal", layer: 1,
          dyn: { pivot: [4.0, 0], a0: 0, a1: -92, trigger: "plate", delay: 0.1, dur: 0.75 } }),
        S(arc(5, -3.4, 1.55, 172, 368), { id: "bowl", h: 0.22, depth: 2.0, mat: "charcoal", layer: 0 }),
        S(arc(0, 0, 2.7, 10, 170), { deco: true, h: 0.2, depth: 0.9, mat: "stone", z: -2.2, layer: -2 }),
        S([[-5.2, -0.4], [-5.2, -5.4]], { deco: true, h: 0.45, depth: 1.2, mat: "stone", z: -1.6, layer: -1 }),
        S([[7.0, -0.4], [7.0, -5.4]], { deco: true, h: 0.45, depth: 1.2, mat: "stone", z: -1.6, layer: -1 })
      ],
      buds: [{ id: "bud", x: -7.45, y: 0.75, r: 0.5, hold: 0.4 }],
      triggers: [{ id: "plate", kind: "zone", x: 0.6, y: 0.55, r: 0.5 }],
      goal: { x: 5, y: -3.9, r: 1.1 },
      reveal: [S(arc(0, 0, 3.4, 12, 168), { deco: true, h: 0.06, depth: 0.2, mat: "alu", z: -1.4, layer: 2 })]
    }),

    // 04 WATER — pour the reservoir; the fluid wakes the gate.
    () => ({
      name: "WATER",
      hint: "POUR",
      ball: [-5.2, -2.4],
      bounds: 12.5,
      fit: 10.2,
      root: 7,
      strokes: [
        S(soften([[-7, 7.6], [-7, 4.2], [-6.4, 3.2], [-5.3, 2.9], [-3.3, 2.9], [-2.5, 3.4], [-2.4, 5.1]], 2), { id: "res", h: 0.24, depth: 2.4, mat: "glass" }),
        S([[-1.6, 4.3], [1.4, 3.35]], { id: "chute", h: 0.18, depth: 1.8, mat: "alu" }),
        S(soften([[0.6, 3.3], [0.9, 1.3], [1.7, 0.55], [3.1, 0.55], [3.9, 1.3], [4.2, 3.2], [4.3, 5.6]], 2), { id: "basin", h: 0.22, depth: 2.2 }),
        S(soften([[-7.5, 0.3], [-7.6, -2.4], [-7.0, -3.0], [5.2, -3.0]], 2), { id: "floor", h: 0.28, depth: 2.6 }),
        S([[-7.5, 0.3], [-0.7, 0.3]], { id: "ceil", h: 0.24, depth: 2.4 }),
        S([[-1.0, -3.0], [1.6, -3.0]], { id: "gate", h: 0.2, depth: 2.0, mat: "charcoal", layer: 1,
          dyn: { pivot: [-1.0, -3.0], a0: 90, a1: 0, trigger: "lotus", delay: 0.6, dur: 1.8 } }),
        S(arc(6.3, -2.9, 1.1, 180, 420), { id: "cup", h: 0.2, depth: 2.0, mat: "charcoal" }),
        S([[-4.8, 8.6], [-4.8, 9.6]], { deco: true, h: 0.22, depth: 0.5, mat: "alu", z: 0, layer: 1 }),
        S([[2.4, 0.2], [2.4, -1.6]], { deco: true, h: 0.3, depth: 1.0, mat: "stone", z: -1.5, layer: -1 }),
        S(arc(-4.8, 4.8, 3.2, 0, 360), { deco: true, closed: true, h: 0.1, depth: 0.4, mat: "stone", z: -2.2, layer: -2 })
      ],
      water: { count: 76, box: [-6.5, 3.3, -2.9, 5.6], source: [-4.8, 8.2] },
      triggers: [{ id: "lotus", kind: "water", x: 2.4, y: 1.35, r: 1.35, count: 18, lotus: true }],
      goal: { x: 6.3, y: -3.2, r: 1.0 },
      reveal: [S(arc(2.4, 1.6, 2.4, 200, 340), { deco: true, h: 0.06, depth: 0.2, mat: "alu", z: -1.2, layer: 2 })]
    }),

    // 05 GROW — two buds, two organisms; the route you take changes the object.
    () => ({
      name: "GROW",
      hint: "LEFT, OR RIGHT",
      ball: [0, 5.65],
      bounds: 12,
      fit: 9.8,
      root: 2,
      strokes: [
        S(arc(0, 6.9, 1.9, 238, 302), { id: "cradle", h: 0.2, depth: 2.0, mat: "charcoal" }),
        S([[-1.35, 5.1], [-6.1, 2.85]], { id: "rampL", h: 0.24, depth: 2.2 }),
        S([[1.35, 5.1], [6.1, 2.85]], { id: "rampR", h: 0.24, depth: 2.2 }),
        // left organism: petals that grow into a curling chute
        S(arc(-5.0, 0.8, 2.5, 165, 200), { id: "petalL1", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-7.2, 1.9], s0: 0.02, s1: 1, a0: -40, a1: 0, trigger: "budL", delay: 0.1, dur: 0.8, solid: "grown" } }),
        S(arc(-5.0, 0.8, 2.5, 198, 230), { id: "petalL2", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-7.4, 0.2], s0: 0.02, s1: 1, a0: -40, a1: 0, trigger: "budL", delay: 0.4, dur: 0.8, solid: "grown" } }),
        S(arc(-5.0, 0.8, 2.5, 228, 255), { id: "petalL3", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-6.6, -1.1], s0: 0.02, s1: 1, a0: -40, a1: 0, trigger: "budL", delay: 0.7, dur: 0.8, solid: "grown" } }),
        S([[-5.3, -2.3], [-1.75, -4.4]], { id: "rampL2", h: 0.22, depth: 2.0 }),
        // right organism: a crystal stair that grows shelf by shelf
        S([[7.4, 2.0], [5.0, 1.1]], { id: "xtal1", h: 0.18, depth: 1.5, mat: "crystal", layer: 1,
          dyn: { pivot: [7.4, 2.0], s0: 0.02, s1: 1, trigger: "budR", delay: 0.1, dur: 0.6, solid: "grown" } }),
        S([[3.6, 0.3], [6.4, -0.8]], { id: "xtal2", h: 0.18, depth: 1.5, mat: "crystal", layer: 1,
          dyn: { pivot: [3.6, 0.3], s0: 0.02, s1: 1, trigger: "budR", delay: 0.45, dur: 0.6, solid: "grown" } }),
        S([[8.2, 1.0], [8.2, -2.2]], { id: "xtal4", h: 0.16, depth: 1.3, mat: "crystal", layer: 1,
          dyn: { pivot: [8.2, 1.0], s0: 0.02, s1: 1, trigger: "budR", delay: 0.6, dur: 0.6, solid: "grown" } }),
        S([[7.6, -2.0], [3.6, -3.3]], { id: "xtal3", h: 0.18, depth: 1.5, mat: "crystal", layer: 1,
          dyn: { pivot: [7.6, -2.0], s0: 0.02, s1: 1, trigger: "budR", delay: 0.8, dur: 0.6, solid: "grown" } }),
        S([[3.4, -3.8], [1.75, -4.4]], { id: "rampR2", h: 0.22, depth: 2.0 }),
        S(arc(0, -5.2, 1.6, 160, 380), { id: "bowl", h: 0.22, depth: 2.2, mat: "charcoal" }),
        S([[0, -6.9], [0, -8.4]], { deco: true, h: 0.4, depth: 1.0, mat: "stone", z: -1.4, layer: -1 }),
        S([[0, 4.7], [0, -3.2]], { deco: true, h: 0.14, depth: 0.5, mat: "alu", z: -2.0, layer: -2 })
      ],
      buds: [
        { id: "budL", x: -6.55, y: 3.3, r: 0.5, system: "L", hold: 1.7 },
        { id: "budR", x: 6.55, y: 3.3, r: 0.5, system: "R", hold: 1.5 }
      ],
      goal: { x: 0, y: -5.4, r: 1.3 },
      reveal: []
    }),

    // 06 DARK — the ball is the only light; surfaces remember being seen.
    () => ({
      name: "DARK",
      hint: "FOLLOW THE LIGHT",
      dark: true,
      ball: [-5.4, 7.2],
      bounds: 12.5,
      fit: 10.2,
      root: 9,
      strokes: [
        S(soften([[-7.0, 8.4], [-7.2, 6.9], [-6.4, 6.55], [4.4, 6.0]], 2), { id: "a", h: 0.24, depth: 2.2 }),
        S(soften([[7.0, 7.6], [7.0, 4.4], [6.3, 4.05], [-3.4, 3.3]], 2), { id: "b", h: 0.24, depth: 2.2, mat: "stone" }),
        S(soften([[-7.1, 4.0], [-7.1, 1.2], [-6.4, 0.9], [3.2, 0.4]], 2), { id: "c", h: 0.24, depth: 2.2 }),
        S(soften([[7.0, 1.4], [7.0, -1.6], [6.3, -1.95], [-3.8, -2.6]], 2), { id: "d", h: 0.24, depth: 2.2, mat: "stone" }),
        S(soften([[-7.1, -1.8], [-7.1, -5.0], [-6.4, -5.35], [4.4, -5.9]], 2), { id: "e", h: 0.24, depth: 2.2 }),
        S(arc(5.6, -5.4, 1.1, 190, 420), { id: "cup", h: 0.2, depth: 2.0, mat: "charcoal" }),
        S(arc(0, 0, 9.4, 100, 260), { deco: true, h: 0.12, depth: 0.5, mat: "stone", z: -2.2, layer: -2 }),
        S(arc(0, 0, 9.4, -80, 80), { deco: true, h: 0.12, depth: 0.5, mat: "stone", z: -2.2, layer: -2 })
      ],
      goal: { x: 5.6, y: -5.6, r: 1.0 },
      reveal: [S([[-7.6, 8.6], [-7.6, -5.6]], { deco: true, h: 0.08, depth: 0.2, mat: "alu", z: -1.6, layer: 2 }),
        S([[7.6, 6.0], [7.6, -6.4]], { deco: true, h: 0.08, depth: 0.2, mat: "alu", z: -1.6, layer: 2 })]
    }),

    // 07 INSIDE — the sculpture has an interior; enter it and it opens.
    () => ({
      name: "INSIDE",
      hint: "THE OTHER SIDE",
      ball: [-6.9, 7.0],
      bounds: 12.5,
      fit: 10.0,
      root: 4,
      strokes: [
        S(soften([[-8.4, 8.0], [-7.6, 6.55], [-6.6, 6.45], [-5.6, 6.55], [-4.6, 6.2], [-2.4, 5.35]], 2), { id: "ramp", h: 0.24, depth: 2.2 }),
        S(arc(0, -0.5, 5.2, 110, 215), { id: "shellA", h: 0.32, depth: 3.2, shell: true }),
        S(arc(0, -0.5, 5.2, 235, 430), { id: "shellB", h: 0.32, depth: 3.2, shell: true }),
        S(arc(-3.89, -4.39, 0.9, 125, 325), { id: "pocket", h: 0.2, depth: 2.4, mat: "charcoal" }),
        S([[-4.95, 0.85], [2.6, -0.45]], { id: "divider", h: 0.22, depth: 2.6, mat: "alu" }),
        S([[0, -0.5]], { deco: true, h: 5.25, depth: 0.3, mat: "stone", z: -1.75, layer: -2 })
      ],
      slow: [{ x: 3.4, y: -1.9, r: 1.5, scale: 0.28 }],
      inside: { x: 0, y: -0.5, r: 4.9 },
      goal: { x: -3.89, y: -4.39, r: 0.85 },
      reveal: [S(arc(0, -0.5, 6.2, 0, 360), { deco: true, closed: true, h: 0.05, depth: 0.2, mat: "alu", z: 0, layer: 2 })]
    }),

    // 08 THE WHOLE OBJECT — growth and a portal, or water and a lid; either
    // way the ball ends inside the object, and the object remembers which.
    () => ({
      name: "THE WHOLE OBJECT",
      hint: "EVERYTHING AT ONCE",
      dusk: true,
      ball: [0, 6.15],
      bounds: 13,
      fit: 10.8,
      root: 7,
      strokes: [
        S(arc(0, 7.4, 1.9, 238, 302), { id: "cradle", h: 0.2, depth: 2.0, mat: "charcoal" }),
        // route A — growth
        S([[-1.35, 5.6], [-6.2, 3.4]], { id: "rampL", h: 0.24, depth: 2.2 }),
        S(arc(-5.3, 1.2, 2.5, 165, 200), { id: "petal1", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-7.2, 2.3], s0: 0.02, s1: 1, a0: -40, a1: 0, trigger: "bud", delay: 0.1, dur: 0.8, solid: "grown" } }),
        S(arc(-5.3, 1.2, 2.5, 198, 230), { id: "petal2", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-7.7, 0.4], s0: 0.02, s1: 1, a0: -40, a1: 0, trigger: "bud", delay: 0.4, dur: 0.8, solid: "grown" } }),
        S(arc(-5.3, 1.2, 2.5, 228, 262), { id: "petal3", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-6.9, -0.7], s0: 0.02, s1: 1, a0: -40, a1: 0, trigger: "bud", delay: 0.7, dur: 0.8, solid: "grown" } }),
        S(arc(-5.3, 1.2, 2.5, 260, 310), { id: "petal4", h: 0.2, depth: 1.4, mat: "resin", layer: 1,
          dyn: { pivot: [-5.0, -1.3], s0: 0.02, s1: 1, a0: 40, a1: 0, trigger: "bud", delay: 0.95, dur: 0.8, solid: "grown" } }),
        S(soften([[-8.4, -0.4], [-8.2, -2.6], [-7.2, -3.3], [-5.6, -3.3], [-4.95, -2.8], [-4.95, -2.0]], 2), { id: "bowlA", deco: true, h: 0.24, depth: 1.2, mat: "stone", z: -1.6, layer: -1 }),
        // route B — water
        S([[1.35, 5.6], [5.8, 3.55]], { id: "rampR", h: 0.24, depth: 2.2 }),
        S(soften([[8.0, 3.7], [8.1, 2.6], [7.4, 2.2], [2.3, 1.1]], 2), { id: "rampR2", h: 0.24, depth: 2.2, mat: "stone" }),
        S(soften([[2.6, 9.7], [2.6, 7.2], [3.1, 6.6], [5.6, 6.6], [6.1, 7.0], [6.2, 8.3]], 2), { id: "res", h: 0.22, depth: 2.2, mat: "glass" }),
        S(soften([[6.6, 6.4], [6.8, 4.9], [7.4, 4.4], [8.5, 4.4], [9.0, 4.9], [9.2, 6.4], [9.3, 8.6]], 2), { id: "basin", h: 0.2, depth: 2.0 }),
        // the object: a shell with a lid that water opens
        S(arc(0.6, -3.2, 3.8, 110, 430), { id: "shell", h: 0.32, depth: 3.2, shell: true }),
        S(arc(0.6, -3.2, 3.8, 70, 110), { id: "lid", h: 0.3, depth: 3.0, mat: "charcoal", layer: 1,
          dyn: { pivot: [-0.7, 0.371], a0: 0, a1: 96, trigger: "lotus", delay: 0.5, dur: 1.6 } }),
        S([[0.6, -3.2]], { deco: true, h: 3.85, depth: 0.3, mat: "stone", z: -1.75, layer: -2 }),
        S([[0, 5.2], [0, 1.4]], { deco: true, h: 0.14, depth: 0.5, mat: "alu", z: -2.0, layer: -2 })
      ],
      buds: [{ id: "bud", x: -6.65, y: 3.85, r: 0.5, system: "growth", hold: 2.0 }],
      portals: [{ a: [-5.3, -0.75], b: [0.6, -1.0], r: 0.62 }],
      water: { count: 72, box: [3.0, 6.9, 5.8, 8.4], source: [4.4, 9.6] },
      triggers: [{ id: "lotus", kind: "water", x: 7.9, y: 5.3, r: 1.3, count: 18, lotus: true, system: "water" }],
      slow: [{ x: 0.6, y: -3.0, r: 2.3, scale: 0.3 }],
      inside: { x: 0.6, y: -3.2, r: 3.5 },
      goal: { x: 0.6, y: -6.2, r: 1.1 },
      reveal: [S(arc(0.6, -3.2, 5.0, 0, 360), { deco: true, closed: true, h: 0.05, depth: 0.2, mat: "alu", z: 0, layer: 2 }),
        S(arc(0.6, -3.2, 5.8, 0, 360), { deco: true, closed: true, h: 0.04, depth: 0.2, mat: "alu", z: -0.6, layer: 3 })]
    })
  ];

  // ---- collision segments & grid -----------------------------------------
  function strokeSegments(st, pts) {
    const segs = [];
    if (pts.length === 1) {
      segs.push({ ax: pts[0][0], ay: pts[0][1], bx: pts[0][0], by: pts[0][1], h: st.h, st });
      return segs;
    }
    const n = st.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], h: st.h, st });
    }
    return segs;
  }

  const CELL = 1.2;
  function cellKey(ix, iy) { return (ix + 64) * 256 + (iy + 64); }
  function makeGrid(segs) {
    const map = new Map();
    for (const s of segs) {
      const pad = s.h + 0.05;
      const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL), x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / CELL);
      const y0 = Math.floor((Math.min(s.ay, s.by) - pad) / CELL), y1 = Math.floor((Math.max(s.ay, s.by) + pad) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
        const k = cellKey(ix, iy);
        let arr = map.get(k);
        if (!arr) map.set(k, (arr = []));
        arr.push(s);
      }
    }
    return map;
  }

  function closest(s, px, py, out) {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 1e-9 ? ((px - s.ax) * dx + (py - s.ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out.x = s.ax + dx * t;
    out.y = s.ay + dy * t;
    return out;
  }

  // ---- simulation -----------------------------------------------------------
  function createSim(levelIndex, opts) {
    opts = opts || {};
    const L = LEVELS[levelIndex]();
    const G = opts.gravity || 20;
    const REST = 0.14;
    const ROLL = 0.32;
    L.zField = L.zField || (() => 0);
    L.strokes.forEach((s, i) => { s.index = i; if (!s.id) s.id = "s" + i; });

    const staticSegs = [];
    const dynStrokes = [];
    for (const st of L.strokes) {
      if (st.deco) continue;
      if (st.dyn) {
        const d = st.dyn;
        d.a0 = d.a0 || 0; d.a1 = d.a1 || 0;
        d.s0 = d.s0 == null ? 1 : d.s0; d.s1 = d.s1 == null ? 1 : d.s1;
        d.t = 0; d.started = -1; d.solid = d.solid || "always";
        dynStrokes.push(st);
      } else {
        for (const sg of strokeSegments(st, st.pts)) staticSegs.push(sg);
      }
    }
    const grid = makeGrid(staticSegs);

    const buds = (L.buds || []).map((b) => Object.assign({ open: false, t: 0, openedAt: -1 }, b));
    const triggers = (L.triggers || []).map((t) => Object.assign({ fired: false, firedAt: -1, fill: 0 }, t));
    const portals = (L.portals || []).map((p) => Object.assign({ cool: false, flash: 0 }, p));
    const slow = L.slow || [];

    const ball = {
      x: L.ball[0], y: L.ball[1], vx: 0, vy: 0,
      contact: false, cnx: 0, cny: 1, buoy: 0, drag: 0, wet: 0,
      spin: 0, frozen: false, visible: true, inSlow: 0, inside: false
    };

    const sim = {
      L, levelIndex, ball, buds, triggers, portals, slow, staticSegs, dynStrokes,
      time: 0, simScale: 1, state: "play",
      fallT: 0, goalT: 0, stableT: 0,
      checkpoint: { x: ball.x, y: ball.y, theta: opts.startTheta || 0 },
      events: [], route: [[ball.x, ball.y]], routeLen: 0, activated: new Set(),
      water: null
    };

    // Dynamic colliders are rebuilt each step from their current transform.
    let dynSegs = [];
    function dynTransform(st) {
      const d = st.dyn;
      const e = easeInOut(clamp(d.t, 0, 1));
      const a = lerp(d.a0, d.a1, e) * D2R, s = lerp(d.s0, d.s1, e);
      const c = Math.cos(a), sn = Math.sin(a);
      return { a, s, c, sn, px: d.pivot[0], py: d.pivot[1], e };
    }
    function rebuildDyn() {
      dynSegs = [];
      for (const st of dynStrokes) {
        const d = st.dyn;
        const T = dynTransform(st);
        if (d.solid === "grown" && T.s < 0.62) continue;
        const pts = st.pts.map((p) => {
          const rx = (p[0] - T.px) * T.s, ry = (p[1] - T.py) * T.s;
          return [T.px + rx * T.c - ry * T.sn, T.py + rx * T.sn + ry * T.c];
        });
        for (const sg of strokeSegments(st, pts)) dynSegs.push(sg);
      }
      for (const b of buds) {
        if (!b.released) dynSegs.push({ ax: b.x, ay: b.y, bx: b.x, by: b.y, h: b.r, st: null, bud: b });
      }
    }
    sim.dynTransform = dynTransform;
    rebuildDyn();

    let stamp = 1;
    function forEachSeg(x, y, rad, fn) {
      stamp++;
      const x0 = Math.floor((x - rad) / CELL), x1 = Math.floor((x + rad) / CELL);
      const y0 = Math.floor((y - rad) / CELL), y1 = Math.floor((y + rad) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
        const arr = grid.get(cellKey(ix, iy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i];
          if (s._q === stamp) continue;
          s._q = stamp;
          fn(s);
        }
      }
      for (let i = 0; i < dynSegs.length; i++) fn(dynSegs[i]);
    }
    sim.forEachSeg = forEachSeg;

    const tmp = { x: 0, y: 0 };
    let frameImpact = 0, impactX = 0, impactY = 0;

    function resolveBall(th, w) {
      const c = Math.cos(th), s = Math.sin(th);
      let touched = false;
      for (let iter = 0; iter < 2; iter++) {
        forEachSeg(ball.x, ball.y, BALL_R + 0.6, (sg) => {
          closest(sg, ball.x, ball.y, tmp);
          let dx = ball.x - tmp.x, dy = ball.y - tmp.y;
          const d = Math.hypot(dx, dy);
          const min = BALL_R + sg.h;
          if (d >= min) return;
          if (sg.bud) { touchBud(sg.bud); }
          let nx, ny;
          if (d > 1e-6) { nx = dx / d; ny = dy / d; } else { nx = 0; ny = 1; }
          const pen = min - d;
          ball.x += nx * pen; ball.y += ny * pen;
          const nsx = c * nx - s * ny, nsy = s * nx + c * ny;
          const cpx = tmp.x + nx * sg.h, cpy = tmp.y + ny * sg.h;
          const csx = c * cpx - s * cpy, csy = s * cpx + c * cpy;
          // surfaces carry the ball, but a fast turn never catapults it
          let ux = -w * csy, uy = w * csx;
          const um = Math.hypot(ux, uy);
          if (um > 5.5) { ux *= 5.5 / um; uy *= 5.5 / um; }
          let rx = ball.vx - ux, ry = ball.vy - uy;
          const vn = rx * nsx + ry * nsy;
          if (vn < 0) {
            const e = -vn > 1.8 ? REST : 0;
            rx -= (1 + e) * vn * nsx; ry -= (1 + e) * vn * nsy;
            if (-vn > frameImpact) { frameImpact = -vn; impactX = cpx; impactY = cpy; }
          }
          ball.vx = rx + ux; ball.vy = ry + uy;
          touched = true;
          ball.cnx = nsx; ball.cny = nsy;
          if (sg.st) sim.lastTouched = sg.st;
        });
      }
      return touched;
    }

    function touchBud(b) {
      if (b.open) return;
      b.open = true; b.openedAt = sim.time;
      sim.activated.add(b.id);
      if (b.system) sim.activated.add("sys:" + b.system);
      sim.events.push({ type: "bloom", id: b.id, x: b.x, y: b.y });
      fire(b.id);
    }
    function fire(id) {
      for (const st of dynStrokes) {
        if (st.dyn.trigger === id && st.dyn.started < 0) st.dyn.started = sim.time + (st.dyn.delay || 0);
      }
    }
    sim.fire = fire;

    function stepBall(dt, thA, thB) {
      const w = (thB - thA) / dt;
      const speed = Math.hypot(ball.vx, ball.vy);
      const sweep = Math.abs(w) * 11 * dt;
      const n = clamp(Math.ceil(Math.max(speed * dt, sweep) / 0.14), 1, 40);
      const ds = dt / n;
      let touchedAny = false;
      for (let k = 0; k < n; k++) {
        const th0 = thA + ((thB - thA) * k) / n, th1 = thA + ((thB - thA) * (k + 1)) / n;
        let gx = 0, gy = -G;
        if (ball.contact) {
          const gn = gx * ball.cnx + gy * ball.cny;
          const tx = gx - gn * ball.cnx, ty = gy - gn * ball.cny;
          gx -= (tx * 2) / 7; gy -= (ty * 2) / 7;
          // rolling resistance on the tangential component (relative to screen)
          const vt = ball.vx * -ball.cny + ball.vy * ball.cnx;
          const dec = vt * Math.min(1, ROLL * ds);
          ball.vx -= -ball.cny * dec; ball.vy -= ball.cnx * dec;
        }
        gy += ball.buoy;
        ball.vx += gx * ds; ball.vy += gy * ds;
        if (ball.drag > 0) { const f = Math.exp(-ball.drag * ds); ball.vx *= f; ball.vy *= f; }
        const sp = Math.hypot(ball.vx, ball.vy);
        if (sp > 24) { ball.vx *= 24 / sp; ball.vy *= 24 / sp; }
        let c = Math.cos(th0), s = Math.sin(th0);
        let sx = c * ball.x - s * ball.y, sy = s * ball.x + c * ball.y;
        sx += ball.vx * ds; sy += ball.vy * ds;
        c = Math.cos(th1); s = Math.sin(th1);
        ball.x = c * sx + s * sy; ball.y = -s * sx + c * sy;
        ball.contact = resolveBall(th1, w);
        touchedAny = touchedAny || ball.contact;
      }
      return touchedAny;
    }

    // ---- water: position-based double-density relaxation ------------------
    if (L.water) {
      const N = opts.waterCount || L.water.count;
      const W = {
        n: N, x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N),
        psx: new Float32Array(N), psy: new Float32Array(N), alive: new Uint8Array(N), respawnQ: 0, energy: 0
      };
      const [x0, y0, x1, y1] = L.water.box;
      const cols = Math.max(1, Math.round(Math.sqrt((N * (x1 - x0)) / (y1 - y0))));
      for (let i = 0; i < N; i++) {
        const cx = i % cols, cy = Math.floor(i / cols);
        W.x[i] = x0 + ((cx + 0.5) / cols) * (x1 - x0) + (Math.random() - 0.5) * 0.05;
        W.y[i] = y0 + cy * 0.3 + 0.15;
        W.alive[i] = 1;
      }
      sim.water = W;
    }
    const WH = 0.72, WK = 34, WKN = 80, WRHO = 3.0, PR = 0.16;
    const wgrid = new Map();
    function stepWater(dt, thA, thB) {
      const W = sim.water;
      const N = W.n;
      // Water lives in the sculpture's co-rotating frame: it flows toward the
      // new down when tilted instead of being flung by the container's sweep.
      const glx = -Math.sin(thB) * G, gly = -Math.cos(thB) * G;
      void thA;
      for (let i = 0; i < N; i++) {
        if (!W.alive[i]) continue;
        W.psx[i] = W.x[i]; W.psy[i] = W.y[i];
        W.vx[i] += glx * dt; W.vy[i] += gly * dt;
        W.x[i] += W.vx[i] * dt; W.y[i] += W.vy[i] * dt;
      }
      // neighbor grid (local frame)
      wgrid.clear();
      for (let i = 0; i < N; i++) {
        if (!W.alive[i]) continue;
        const k = cellKey(Math.floor(W.x[i] / WH), Math.floor(W.y[i] / WH));
        let a = wgrid.get(k);
        if (!a) wgrid.set(k, (a = []));
        a.push(i);
      }
      const dt2 = dt * dt;
      for (let i = 0; i < N; i++) {
        if (!W.alive[i]) continue;
        const ix = Math.floor(W.x[i] / WH), iy = Math.floor(W.y[i] / WH);
        let rho = 0, rhoN = 0;
        const nb = [];
        for (let gx = ix - 1; gx <= ix + 1; gx++) for (let gy = iy - 1; gy <= iy + 1; gy++) {
          const a = wgrid.get(cellKey(gx, gy));
          if (!a) continue;
          for (const j of a) {
            if (j === i) continue;
            const dx = W.x[j] - W.x[i], dy = W.y[j] - W.y[i];
            const r2 = dx * dx + dy * dy;
            if (r2 >= WH * WH || r2 < 1e-12) continue;
            const r = Math.sqrt(r2), q = 1 - r / WH;
            rho += q * q; rhoN += q * q * q;
            nb.push(j, dx / r, dy / r, q);
          }
        }
        const P = WK * (rho - WRHO), PN = WKN * rhoN;
        let dxi = 0, dyi = 0;
        for (let m = 0; m < nb.length; m += 4) {
          const j = nb[m], ux = nb[m + 1], uy = nb[m + 2], q = nb[m + 3];
          const D = dt2 * (P * q + PN * q * q) * 0.5;
          W.x[j] += ux * D; W.y[j] += uy * D;
          dxi -= ux * D; dyi -= uy * D;
        }
        W.x[i] += dxi; W.y[i] += dyi;
      }
      // collisions with architecture and the ball
      let buoyN = 0;
      for (let i = 0; i < N; i++) {
        if (!W.alive[i]) continue;
        forEachSeg(W.x[i], W.y[i], PR + 0.5, (sg) => {
          closest(sg, W.x[i], W.y[i], tmp);
          const dx = W.x[i] - tmp.x, dy = W.y[i] - tmp.y;
          const d = Math.hypot(dx, dy), min = sg.h + PR;
          if (d >= min) return;
          const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1;
          W.x[i] += nx * (min - d); W.y[i] += ny * (min - d);
        });
        if (ball.visible && !ball.frozen) {
          const dx = W.x[i] - ball.x, dy = W.y[i] - ball.y;
          const d = Math.hypot(dx, dy), min = BALL_R + PR;
          if (d < min + 0.25) buoyN++;
          if (d < min && d > 1e-6) {
            W.x[i] += (dx / d) * (min - d) * 0.85; W.y[i] += (dy / d) * (min - d) * 0.85;
            ball.x -= (dx / d) * (min - d) * 0.04; ball.y -= (dy / d) * (min - d) * 0.04;
          }
        }
      }
      let energy = 0;
      const bounds2 = (L.bounds + 1) * (L.bounds + 1);
      for (let i = 0; i < N; i++) {
        if (!W.alive[i]) continue;
        let vx = (W.x[i] - W.psx[i]) / dt, vy = (W.y[i] - W.psy[i]) / dt;
        const sp = Math.hypot(vx, vy);
        if (sp > 16) { vx *= 16 / sp; vy *= 16 / sp; }
        W.vx[i] = vx * 0.998; W.vy[i] = vy * 0.998;
        energy += sp;
        const sx = W.x[i], sy = W.y[i];
        if (sx * sx + sy * sy > bounds2) { W.alive[i] = 0; W.respawnQ++; }
      }
      W.energy = energy / N;
      // lost water drips back from the spout so the level can never run dry
      if (W.respawnQ > 0 && L.water.source) {
        W.dripT = (W.dripT || 0) + dt;
        if (W.dripT > 0.12) {
          W.dripT = 0;
          for (let i = 0; i < N; i++) if (!W.alive[i]) {
            W.alive[i] = 1; W.respawnQ--;
            W.x[i] = L.water.source[0] + (Math.random() - 0.5) * 0.1; W.y[i] = L.water.source[1];
            W.vx[i] = 0; W.vy[i] = 0;
            break;
          }
        }
      }
      ball.buoy = Math.min(buoyN, 14) * 2.0;
      ball.drag = buoyN * 0.22;
      ball.wet = lerp(ball.wet, buoyN > 2 ? 1 : 0, 0.1);
    }

    // ---- the frame step ---------------------------------------------------------
    sim.step = function (rawDt, thA, thB) {
      sim.events.length = 0;
      frameImpact = 0;
      // slow zones scale simulation time (not the player's hand)
      let slowTarget = 1;
      for (const z of slow) {
        const d = Math.hypot(ball.x - z.x, ball.y - z.y);
        if (d < z.r && ball.visible && !ball.frozen) slowTarget = Math.min(slowTarget, z.scale);
      }
      sim.simScale = lerp(sim.simScale, slowTarget, 1 - Math.exp(-rawDt * (slowTarget < sim.simScale ? 9 : 3)));
      ball.inSlow = 1 - sim.simScale;
      const dt = rawDt * sim.simScale;
      sim.time += dt;

      // architecture animation
      let moving = false;
      for (const st of dynStrokes) {
        const d = st.dyn;
        if (d.started >= 0 && sim.time >= d.started && d.t < 1) {
          if (d.t === 0) sim.events.push({ type: "unfold", id: st.id });
          d.t = Math.min(1, d.t + dt / d.dur);
          moving = true;
        }
      }
      for (const b of buds) {
        if (b.open && b.t < 1) b.t = Math.min(1, b.t + dt / 0.9);
        if (b.open && !b.released && sim.time - b.openedAt >= (b.hold || 0)) b.released = true;
      }
      if (moving || buds.length) rebuildDyn();

      if (sim.water) {
        const n = 2;
        for (let k = 0; k < n; k++) stepWater(dt / n, thA + ((thB - thA) * k) / n, thA + ((thB - thA) * (k + 1)) / n);
        for (const t of triggers) {
          if (t.kind !== "water") continue;
          let cnt = 0;
          const W = sim.water;
          for (let i = 0; i < W.n; i++) {
            if (!W.alive[i]) continue;
            const dx = W.x[i] - t.x, dy = W.y[i] - t.y;
            if (dx * dx + dy * dy < t.r * t.r) cnt++;
          }
          t.fill = lerp(t.fill, Math.min(1, cnt / t.count), 0.08);
          if (!t.fired && cnt >= t.count) fireTrigger(t);
        }
      }

      if (sim.state === "play") {
        if (!ball.frozen) {
          const touched = stepBall(Math.max(dt, 1e-5), thA, thB);
          if (frameImpact > 1.2) sim.events.push({ type: "impact", v: frameImpact, x: impactX, y: impactY });
          ball.touching = touched;
          const sp = Math.hypot(ball.vx, ball.vy);
          // spin for the visual (rolling speed / radius)
          const vt = ball.vx * -ball.cny + ball.vy * ball.cnx;
          ball.spin += (touched ? -vt / BALL_R : 0) * dt;
          // portals: a circular opening that reveals another part of the object
          for (const p of portals) {
            const da = Math.hypot(ball.x - p.a[0], ball.y - p.a[1]);
            const db = Math.hypot(ball.x - p.b[0], ball.y - p.b[1]);
            if (p.cool) { if (da > p.r + BALL_R + 0.4 && db > p.r + BALL_R + 0.4) p.cool = false; continue; }
            if (da < p.r) {
              const fx = ball.x, fy = ball.y;
              ball.x = p.b[0] + (ball.x - p.a[0]); ball.y = p.b[1] + (ball.y - p.a[1]);
              p.cool = true; p.flash = 1;
              sim.activated.add("portal");
              sim.events.push({ type: "portal", fx, fy, x: ball.x, y: ball.y });
              sim.route.push(null);
            }
          }
          for (const t of triggers) {
            if (t.kind === "zone" && !t.fired && Math.hypot(ball.x - t.x, ball.y - t.y) < t.r + BALL_R) fireTrigger(t);
          }
          // route memory (used for the light that traces the solution)
          const last = sim.route[sim.route.length - 1];
          if (!last || Math.hypot(ball.x - last[0], ball.y - last[1]) > 0.2) {
            if (last) sim.routeLen += Math.hypot(ball.x - last[0], ball.y - last[1]);
            if (sim.route.length < 3000) sim.route.push([ball.x, ball.y]);
          }
          // inside the sculpture
          if (L.inside) {
            const was = ball.inside;
            ball.inside = Math.hypot(ball.x - L.inside.x, ball.y - L.inside.y) < L.inside.r;
            if (ball.inside && !was) { sim.events.push({ type: "enter" }); sim.activated.add("inside"); }
          }
          // invisible checkpoints: remember calm, supported moments
          const calm = touched && sp < 0.3 && Math.abs(thB - thA) < 0.002 * Math.max(1, rawDt * 60) && sim.simScale > 0.95;
          sim.stableT = calm ? sim.stableT + rawDt : 0;
          if (sim.stableT > 0.7) {
            const cp = sim.checkpoint;
            if (Math.hypot(cp.x - ball.x, cp.y - ball.y) > 0.8 || Math.abs(cp.theta - thB) > 0.05) {
              sim.checkpoint = { x: ball.x, y: ball.y, theta: thB };
              sim.events.push({ type: "checkpoint" });
            }
          }
          // goal
          const g = L.goal;
          if (Math.hypot(ball.x - g.x, ball.y - g.y) < g.r && sp < 1.4) {
            sim.goalT += rawDt;
            if (sim.goalT > 0.45) { sim.state = "won"; sim.events.push({ type: "goal" }); }
          } else sim.goalT = 0;
          // falling off the sculpture
          const c = Math.cos(thB), s = Math.sin(thB);
          const sx = c * ball.x - s * ball.y, sy = s * ball.x + c * ball.y;
          if (sx * sx + sy * sy > L.bounds * L.bounds) {
            sim.state = "falling"; sim.fallT = 0;
            ball.fsx = sx; ball.fsy = sy;
            sim.events.push({ type: "fall" });
          }
        }
      } else if (sim.state === "falling") {
        // no collisions: let it fall through space, then quietly come back
        ball.vy -= G * rawDt;
        ball.fsx += ball.vx * rawDt; ball.fsy += ball.vy * rawDt;
        const c = Math.cos(thB), s = Math.sin(thB);
        ball.x = c * ball.fsx + s * ball.fsy; ball.y = -s * ball.fsx + c * ball.fsy;
        sim.fallT += rawDt;
        if (sim.fallT > 1.25) {
          sim.state = "play";
          ball.x = sim.checkpoint.x; ball.y = sim.checkpoint.y;
          ball.vx = 0; ball.vy = 0; ball.frozen = true; ball.contact = false;
          sim.route.push(null);
          sim.events.push({ type: "respawn", theta: sim.checkpoint.theta });
        }
      } else if (sim.state === "won") {
        // ease into the nest and rest
        const g = L.goal;
        const k = 1 - Math.exp(-rawDt * 2.5);
        const tx = g.gx != null ? g.gx : ball.x, ty = g.gy != null ? g.gy : ball.y;
        ball.x = lerp(ball.x, tx, k); ball.y = lerp(ball.y, ty, k);
        ball.vx *= 0.9; ball.vy *= 0.9;
      }
      return sim.events;
    };

    function fireTrigger(t) {
      t.fired = true; t.firedAt = sim.time;
      sim.activated.add(t.id);
      if (t.system) sim.activated.add("sys:" + t.system);
      sim.events.push({ type: "trigger", id: t.id, x: t.x, y: t.y, kind: t.kind });
      fire(t.id);
    }

    sim.release = function () { ball.frozen = false; sim.stableT = 0; };
    sim.resetToCheckpoint = function () {
      if (sim.state !== "play") return false;
      sim.state = "falling"; sim.fallT = 1.25;
      ball.fsx = ball.x; ball.fsy = ball.y;
      return true;
    };
    sim.ballZ = function () { return L.zField(ball.x, ball.y); };
    return sim;
  }

  return { LEVELS, createSim, arc, soften, S, BALL_R, D2R, clamp, lerp, smooth, easeInOut, strokeSegments };
})();

window.plethoraBit = {
  meta: {
    title: "Rotate the World",
    runtime: "plethora-bit@2",
    tags: ["physics", "puzzle", "art", "sculpture"],
    permissions: ["audio", "haptics"]
  },

  async init(ctx) {
    const { LEVELS, createSim, BALL_R, clamp, lerp, easeInOut } = RTW;
    const TAU = Math.PI * 2, STEP = Math.PI / 4;
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    const knob = (id, d) => {
      try { const v = ctx.tune && ctx.tune.get ? ctx.tune.get(id) : undefined; return v == null ? d : v; } catch (e) { return d; }
    };
    const T = {
      gravity: () => knob("gravity", 20),
      inertia: () => knob("rotation_inertia", 0.22),
      snap: () => knob("snap_strength", 9),
      accent: () => knob("accent_color", "#ffab5e"),
      glow: () => knob("ball_glow", 0.75),
      water: () => knob("water_amount", 1),
      volume: () => knob("sound_volume", 0.8)
    };

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    const hud = ctx.createRoot({
      layer: "overlay", input: "passthrough",
      style: "font-family: Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif; color:#3a3733; user-select:none; -webkit-user-select:none;"
    });
    const el = (tag, css, parent) => { const e = document.createElement(tag); e.style.cssText = css; (parent || hud).appendChild(e); return e; };
    const veil = el("div", "position:absolute; inset:0; background:#ece8e1; opacity:1; transition:none; pointer-events:none;");
    const label = el("div", "position:absolute; left:22px; font-size:10px; letter-spacing:0.28em; font-weight:500; opacity:0; transition:opacity 1.2s ease; pointer-events:none; white-space:nowrap;");
    const hint = el("div", "position:absolute; left:0; right:0; text-align:center; font-size:10px; letter-spacing:0.42em; font-weight:500; opacity:0; transition:opacity 1.6s ease; pointer-events:none;");
    const endBar = el("div", "position:absolute; left:0; right:0; display:flex; justify-content:center; gap:44px; opacity:0; transition:opacity 1.4s ease; pointer-events:none;");
    const btnCss = "background:none; border:none; padding:14px 10px; font:inherit; font-size:10px; letter-spacing:0.42em; font-weight:500; color:inherit; cursor:pointer; -webkit-tap-highlight-color:transparent;";
    const againBtn = el("button", btnCss, endBar); againBtn.textContent = "AGAIN";
    const nextBtn = el("button", btnCss, endBar); nextBtn.textContent = "ONWARD";
    // the first-level gesture glyph: a quiet arc, only if the player hesitates
    const glyph = el("div", "position:absolute; left:50%; width:132px; height:132px; margin-left:-66px; opacity:0; transition:opacity 1.2s ease; pointer-events:none;");
    glyph.innerHTML = '<svg viewBox="-66 -66 132 132" width="132" height="132"><path d="M -48 18 A 52 52 0 0 0 48 18" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-dasharray="2 5"/><circle r="3.2" fill="currentColor"><animateMotion dur="2.6s" repeatCount="indefinite" path="M -48 18 A 52 52 0 0 0 48 18" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/></circle></svg>';

    ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }).catch(() => {});

    // ---- three ----------------------------------------------------------------
    const THREE = await ctx.importModule("three", "0.164.1");
    if (disposed) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(ctx.dpr || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 400);

    // soft studio environment for reflections on metal, glaze and glass
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: 0x8a847d, side: THREE.BackSide })));
    const softbox = (x, y, z, w, h, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.96) }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
    };
    softbox(-6, 12, 8, 14, 6, 5); softbox(12, 2, 6, 5, 12, 2.2); softbox(0, -10, 10, 20, 4, 0.8);
    const envTex = pmrem.fromScene(envScene, 0.035).texture;
    scene.environment = envTex;

    const hemi = new THREE.HemisphereLight(0xfff8ef, 0x8f877d, 0.9);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
    key.position.set(-9, 14, 26);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 5; sc.far = 70;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03; key.shadow.radius = 6;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe6eef6, 0.45);
    fill.position.set(14, -4, 12);
    scene.add(fill);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.ShadowMaterial({ opacity: 0.16 }));
    catcher.position.z = -5.2;
    catcher.receiveShadow = true;
    scene.add(catcher);

    // procedural textures as raw pixels (no extra canvases)
    const hex3 = (h) => { const c = new THREE.Color(h); c.convertLinearToSRGB(); return [c.r * 255, c.g * 255, c.b * 255]; };
    function pixelTex(w, h, fn) {
      const data = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, px = fn(x, y);
        data[o] = px[0]; data[o + 1] = px[1]; data[o + 2] = px[2]; data[o + 3] = px[3];
      }
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    }
    function gradientTex(top, bottom, glow) {
      const T0 = hex3(top), B0 = hex3(bottom), G0 = hex3(glow);
      return pixelTex(2, 256, (x, y) => {
        const v = 1 - y / 255; // DataTexture rows start at the bottom
        const mix = (A, B, t) => A.map((a, i) => a + (B[i] - a) * t);
        const c = v < 0.55 ? mix(T0, G0, v / 0.55) : mix(G0, B0, (v - 0.55) / 0.45);
        return [c[0], c[1], c[2], 255];
      });
    }
    const haloTex = pixelTex(128, 128, (x, y) => {
      const r = Math.hypot(x - 63.5, y - 63.5) / 64;
      const a = r >= 1 ? 0 : r < 0.18 ? 1 - (r / 0.18) * 0.45 : r < 0.45 ? 0.55 - ((r - 0.18) / 0.27) * 0.43 : 0.12 * (1 - (r - 0.45) / 0.55);
      return [255, 255, 255, Math.round(a * 255)];
    });
    const ringTex = pixelTex(128, 128, (x, y) => {
      const r = Math.hypot(x - 63.5, y - 63.5);
      if (r > 63) return [255, 255, 255, 0];
      const d = Math.abs(((r - 8) % 7 + 7) % 7 - 3.5);
      const line = r > 6 ? Math.max(0, 1 - Math.abs(d - 3.5) / 0.9) : 0;
      const a = line * (0.25 + 0.5 * (r / 64));
      return [255, 255, 255, Math.round(a * 230)];
    });

    // ---- materials ------------------------------------------------------------
    let accent = new THREE.Color(T.accent());
    function makeMat(kind) {
      const P = THREE.MeshPhysicalMaterial;
      const base = { envMapIntensity: 0.7 };
      let m;
      switch (kind) {
        case "stone": m = new P({ ...base, color: 0xd6d0c6, roughness: 0.92, envMapIntensity: 0.35 }); break;
        case "charcoal": m = new P({ ...base, color: 0x2d2b29, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.18 }); break;
        case "alu": m = new P({ ...base, color: 0xc9ccd0, metalness: 1, roughness: 0.34, envMapIntensity: 1.0 }); break;
        case "glass": m = new P({ ...base, color: 0xe7eef0, roughness: 0.22, transparent: true, opacity: 0.42, clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false }); break;
        case "resin": m = new P({ ...base, color: 0xf5e2cf, roughness: 0.45, transparent: true, opacity: 0.9, sheen: 1, sheenColor: accent.clone().lerp(new THREE.Color(1, 1, 1), 0.5), sheenRoughness: 0.5 }); break;
        case "crystal": m = new P({ ...base, color: 0xf1f5f7, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.78, envMapIntensity: 1.3, iridescence: 0.4, iridescenceIOR: 1.25 }); break;
        default: m = new P({ ...base, color: 0xf3eee6, roughness: 0.46, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.25, sheenColor: 0xfff2e0 });
      }
      m.emissive = accent.clone();
      m.emissiveIntensity = 0;
      return m;
    }

    // ---- geometry: extruded strokes with rounded edges and varying depth -------
    function outlineLoops(pts, h, closed) {
      const n = pts.length;
      if (n === 1) {
        const loop = [];
        const k = Math.max(20, Math.min(96, Math.round(h * 18)));
        for (let i = 0; i < k; i++) { const a = (i / k) * TAU; loop.push({ x: pts[0][0] + Math.cos(a) * h, y: pts[0][1] + Math.sin(a) * h, mx: Math.cos(a), my: Math.sin(a), s: 0 }); }
        return [loop];
      }
      const mit = [];
      for (let i = 0; i < n; i++) {
        const segN = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
        let n1 = null, n2 = null;
        if (closed || i > 0) n1 = segN(pts[(i - 1 + n) % n], pts[i]);
        if (closed || i < n - 1) n2 = segN(pts[i], pts[(i + 1) % n]);
        if (!n1) n1 = n2; if (!n2) n2 = n1;
        let mx = n1[0] + n2[0], my = n1[1] + n2[1];
        const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
        const len = h / Math.max(0.4, mx * n1[0] + my * n1[1]);
        mit.push([mx, my, len]);
      }
      const side = (sgn, i) => ({ x: pts[i][0] + mit[i][0] * mit[i][2] * sgn, y: pts[i][1] + mit[i][1] * mit[i][2] * sgn, mx: mit[i][0] * sgn, my: mit[i][1] * sgn, s: i });
      if (closed) {
        const a = [], b = [];
        for (let i = 0; i < n; i++) { a.push(side(1, i)); b.push(side(-1, i)); }
        return [a, b];
      }
      const loop = [];
      const cap = (i, a0) => { const K = 9; for (let k = 1; k < K; k++) { const a = a0 - (k / K) * Math.PI; loop.push({ x: pts[i][0] + Math.cos(a) * h, y: pts[i][1] + Math.sin(a) * h, mx: Math.cos(a), my: Math.sin(a), s: i }); } };
      for (let i = 0; i < n; i++) loop.push(side(1, i));
      cap(n - 1, Math.atan2(mit[n - 1][1], mit[n - 1][0]));
      for (let i = n - 1; i >= 0; i--) loop.push(side(-1, i));
      cap(0, Math.atan2(-mit[0][1], -mit[0][0]));
      return [loop];
    }
    function strokeGeometry(pts, zs, h, depth, closed) {
      const loops = outlineLoops(pts, h, closed);
      const b = Math.min(0.13, h * 0.5, depth * 0.22);
      const prof = [];
      for (let k = 0; k <= 3; k++) { const a = (Math.PI / 2) * (1 - k / 3); prof.push([-b + b * Math.cos(a), depth / 2 - b + b * Math.sin(a), Math.cos(a), Math.sin(a)]); }
      for (let k = 0; k <= 3; k++) { const a = -(Math.PI / 2) * (k / 3); prof.push([-b + b * Math.cos(a), -depth / 2 + b + b * Math.sin(a), Math.cos(a), Math.sin(a)]); }
      const pos = [], nor = [], idx = [];
      const P = prof.length;
      for (const loop of loops) {
        const base = pos.length / 3, L = loop.length;
        for (const v of loop) {
          const z = zs[v.s];
          for (const [off, w, nc, nz] of prof) { pos.push(v.x + v.mx * off, v.y + v.my * off, z + w); nor.push(v.mx * nc, v.my * nc, nz); }
        }
        // orientation: make faces point along the outward normal
        const vx = (j, k) => base + j * P + k;
        const p = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
        const A = p(vx(0, 3)), B = p(vx(1 % L, 3)), C = p(vx(0, 4));
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const flip = cr[0] * loop[0].mx + cr[1] * loop[0].my < 0;
        for (let j = 0; j < L; j++) {
          const j2 = (j + 1) % L;
          for (let k = 0; k < P - 1; k++) {
            const a = vx(j, k), b2 = vx(j2, k), c = vx(j, k + 1), d = vx(j2, k + 1);
            if (!flip) idx.push(a, b2, c, b2, d, c); else idx.push(a, c, b2, b2, c, d);
          }
        }
      }
      // front and back faces
      const contour = loops[0].map((v) => new THREE.Vector2(v.x - v.mx * b, v.y - v.my * b));
      const holes = loops.slice(1).map((l) => l.map((v) => new THREE.Vector2(v.x - v.mx * b, v.y - v.my * b)));
      const all = loops.flat();
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const verts = contour.concat(...holes);
      for (const sgn of [1, -1]) {
        const base = pos.length / 3;
        verts.forEach((v, i) => { pos.push(v.x, v.y, zs[all[i].s] + (sgn * depth) / 2); nor.push(0, 0, sgn); });
        for (const t of tris) {
          const [a, b2, c] = t;
          const A = verts[a], B = verts[b2], C = verts[c];
          const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
          if ((area > 0) === (sgn > 0)) idx.push(base + a, base + b2, base + c); else idx.push(base + a, base + c, base + b2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    }

    // ---- audio: a quiet installation soundscape --------------------------------
    const A = { ac: null };
    function audioStart() {
      if (A.ac) { if (A.ac.state === "suspended") A.ac.resume().catch(() => {}); return; }
      if (!ctx.capabilities || ctx.capabilities.audio === false) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const ac = new AC();
        A.ac = ac;
        A.master = ac.createGain(); A.master.gain.value = 0;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
        A.master.connect(comp); comp.connect(ac.destination);
        A.master.gain.setTargetAtTime(T.volume(), ac.currentTime, 0.8);
        const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = nb.getChannelData(0);
        let br = 0;
        for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; br = br * 0.97 + w * 0.03; d[i] = w * 0.5 + br * 2.5; }
        A.noise = nb;
        const loopNoise = (type, f, q, g0) => {
          const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.7 + Math.random() * 0.3;
          const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
          const g = ac.createGain(); g.gain.value = g0;
          s.connect(fl); fl.connect(g); g.connect(A.master); s.start();
          return { s, fl, g };
        };
        A.roll = loopNoise("bandpass", 420, 0.9, 0);
        A.rot = loopNoise("lowpass", 200, 0.6, 0);
        A.water = loopNoise("bandpass", 1400, 2.4, 0);
        A.rotOsc = ac.createOscillator(); A.rotOsc.frequency.value = 46;
        A.rotOscG = ac.createGain(); A.rotOscG.gain.value = 0;
        A.rotOsc.connect(A.rotOscG); A.rotOscG.connect(A.master); A.rotOsc.start();
        // drone: sustained partials through a slowly breathing filter
        A.droneF = ac.createBiquadFilter(); A.droneF.type = "lowpass"; A.droneF.frequency.value = 700; A.droneF.Q.value = 0.4;
        A.droneG = ac.createGain(); A.droneG.gain.value = 0;
        A.droneF.connect(A.droneG); A.droneG.connect(A.master);
        A.drone = [1, 1.5, 2.003, 3.01].map((r, i) => {
          const o = ac.createOscillator(); o.type = i === 0 ? "sine" : "triangle";
          const g = ac.createGain(); g.gain.value = [0.5, 0.2, 0.12, 0.05][i];
          o.connect(g); g.connect(A.droneF); o.start();
          return { o, r };
        });
        const lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
        const lg = ac.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(A.droneF.frequency); lfo.start();
        setDrone(level ? level.root : 0, true);
      } catch (e) { A.ac = null; }
    }
    const hz = (semi) => 110 * Math.pow(2, semi / 12);
    function setDrone(root, now) {
      if (!A.ac) return;
      const t = A.ac.currentTime;
      for (const d of A.drone) d.o.frequency.setTargetAtTime(hz(root - 12) * d.r, t, now ? 0.01 : 2.5);
      A.droneG.gain.setTargetAtTime(0.05, t, 2.5);
    }
    function tone(freq, gain, attack, decay, type, when) {
      if (!A.ac) return;
      const t = A.ac.currentTime + (when || 0);
      const o = A.ac.createOscillator(); o.type = type || "sine"; o.frequency.value = freq;
      const g = A.ac.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      o.connect(g); g.connect(A.master); o.start(t); o.stop(t + attack + decay + 0.05);
      return o;
    }
    const sfx = {
      tick(v) { const s = clamp(v / 8, 0.05, 1); const f = 2200 + Math.random() * 500; tone(f, 0.05 * s, 0.001, 0.07); tone(f * 1.59, 0.025 * s, 0.001, 0.05); tone(820 + Math.random() * 80, 0.03 * s, 0.001, 0.035, "triangle"); },
      settle() { tone(1500, 0.012, 0.001, 0.04); tone(380, 0.018, 0.002, 0.06, "triangle"); },
      bell(f, g, dcy) { for (const [r, a] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) tone(f * r, g * a, 0.004, dcy / r); },
      open() { const r = hz(level.root + 24); sfx.bell(r, 0.05, 2.4); sfx.bell(r * 1.5, 0.03, 2.0); },
      bloom() { const r = level.root + 24; [0, 4, 7, 11, 14].forEach((s, i) => tone(hz(r + s), 0.03, 0.02, 0.9, "sine", i * 0.09)); },
      portal() {
        if (!A.ac) return;
        const t = A.ac.currentTime;
        const o = A.ac.createOscillator(); o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.5);
        const g = A.ac.createGain(); g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.7);
        sfx.bell(hz(level.root + 31), 0.02, 1.2);
      },
      fall() {
        if (!A.ac) return;
        const t = A.ac.currentTime;
        const o = A.ac.createOscillator(); o.frequency.setValueAtTime(hz(level.root + 19), t); o.frequency.exponentialRampToValueAtTime(hz(level.root + 7), t + 1.1);
        const g = A.ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 1.3);
      },
      resolve() { const r = level.root + 12; [0, 7, 14, 19, 24].forEach((s, i) => tone(hz(r + s), 0.035 - i * 0.004, 0.6 + i * 0.15, 3.6, "sine", i * 0.22)); },
      trace() { const r = level.root + 24; [0, 2, 4, 7, 9, 12].forEach((s, i) => tone(hz(r + s), 0.014, 0.01, 1.6, "sine", 0.4 * i)); }
    };
    function duck(to, tau) { if (A.ac) A.master.gain.setTargetAtTime(T.volume() * to, A.ac.currentTime, tau || 0.3); }
    ctx.onDestroy(() => { try { A.ac && A.ac.close(); } catch (e) {} A.ac = null; });

    const haptic = (k) => { try { if (ctx.capabilities && ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) {} };

    // ---- persistent pieces: ball, trail, water pass -----------------------------
    const worldRoot = new THREE.Group();   // whole-object yaw/tilt (finale, inertia)
    scene.add(worldRoot);
    const ballGroup = new THREE.Group();
    const ballShellMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.32, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false });
    const ballShell = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 36, 24), ballShellMat);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ballCore = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 0.36, 20, 14), coreMat);
    const glowMat = new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const innerGlow = new THREE.Sprite(glowMat); innerGlow.scale.setScalar(BALL_R * 1.9);
    const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
    const halo = new THREE.Sprite(haloMat); halo.scale.setScalar(BALL_R * 7);
    const ballLight = new THREE.PointLight(0xffffff, 6, 7, 2);
    ballLight.position.z = 0.7;
    ballGroup.add(ballCore, innerGlow, ballShell, halo, ballLight);
    const ghosts = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      m.scale.setScalar(BALL_R * 2.2); ghosts.push(m);
    }
    const ripples = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.userData.t = 1; ripples.push(m);
    }

    // route light: a ribbon that remembers where the ball has been
    const TRAIL_MAX = 3200;
    const trailPos = new Float32Array(TRAIL_MAX * 6 * 3), trailLen = new Float32Array(TRAIL_MAX * 6);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute("aLen", new THREE.BufferAttribute(trailLen, 1));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uHead: { value: 0 }, uBase: { value: 0.3 }, uProg: { value: -10 }, uRev: { value: 0 } },
      vertexShader: "attribute float aLen; varying float vLen; void main(){ vLen = aLen; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 uColor; uniform float uHead, uBase, uProg, uRev; varying float vLen; void main(){ float d = uHead - vLen; float play = uBase * (0.18 + 0.82 * exp(-d * 0.45)); float lit = step(vLen, uProg) * 0.55 + exp(-abs(uProg - vLen) * 1.6) * 1.6; float a = max(play, uRev * lit); gl_FragColor = vec4(uColor * a, a); }"
    });
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.frustumCulled = false;
    let trailSegs = 0, trailRouteIdx = 0, trailTotal = 0;

    // water: soft density splats into a half-res target, then a liquid threshold pass
    const waterRT = new THREE.WebGLRenderTarget(4, 4);
    const waterPtsMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: "uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 0.95 * uScale / -mv.z; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c,c) * 4.0; float d = exp(-r2 * 3.2); gl_FragColor = vec4(d, d, d, 1.0); }"
    });
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const waterQuadMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: { tDen: { value: waterRT.texture }, uTexel: { value: new THREE.Vector2(0.002, 0.002) }, uColor: { value: new THREE.Color(0.72, 0.82, 0.86) }, uGlow: { value: new THREE.Color(0, 0, 0) }, uOpacity: { value: 0.85 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tDen; uniform vec2 uTexel; uniform vec3 uColor; uniform vec3 uGlow; uniform float uOpacity; varying vec2 vUv;",
        "void main(){ float d = texture2D(tDen, vUv).r; float a = smoothstep(0.42, 0.62, d); if (a < 0.003) discard;",
        " float dx = texture2D(tDen, vUv + vec2(uTexel.x, 0.)).r - texture2D(tDen, vUv - vec2(uTexel.x, 0.)).r;",
        " float dy = texture2D(tDen, vUv + vec2(0., uTexel.y)).r - texture2D(tDen, vUv - vec2(0., uTexel.y)).r;",
        " vec3 n = normalize(vec3(-dx * 2.2, -dy * 2.2, 1.0));",
        " float spec = pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 28.0);",
        " float rim = 1.0 - smoothstep(0.62, 1.2, d);",
        " vec3 col = uColor * (0.82 + 0.18 * n.y) + vec3(1.0) * (spec * 0.9 + rim * 0.22) + uGlow;",
        " gl_FragColor = vec4(col, a * uOpacity * (0.5 + 0.4 * rim + 0.3 * spec));",
        " #include <colorspace_fragment>",
        "}"
      ].join("\n")
    });
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), waterQuadMat));

    // ---- level state ---------------------------------------------------------------
    let level = null, sim = null, levelIndex = 0, world = null, decoWorld = null;
    let meshes = [];        // { st, mesh, group, mat, mem, pulse, layer, dyn }
    let extras = [];        // disposable objects
    let buds3 = [], lotus3 = [], portals3 = [], slow3 = [], goal3 = null, shells3 = [], reveal3 = [];
    let waterPts = null;
    let flow = "intro", flowT = 0, finaleDone = false, played = false;
    let explode = 0, lightMode = "light";
    const ctl = { theta: 0, omega: 0, target: 0, dragging: false, lastAng: 0, lastX: 0, samples: [], lock: 0, settled: true, wn: 9, deco: 0, decoW: 0, yaw: 0 };
    const view = { dist: 60, fit: 10, camY: 0, center: new THREE.Vector2(0, 0), follow: 0, pull: 0, turn: 0 };
    let idleT = 0, hintShown = false, firstDragDone = false, attempt = 0;

    function disposeObj(o) {
      o.traverse((n) => {
        if (n.geometry && !n.userData.keepGeo) n.geometry.dispose();
        if (n.material && !n.userData.keepMat) { (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose()); }
      });
    }

    function buildLevel(i) {
      if (world) { worldRoot.remove(world); world.remove(ballGroup, trail); disposeObj(world); }
      if (decoWorld) { worldRoot.remove(decoWorld); disposeObj(decoWorld); }
      for (const g of ghosts) worldRoot.remove(g);
      levelIndex = i;
      accent = new THREE.Color(T.accent());
      sim = createSim(i, { gravity: T.gravity(), waterCount: undefined });
      if (sim.water && T.water() !== 1) { /* amount scales how much of the reservoir begins full */
        const W = sim.water; const keep = Math.round(W.n * clamp(T.water(), 0.5, 1.4));
        for (let k = keep; k < W.n; k++) W.alive[k] = 0;
      }
      level = sim.L;
      { let R = 0; for (const st of level.strokes.concat(level.reveal || [])) for (const p of st.pts) R = Math.max(R, Math.hypot(p[0], p[1]) + st.h); level.autoFit = R + 0.35; }
      meshes = []; extras = []; buds3 = []; lotus3 = []; portals3 = []; slow3 = []; shells3 = []; reveal3 = [];
      world = new THREE.Group(); decoWorld = new THREE.Group();
      worldRoot.add(decoWorld, world);
      const zf = level.zField;
      lightMode = level.dark ? "dark" : level.dusk ? "dusk" : "light";

      const addStroke = (st, parentOverride, isReveal) => {
        const pv = st.dyn ? st.dyn.pivot : [0, 0];
        const local = st.pts.map((p) => [p[0] - pv[0], p[1] - pv[1]]);
        const zs = st.pts.map((p) => zf(p[0], p[1]) + (st.z || 0));
        const geo = strokeGeometry(local, zs, st.h, st.depth, st.closed);
        const mat = makeMat(st.mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = st.mat !== "glass";
        mesh.receiveShadow = true;
        const group = new THREE.Group();
        group.position.set(pv[0], pv[1], 0);
        group.add(mesh);
        (parentOverride || (st.deco ? decoWorld : world)).add(group);
        let cx = 0, cy = 0; for (const p of st.pts) { cx += p[0]; cy += p[1]; } cx /= st.pts.length; cy /= st.pts.length;
        let rad = 0; for (const p of st.pts) rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy));
        const samples = [];
        for (let k = 0; k < st.pts.length; k += Math.max(1, Math.floor(st.pts.length / 24))) samples.push(st.pts[k]);
        samples.push(st.pts[st.pts.length - 1]);
        const rec = { st, mesh, group, mat, mem: 0, samples, pulse: 0, glow: 0, layer: st.layer || 0, cx, cy, rad: rad + st.h, reveal: !!isReveal };
        if (isReveal) { group.scale.setScalar(0.001); group.visible = false; }
        meshes.push(rec);
        if (st.shell) addShellCover(st, rec);
        return rec;
      };
      for (const st of level.strokes) addStroke(st);
      for (const st of level.reveal || []) reveal3.push(addStroke(st, null, true));

      // buds: closed architectural flowers that open when touched
      for (const b of sim.buds) {
        const g = new THREE.Group(); g.position.set(b.x, b.y, zf(b.x, b.y));
        const core = new THREE.Mesh(new THREE.SphereGeometry(b.r * 0.5, 24, 16), makeMat("resin"));
        core.material.opacity = 1; core.material.emissiveIntensity = 0.25;
        g.add(core);
        const petals = [];
        for (let k = 0; k < 6; k++) {
          const holder = new THREE.Group(); holder.rotation.z = (k / 6) * TAU;
          const pm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), makeMat(k % 2 ? "porcelain" : "resin"));
          pm.scale.set(b.r * 0.42, b.r * 0.95, b.r * 0.2);
          pm.position.y = b.r * 0.62;
          const hinge = new THREE.Group(); hinge.add(pm); holder.add(hinge);
          pm.castShadow = true;
          g.add(holder); petals.push(hinge);
        }
        world.add(g);
        buds3.push({ b, g, core, petals, glow: 0 });
      }
      // lotus: petals behind a basin that open as water gathers
      for (const t of sim.triggers) {
        if (t.kind === "water" && t.lotus) {
          const g = new THREE.Group(); g.position.set(t.x, t.y - 0.4, zf(t.x, t.y) - 1.25);
          const petals = [];
          for (let k = 0; k < 9; k++) {
            const holder = new THREE.Group(); holder.rotation.z = (k / 9) * TAU;
            const pm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), makeMat("resin"));
            pm.scale.set(0.34, 1.05, 0.08); pm.position.y = 0.95;
            const hinge = new THREE.Group(); hinge.add(pm); holder.add(hinge); g.add(holder); petals.push(hinge);
          }
          world.add(g); lotus3.push({ t, g, petals, open: 0 });
        } else if (t.kind === "zone") {
          const m = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 40), makeMat("alu"));
          m.position.set(t.x, t.y - 0.55, zf(t.x, t.y) + 1.25);
          world.add(m); lotus3.push({ t, g: m, petals: [], open: 0, plate: true });
        }
      }
      for (const p of sim.portals) {
        const pair = [];
        for (const [x, y] of [p.a, p.b]) {
          const g = new THREE.Group(); g.position.set(x, y, zf(x, y) - 0.6);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.14, 0.07, 14, 64), makeMat("alu"));
          const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r + 0.1, 48), new THREE.MeshBasicMaterial({ map: ringTex, color: accent.clone().multiplyScalar(0.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
          disc.position.z = -0.05;
          g.add(ring, disc); world.add(g); pair.push({ g, disc });
        }
        portals3.push({ p, pair });
      }
      for (const z of sim.slow) {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(z.r, 64), new THREE.MeshBasicMaterial({ map: ringTex, color: 0xd9e3e6, transparent: true, opacity: 0.22, depthWrite: false }));
        lens.position.set(z.x, z.y, zf(z.x, z.y) - 1.0);
        world.add(lens); slow3.push({ z, lens });
      }
      const g = level.goal;
      goal3 = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.55, g.r * 0.72), 0.035, 10, 72), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      goal3.position.set(g.x, g.y, zf(g.x, g.y) - 1.15);
      world.add(goal3);

      if (sim.water) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sim.water.n * 3), 3));
        waterPts = new THREE.Points(geo, waterPtsMat);
        waterPts.userData.keepMat = true;
        waterPts.frustumCulled = false;
        waterPts.layers.set(1);
        world.add(waterPts);
      } else waterPts = null;

      world.add(ballGroup, trail);
      ballGroup.userData.keepGeo = true;
      for (const g2 of ghosts) worldRoot.add(g2);
      for (const r of ripples) { if (!r.parent) world.add(r); else { r.parent.remove(r); world.add(r); } r.userData.t = 1; r.material.opacity = 0; }
      markKeep(ballGroup); markKeep(trail); ripples.forEach(markKeep);

      trailSegs = 0; trailRouteIdx = 0; trailTotal = 0; trailGeo.setDrawRange(0, 0);
      trailMat.uniforms.uColor.value.copy(accent);
      trailMat.uniforms.uRev.value = 0; trailMat.uniforms.uProg.value = -10;
      coreMat.color.copy(accent).lerp(new THREE.Color(1, 1, 1), 0.55);
      glowMat.color.copy(accent); haloMat.color.copy(accent); ballLight.color.copy(accent);

      applyLightMode();
      ctl.theta = ctl.target = ctl.deco = 0; ctl.omega = ctl.decoW = 0; ctl.lock = 0; ctl.dragging = false;
      sim.checkpoint.theta = 0;
      explode = 0.8; flow = "intro"; flowT = 0; finaleDone = false;
      view.pull = 0; view.turn = 0; view.follow = 0;
      idleT = 0; hintShown = false;
      label.textContent = String(i + 1).padStart(2, "0") + "   " + level.name;
      label.style.opacity = "0"; hint.style.opacity = "0"; glyph.style.opacity = "0";
      showEnd(false);
      layout();
      setDrone(level.root);
      try { ctx.platform.setProgress(i / LEVELS.length, { level: i + 1 }); } catch (e) {}
    }
    function markKeep(o) { o.traverse((n) => { n.userData.keepGeo = true; n.userData.keepMat = true; }); }

    function addShellCover(st, rec) {
      const L = level.inside;
      if (!L) return;
      const cover = new THREE.Mesh(new THREE.CircleGeometry(L.r + 0.55, 72), makeMat("porcelain"));
      cover.material.transparent = true; cover.material.opacity = 0.96;
      cover.material.bumpMap = ringTex; cover.material.bumpScale = 0.6;
      cover.position.set(L.x, L.y, st.depth / 2 + 0.03);
      cover.castShadow = true;
      world.add(cover);
      const back = new THREE.Mesh(new THREE.RingGeometry(L.r * 0.35, L.r * 0.36, 96), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      back.position.set(L.x, L.y, -1.5);
      world.add(back);
      if (!shells3.length) shells3.push({ cover, back, open: 0 });
      void rec;
    }

    function applyLightMode() {
      const m = lightMode;
      const bg = m === "dark" ? ["#0f0e0d", "#060606", "#0b0a0a"] : m === "dusk" ? ["#b9b2a8", "#8e877e", "#a8a097"] : ["#ebe6de", "#c9c2b7", "#dfd9cf"];
      if (scene.background && scene.background.dispose) scene.background.dispose();
      scene.background = gradientTex(bg[0], bg[1], bg[2]);
      veil.style.background = bg[2];
      const ink = m === "dark" ? "#b9b2a8" : m === "dusk" ? "#2c2a27" : "#3a3733";
      hud.style.color = ink;
      lightTarget.hemi = m === "dark" ? 0.0 : m === "dusk" ? 0.38 : 0.9;
      lightTarget.key = m === "dark" ? 0.0 : m === "dusk" ? 0.7 : 2.0;
      lightTarget.env = m === "dark" ? 0.0 : m === "dusk" ? 0.35 : 1;
      lightTarget.ball = (m === "dark" ? 22 : m === "dusk" ? 18 : 12) * (0.5 + T.glow());
      lightTarget.ballDist = m === "dark" ? 4.6 : m === "dusk" ? 7 : 6;
      catcher.visible = m !== "dark";
      catcher.material.opacity = m === "dusk" ? 0.2 : 0.24;
      fillTarget = m === "dark" ? 0 : m === "dusk" ? 0.22 : 0.45;
      waterQuadMat.uniforms.uColor.value.set(m === "light" ? 0x9fb8c2 : 0x6f8790);
      lightNow.hemi = lightTarget.hemi; lightNow.key = lightTarget.key; lightNow.env = lightTarget.env;
    }
    const lightTarget = { hemi: 0.9, key: 2.3, env: 1, ball: 6, ballDist: 6 };
    let fillTarget = 0.45;
    const lightNow = { hemi: 0.9, key: 2.3, env: 1 };

    // ---- layout ------------------------------------------------------------------
    function layout() {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      const fit = (level && level.autoFit) || 10;
      view.dist = Math.max((fit * 1.0) / (tan * camera.aspect), (fit * 1.12) / tan);
      camera.updateProjectionMatrix();
      const pr = renderer.getPixelRatio();
      waterRT.setSize(Math.max(2, Math.round(w * pr * 0.5)), Math.max(2, Math.round(h * pr * 0.5)));
      waterQuadMat.uniforms.uTexel.value.set(1 / Math.max(2, w * pr * 0.5), 1 / Math.max(2, h * pr * 0.5));
      waterPtsMat.uniforms.uScale.value = (h * pr * 0.5) / (2 * tan);
      const sa = ctx.safeArea || { top: 0, bottom: 0 };
      label.style.top = sa.top + 20 + "px";
      hint.style.top = sa.top + 44 + "px";
      endBar.style.bottom = sa.bottom + Math.round(h * 0.1) + "px";
      glyph.style.top = Math.round(h * 0.5 + Math.min(w, h) * 0.26) + "px";
      placeCamera(0);
    }
    function placeCamera(dt) {
      const p = view.pull;
      const d = view.dist * (1 + 0.26 * p);
      const fy = view.follow;
      camera.position.set(1.8 * p, 1.2 + 4.5 * p + fy * 0.4, d);
      camera.lookAt(0, -0.2 + fy, 0);
      camera.updateMatrixWorld();
      const c = new THREE.Vector3(0, 0, 0).project(camera);
      view.center.set((c.x * 0.5 + 0.5) * ctx.width, (-c.y * 0.5 + 0.5) * ctx.height);
      void dt;
    }

    // ---- input: turn the object --------------------------------------------------
    const input = ctx.input.track(canvas, { tapMaxDistance: 10 });
    const angOf = (x, y) => Math.atan2(-(y - view.center.y), x - view.center.x);
    const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

    function controls(dt) {
      const canTurn = (flow === "play" || flow === "intro") && ctl.lock <= 0 && sim.state !== "won";
      if (input.down && canTurn) {
        const x = input.x, y = input.y;
        const dist = Math.hypot(x - view.center.x, y - view.center.y);
        if (!ctl.dragging) {
          ctl.dragging = true; ctl.lastAng = angOf(x, y); ctl.lastX = x; ctl.samples = [];
          ctl.target = ctl.theta;
          audioStart();
          if (!played) { played = true; try { ctx.platform.start({ level: levelIndex + 1 }); } catch (e) {} }
        } else {
          const ang = angOf(x, y);
          const dA = wrapA(ang - ctl.lastAng);
          const dH = (-(x - ctl.lastX) / (Math.min(ctx.width, ctx.height) * 0.5)) * 1.3;
          const w = clamp((dist - 26) / 80, 0, 1);
          ctl.target += w * dA + (1 - w) * dH;
          ctl.lastAng = ang; ctl.lastX = x;
          if (Math.abs(dA) + Math.abs(dH) > 0.002) { idleT = 0; if (!firstDragDone) { firstDragDone = true; glyph.style.opacity = "0"; } }
        }
        ctl.samples.push([performance.now(), ctl.target]);
        while (ctl.samples.length > 12) ctl.samples.shift();
      } else if (ctl.dragging) {
        ctl.dragging = false;
        const now = performance.now();
        const old = ctl.samples.find((s) => now - s[0] < 110) || ctl.samples[0];
        let v = 0;
        if (old && now - old[0] > 8) v = (ctl.target - old[1]) / ((now - old[0]) / 1000);
        v = clamp(v, -7, 7);
        const projected = ctl.theta + v * T.inertia() * 0.42;
        const snapT = Math.round(projected / STEP) * STEP;
        ctl.target = snapT;
        ctl.wn = Math.abs(projected - snapT) < 0.26 ? T.snap() : T.snap() * 0.7;
        ctl.omega += v * T.inertia() * 0.5;
        ctl.settled = false;
        try { ctx.platform.interact({ type: "turn", level: levelIndex + 1 }); } catch (e) {}
      }
      // spring: tight while held (direct), softer while settling (inertia + snap)
      const wn = ctl.dragging ? 24 : ctl.wn;
      const sub = 3, h = dt / sub;
      for (let k = 0; k < sub; k++) {
        ctl.omega += (wn * wn * (ctl.target - ctl.theta) - 2 * wn * ctl.omega) * h;
        ctl.omega = clamp(ctl.omega, -4.2, 4.2);
        ctl.theta += ctl.omega * h;
      }
      if (!ctl.dragging && !ctl.settled && Math.abs(ctl.target - ctl.theta) < 0.004 && Math.abs(ctl.omega) < 0.05) {
        ctl.settled = true; sfx.settle(); haptic("light");
      }
      // heavy object: the decorative mass lags a little behind
      const dw = 13;
      ctl.decoW += (dw * dw * (ctl.theta - ctl.deco) - 2 * 0.8 * dw * ctl.decoW) * dt;
      ctl.deco += ctl.decoW * dt;
      ctl.yaw = lerp(ctl.yaw, clamp(-ctl.omega * 0.03, -0.09, 0.09), 1 - Math.exp(-dt * 5));

      // double tap: quietly return to the last calm moment
      if (input.doubleTap && flow === "play" && sim.state === "play") { if (sim.resetToCheckpoint()) haptic("light"); }
    }

    // ---- events from the simulation -----------------------------------------------
    let lastTick = 0, lastTouched = null;
    function ripple(x, y, z, size, strength) {
      const r = ripples.find((q) => q.userData.t >= 1) || ripples[0];
      r.position.set(x, y, z); r.userData.t = 0; r.userData.size = size; r.userData.str = strength;
      r.material.color.copy(accent);
    }
    function handleEvents(evs) {
      for (const e of evs) {
        switch (e.type) {
          case "impact": {
            const now = performance.now();
            if (now - lastTick > 45) { lastTick = now; sfx.tick(e.v); if (e.v > 3) haptic("light"); }
            if (e.v > 2.2) { flash = Math.max(flash, clamp(e.v / 9, 0.15, 0.8)); ripple(sim.ball.x, sim.ball.y, sim.ballZ(), 0.9, clamp(e.v / 8, 0.2, 1)); }
            break;
          }
          case "bloom": sfx.bloom(); haptic("medium"); break;
          case "trigger": sfx.bell(hz(level.root + 28), 0.03, 1.8); haptic("light"); break;
          case "unfold": sfx.open(); break;
          case "portal": sfx.portal(); haptic("medium"); flash = 1; ripple(e.x, e.y, level.zField(e.x, e.y), 1.4, 1); ripple(e.fx, e.fy, level.zField(e.fx, e.fy), 1.4, 1); break;
          case "enter": sfx.bell(hz(level.root + 19), 0.03, 2.4); break;
          case "fall": sfx.fall(); try { ctx.platform.interact({ type: "fall" }); } catch (x) {} break;
          case "respawn": {
            let t = e.theta; while (t - ctl.theta > Math.PI) t -= TAU; while (ctl.theta - t > Math.PI) t += TAU;
            ctl.target = t; ctl.wn = 6; ctl.lock = 0.9; ctl.dragging = false; ctl.settled = true;
            respawnT = 0;
            break;
          }
          case "goal": beginFinale(); break;
        }
      }
    }
    let flash = 0, respawnT = 1;

    // ---- the finale: stillness, then the object shows what you made ---------------
    function beginFinale() {
      flow = "finale"; flowT = 0;
      ctl.target = Math.round(ctl.theta / STEP) * STEP; ctl.wn = 5; ctl.dragging = false;
      const g = level.goal; g.gx = sim.ball.x; g.gy = sim.ball.y;
      duck(0.35, 0.4);
      hint.style.opacity = "0"; label.style.opacity = "0"; glyph.style.opacity = "0";
      haptic("success");
      try { ctx.platform.milestone("level_clear", { level: levelIndex + 1 }); } catch (e) {}
    }
    function showEnd(on) {
      endBar.style.opacity = on ? "1" : "0";
      endBar.style.pointerEvents = on ? "auto" : "none";
      nextBtn.textContent = levelIndex >= LEVELS.length - 1 ? "FROM THE BEGINNING" : "ONWARD";
    }
    ctx.input.activate(againBtn, () => { if (flow === "done") leave(levelIndex); });
    ctx.input.activate(nextBtn, () => { if (flow === "done") leave(levelIndex >= LEVELS.length - 1 ? 0 : levelIndex + 1); });
    let pendingLevel = -1;
    function leave(next) {
      audioStart();
      flow = "outro"; flowT = 0; pendingLevel = next;
      showEnd(false);
      attempt++;
      try { ctx.platform.start({ level: next + 1, attempt }); } catch (e) {}
    }

    // ---- per-frame update ------------------------------------------------------------
    const tmpV = new THREE.Vector3();
    let time = 0, trailHeadLen = 0, physAcc = 0;
    const FIXED = 1 / 60;
    function update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      time += dt;
      flowT += dt;
      ctl.lock -= dt;
      controls(dt);

      // fixed-step physics; the world angle is interpolated across the steps
      const thPrev = sim.lastTheta == null ? ctl.theta : sim.lastTheta;
      physAcc = Math.min(physAcc + dt, FIXED * 4);
      const n = Math.floor(physAcc / FIXED);
      for (let k = 0; k < n; k++) {
        const a = thPrev + ((ctl.theta - thPrev) * k) / n, b2 = thPrev + ((ctl.theta - thPrev) * (k + 1)) / n;
        handleEvents(sim.step(FIXED, a, b2));
        physAcc -= FIXED;
      }
      if (n > 0 || sim.lastTheta == null) sim.lastTheta = ctl.theta;
      if (sim.ball.frozen && ctl.lock <= 0 && sim.state === "play") sim.release();
      respawnT = Math.min(1, respawnT + dt / 0.8);

      // flow
      if (flow === "intro") {
        veil.style.opacity = String(clamp(1 - flowT / 0.9, 0, 1));
        explode = 0.8 * (1 - easeInOut(clamp(flowT / 1.6, 0, 1)));
        if (flowT > 0.5) label.style.opacity = "0.75";
        if (flowT > 1.6) { flow = "play"; flowT = 0; }
      } else if (flow === "play") {
        if (flowT > 3.2) label.style.opacity = "0";
        idleT += dt;
        if (levelIndex === 0 && !firstDragDone && flowT > 2.4 && !hintShown) { hintShown = true; hint.textContent = level.hint; hint.style.opacity = "0.7"; glyph.style.opacity = "0.55"; }
        if (levelIndex > 0 && idleT > 16 && !hintShown) { hintShown = true; hint.textContent = level.hint; hint.style.opacity = "0.6"; }
        if (hintShown && idleT < 0.1 && levelIndex > 0) hint.style.opacity = "0";
        if (levelIndex === 0 && firstDragDone && hint.style.opacity !== "0") hint.style.opacity = "0";
      } else if (flow === "finale") {
        const t = flowT;
        const pull = easeInOut(clamp((t - 1.0) / 3.4, 0, 1));
        view.pull = pull;
        explode = easeInOut(clamp((t - 2.2) / 2.2, 0, 1)) * (1 - 0.7 * easeInOut(clamp((t - 7.5) / 2.5, 0, 1)));
        view.turn = easeInOut(clamp((t - 2.6) / 7.2, 0, 1)) * TAU;
        if (t > 1.2 && trailMat.uniforms.uRev.value === 0) { trailMat.uniforms.uRev.value = 1; trailMat.uniforms.uProg.value = 0; sfx.trace(); }
        if (t > 1.2) trailMat.uniforms.uProg.value = Math.min(trailTotal + 2, (t - 1.2) * Math.max(4, trailTotal / 3.2));
        if (t > 0.9 && !finaleDone) { finaleDone = true; sfx.resolve(); }
        if (t > 3.6 && lightMode !== "light") { lightTarget.hemi = lightMode === "dark" ? 0.55 : 0.8; lightTarget.key = lightMode === "dark" ? 1.2 : 1.8; lightTarget.env = 0.7; }
        for (const r of reveal3) { const k = easeInOut(clamp((t - 3.4 - r.st.layer * 0.2) / 1.6, 0, 1)); r.group.visible = k > 0.002; r.group.scale.setScalar(Math.max(0.001, k)); r.glow = k * 0.6; }
        if (t > 6.2) {
          flow = "done"; flowT = 0; showEnd(true); duck(0.7, 1.2);
          if (levelIndex >= LEVELS.length - 1) {
            try { ctx.pulse.complete({ level: LEVELS.length, text: "Turned the whole object." }); } catch (e) {}
            try { ctx.platform.complete({ levels: LEVELS.length }); } catch (e) {}
            saveProgress(0, true);
          } else saveProgress(levelIndex + 1, false);
        }
      } else if (flow === "done") {
        const t = flowT + 6.2;
        view.turn = easeInOut(clamp((t - 2.6) / 7.2, 0, 1)) * TAU;
        explode = 1 - 0.7 * easeInOut(clamp((t - 7.5) / 2.5, 0, 1));
        trailMat.uniforms.uProg.value = trailTotal + 2;
      } else if (flow === "outro") {
        veil.style.opacity = String(clamp(flowT / 0.7, 0, 1));
        explode = Math.max(explode, easeInOut(clamp(flowT / 0.7, 0, 1)) * 1.2);
        if (flowT > 0.75) { buildLevel(pendingLevel); }
      }

      // lights ease toward the level mood
      const k = 1 - Math.exp(-dt * 1.2);
      lightNow.hemi = lerp(lightNow.hemi, lightTarget.hemi, k);
      lightNow.key = lerp(lightNow.key, lightTarget.key, k);
      lightNow.env = lerp(lightNow.env, lightTarget.env, k);
      hemi.intensity = lightNow.hemi; key.intensity = lightNow.key;
      fill.intensity = lerp(fill.intensity, flow === "finale" || flow === "done" ? Math.max(fillTarget, 0.3) : fillTarget, k);
      if (flow === "finale" && flowT > 3.6) catcher.visible = true;
      scene.environmentIntensity = 0.75 * lightNow.env;
    }

    // ---- per-frame visuals --------------------------------------------------------
    function render() {
      const dt = 1 / 60;
      const b = sim.ball;
      world.rotation.z = ctl.theta;
      decoWorld.rotation.z = ctl.deco;
      worldRoot.rotation.y = ctl.yaw + view.turn;
      worldRoot.rotation.x = -0.04 * view.pull;

      // architecture: dynamic pieces, explode, memory and pulses
      const touched = sim.lastTouched;
      if (touched !== lastTouched) { lastTouched = touched; const r = meshes.find((m) => m.st === touched); if (r && flow === "play") r.pulse = 1; }
      for (const r of meshes) {
        const st = r.st;
        if (st.dyn) {
          const Tr = sim.dynTransform(st);
          r.group.rotation.z = Tr.a;
          const s = Math.max(0.001, Tr.s);
          r.group.scale.set(s, s, Math.max(0.001, Math.min(1, s * 1.4)));
          if (st.dyn.t > 0 && st.dyn.t < 1) r.glow = Math.max(r.glow, 0.5);
        }
        r.group.position.z = explode * r.layer * 1.3 + (r.st.deco ? explode * -0.6 : 0);
        if (lightMode === "dark" && b.visible && !st.deco && flow === "play") {
          let near = false;
          for (const p of r.samples) { if (Math.abs(b.x - p[0]) < 2 && Math.abs(b.y - p[1]) < 2) { near = true; break; } }
          if (near) r.mem = Math.min(1, r.mem + dt * 0.9);
        }
        r.pulse = Math.max(0, r.pulse - dt * 1.6);
        r.glow = Math.max(0, r.glow - dt * 0.5);
        const active = flow === "finale" || flow === "done";
        const act = active && st.dyn && st.dyn.t > 0 ? 0.25 + 0.2 * Math.sin(time * 2 + r.cx) : 0;
        r.mat.emissiveIntensity = r.mem * (lightMode === "dark" ? 0.07 : 0) + r.pulse * 0.12 + r.glow * 0.35 + act;
      }
      for (const u of buds3) {
        const open = easeInOut(u.b.t);
        u.petals.forEach((hg, i) => { hg.rotation.x = lerp(-1.25, 0.15, open) + Math.sin(time * 0.8 + i) * 0.03 * (1 - open); });
        u.g.scale.setScalar(1 + 0.12 * open);
        u.core.material.emissiveIntensity = u.b.open ? 0.4 + 1.6 * Math.exp(-(sim.time - u.b.openedAt) * 1.2) + (flow !== "play" ? 0.6 : 0) : 0.18 + 0.1 * Math.sin(time * 1.6);
        u.g.position.z = level.zField(u.b.x, u.b.y) + explode * 1.3;
      }
      for (const l of lotus3) {
        const t = l.t;
        const target = t.fired ? 1 : t.fill * 0.55;
        l.open = lerp(l.open, target, 1 - Math.exp(-dt * 2.5));
        l.petals.forEach((hg, i) => { hg.rotation.x = lerp(-1.35, -0.05, l.open) + Math.sin(time * 1.1 + i * 0.7) * 0.02; });
        if (l.plate) l.g.material.emissiveIntensity = t.fired ? 0.9 : 0.1 + 0.08 * Math.sin(time * 2);
        else l.g.children.forEach((c) => { const pm = c.children[0].children[0]; pm.material.emissiveIntensity = t.fired ? 0.5 + (flow !== "play" ? 0.4 : 0) : t.fill * 0.3; });
      }
      for (const pp of portals3) {
        pp.p.flash = Math.max(0, pp.p.flash - dt * 1.2);
        pp.pair.forEach((q, i) => { q.disc.rotation.z = time * (i ? -0.6 : 0.6); q.disc.material.opacity = 0.35 + 0.6 * pp.p.flash + (sim.activated.has("portal") && flow !== "play" ? 0.4 : 0); });
      }
      for (const s of slow3) s.lens.material.opacity = 0.16 + 0.35 * b.inSlow;
      for (const sh of shells3) {
        const want = b.inside || flow === "finale" || flow === "done" ? 1 : 0;
        sh.open = lerp(sh.open, want, 1 - Math.exp(-dt * 2.2));
        sh.cover.material.opacity = 0.96 - 0.86 * sh.open;
        sh.cover.visible = sh.cover.material.opacity > 0.02;
        sh.cover.material.depthWrite = sh.open < 0.5;
        sh.back.material.opacity = 0.35 * sh.open;
      }
      if (goal3) {
        const won = sim.state === "won";
        goal3.material.opacity = won ? 0.85 : 0.22 + 0.12 * Math.sin(time * 1.4);
        goal3.scale.setScalar(won ? 1 + 0.05 * Math.sin(time * 2) : 1);
      }

      // ball
      const z = level.zField(b.x, b.y);
      const sp = Math.hypot(b.vx, b.vy);
      const won = sim.state === "won";
      ballGroup.position.set(b.x, b.y, z);
      let vis = 1;
      if (sim.state === "falling") vis = clamp(1 - (sim.fallT - 0.4) / 0.7, 0, 1);
      if (sim.ball.frozen) vis = Math.min(vis, respawnT);
      ballGroup.scale.setScalar(0.4 + 0.6 * vis);
      ballGroup.visible = vis > 0.01;
      ballShell.rotation.z = -b.spin;
      // light leans into the direction of travel (in world-local frame)
      const c = Math.cos(-ctl.theta), s = Math.sin(-ctl.theta);
      const lvx = c * b.vx - s * b.vy, lvy = s * b.vx + c * b.vy;
      const lean = clamp(sp / 10, 0, 1) * BALL_R * 0.3;
      const ln = Math.hypot(lvx, lvy) || 1;
      ballCore.position.set((lvx / ln) * lean, (lvy / ln) * lean, 0);
      innerGlow.position.copy(ballCore.position);
      flash = Math.max(0, flash - dt * 3);
      const pulse = won ? 0 : 0.06 * Math.sin(time * 2.2);
      const wet = b.wet || 0;
      const g = T.glow();
      const bright = (0.75 + pulse + flash * 0.6 + (won ? 0.45 : 0)) * vis;
      haloMat.opacity = clamp((0.28 + 0.4 * g) * bright * (1 - 0.35 * wet), 0, 1);
      halo.scale.setScalar(BALL_R * (5.5 + 3 * g + flash * 3 + (won ? 2.5 : 0)) * (1 + wet * 0.15 * Math.sin(time * 9)));
      glowMat.opacity = clamp(0.9 * bright, 0, 1);
      coreMat.color.copy(accent).lerp(new THREE.Color(1, 1, 1), won ? 0.75 : 0.5);
      if (wet > 0.05) coreMat.color.lerp(new THREE.Color(0.75, 0.9, 1), wet * 0.35);
      ballShellMat.opacity = 0.3 + 0.15 * b.inSlow;
      ballLight.intensity = lightTarget.ball * bright;
      ballLight.distance = lightTarget.ballDist;
      // restrained trail when fast
      for (let i = ghosts.length - 1; i > 0; i--) { ghosts[i].position.copy(ghosts[i - 1].position); ghosts[i].material.opacity = ghosts[i - 1].material.opacity * 0.62; }
      tmpV.set(b.x, b.y, z); world.localToWorld(tmpV); worldRoot.worldToLocal(tmpV);
      ghosts[0].position.copy(tmpV);
      ghosts[0].material.opacity = clamp((sp - 6) / 14, 0, 0.35) * vis;
      ghosts.forEach((q) => q.material.color.copy(accent));
      for (const r of ripples) {
        if (r.userData.t >= 1) { r.material.opacity = 0; continue; }
        r.userData.t = Math.min(1, r.userData.t + dt * 1.8);
        const e = 1 - Math.pow(1 - r.userData.t, 3);
        r.scale.setScalar(0.3 + e * r.userData.size);
        r.material.opacity = (1 - r.userData.t) * 0.5 * r.userData.str;
      }

      // route ribbon
      appendTrail();
      trailMat.uniforms.uHead.value = trailHeadLen;
      trailMat.uniforms.uBase.value = lightMode === "dark" ? 0.5 : 0.28;

      // water points
      if (waterPts) {
        const W = sim.water, arr = waterPts.geometry.attributes.position.array;
        for (let i = 0; i < W.n; i++) {
          if (W.alive[i]) { arr[i * 3] = W.x[i]; arr[i * 3 + 1] = W.y[i]; arr[i * 3 + 2] = level.zField(W.x[i], W.y[i]); }
          else { arr[i * 3] = 9999; arr[i * 3 + 1] = 9999; arr[i * 3 + 2] = 0; }
        }
        waterPts.geometry.attributes.position.needsUpdate = true;
        const lit = sim.triggers.some((t) => t.kind === "water" && t.fired);
        waterQuadMat.uniforms.uGlow.value.copy(accent).multiplyScalar(lit ? 0.08 + (flow !== "play" ? 0.1 : 0) : 0);
      }

      // audio texture follows the physics
      if (A.ac) {
        const t = A.ac.currentTime;
        const rolling = b.touching && sim.state === "play" && !b.frozen ? clamp(sp / 9, 0, 1) : 0;
        A.roll.g.gain.setTargetAtTime(rolling * 0.07, t, 0.05);
        A.roll.fl.frequency.setTargetAtTime(260 + sp * 70, t, 0.1);
        const rw = clamp(Math.abs(ctl.omega) / 3, 0, 1);
        A.rot.g.gain.setTargetAtTime(rw * 0.12, t, 0.08);
        A.rotOscG.gain.setTargetAtTime(rw * 0.035, t, 0.1);
        A.rot.fl.frequency.setTargetAtTime(140 + rw * 180, t, 0.1);
        const we = sim.water ? clamp(sim.water.energy / 3, 0, 1) : 0;
        A.water.g.gain.setTargetAtTime(we * 0.05, t, 0.15);
        A.water.fl.frequency.setTargetAtTime(900 + Math.random() * 1400, t, 0.03);
        for (const d of A.drone) d.o.detune.setTargetAtTime(clamp(sp, 0, 14) * 1.2, t, 0.4);
      }

      // camera: stable; follows a falling ball only a little
      const fallY = sim.state === "falling" ? clamp(sim.ball.fsy * 0.25, -4, 0) : 0;
      view.follow = lerp(view.follow, fallY, 1 - Math.exp(-dt * 2.2));
      placeCamera(dt);

      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      if (waterPts) {
        renderer.setRenderTarget(waterRT);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        const bgKeep = scene.background;
        scene.background = null;
        camera.layers.set(1);
        renderer.render(scene, camera);
        camera.layers.set(0);
        scene.background = bgKeep;
        renderer.setRenderTarget(null);
        renderer.autoClear = false;
        renderer.render(quadScene, quadCam);
        renderer.autoClear = true;
      }
    }

    function appendTrail() {
      const route = sim.route;
      const zf = level.zField;
      while (trailRouteIdx < route.length - 1 && trailSegs < TRAIL_MAX) {
        const a = route[trailRouteIdx], b = route[trailRouteIdx + 1];
        trailRouteIdx++;
        if (!a || !b) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const nx = (-dy / L) * 0.045, ny = (dx / L) * 0.045;
        const za = zf(a[0], a[1]) - 0.36, zb = zf(b[0], b[1]) - 0.36;
        const o = trailSegs * 18, ol = trailSegs * 6;
        const v = [a[0] + nx, a[1] + ny, za, a[0] - nx, a[1] - ny, za, b[0] + nx, b[1] + ny, zb, a[0] - nx, a[1] - ny, za, b[0] - nx, b[1] - ny, zb, b[0] + nx, b[1] + ny, zb];
        for (let i = 0; i < 18; i++) trailPos[o + i] = v[i];
        const l0 = trailTotal, l1 = trailTotal + L;
        trailLen.set([l0, l0, l1, l0, l1, l1], ol);
        trailTotal = l1;
        trailSegs++;
      }
      trailHeadLen = trailTotal;
      trailGeo.setDrawRange(0, trailSegs * 6);
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.aLen.needsUpdate = true;
      trailGeo.attributes.position.clearUpdateRanges && trailGeo.attributes.position.clearUpdateRanges();
    }

    // ---- progress (Continue Playing) ------------------------------------------------
    function saveProgress(next, finished) {
      try {
        if (finished) ctx.game.progress.complete("main", { state: { level: 0 }, label: "The whole object", percent: 100 }).catch(() => {});
        else ctx.game.progress.save("main", { state: { level: next }, label: String(next + 1).padStart(2, "0") + " " + LEVELS[next]().name, percent: Math.round((next / LEVELS.length) * 100) }).catch(() => {});
      } catch (e) {}
    }
    let startLevel = 0;
    try {
      const saved = await Promise.race([ctx.game.progress.load("main"), new Promise((r) => ctx.timeout(() => r(null), 1500))]);
      if (saved && saved.resumeEligible === true && saved.state && Number.isInteger(saved.state.level)) startLevel = clamp(saved.state.level, 0, LEVELS.length - 1);
    } catch (e) {}
    if (disposed) return;
    const dbg = Math.round(knob("start_level", 0));
    if (dbg >= 1) startLevel = clamp(dbg - 1, 0, LEVELS.length - 1);

    buildLevel(startLevel);
    ctx.onResize(() => layout(), { immediate: true });

    ctx.onDestroy(() => {
      try { disposeObj(scene); } catch (e) {}
      try { waterRT.dispose(); envTex.dispose(); pmrem.dispose(); renderer.dispose(); } catch (e) {}
    });

    ctx.game.loop({ input, update, render: () => render() });
    render();
    ctx.markVisualReady("sculpture");
    ctx.platform.ready();
  }
};
