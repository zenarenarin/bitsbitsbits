"use strict";

// Gravity Run — tilt the phone to roll a heavy steel ball along a carved channel
// and drop it into the hole. Touching an edge ends the attempt.

// ─────────────────────────────────────────────────────────── constants

const DEG = Math.PI / 180;
const BALL_R = 0.36;
const PLATE_H = 0.42;
const DS = 0.04;
const REGION = { x0: -4.5, x1: 4.5, y0: -7.8, y1: 7.8 };
const LANE_GAP = 0.36;
const BUMPER_T = 0.075;
const BUMPER_LIMIT = BUMPER_T + Math.sqrt((BALL_R + BUMPER_T) ** 2 - (BALL_R - BUMPER_T) ** 2);
const HOLE_DEPTH = 0.95;
const GATE_H = 0.3;
const GATE_T = 0.1;
const GLASS_T = 0.18;
const TRAIL_LIFE = 3.2;
const TRAIL_MAX = 240;
const STEP_HZ = 120;
const CAM_TILT = 11 * DEG;
const CAM_FOV = 30;
const AUTO_NEXT_MS = 1900;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = t => t * t * (3 - 2 * t);
const pad2 = n => (n < 10 ? "0" : "") + n;

// ─────────────────────────────────────────────────────────── route language
// A route is drawn like a turtle: straights and circular arcs, each optionally
// easing the channel half-width to a new value. Arcs keep wall geometry exact.

const S = (len, w) => ["S", len, w];
const L = (deg, r, w) => ["L", deg, r, w];
const R = (deg, r, w) => ["R", deg, r, w];
const AT = name => ["@", name];
const turn = dir => (dir > 0 ? L : R);

// One lateral bump that returns to its own line.
function bump(dir, deg, r) {
  return [turn(dir)(deg, r), turn(-dir)(deg * 2, r), turn(dir)(deg, r)];
}

// A continuous wave of n half-periods (one-sided around the entry line).
function wave(n, deg, r, dir = 1) {
  const out = [turn(dir)(deg, r)];
  let d = -dir;
  for (let i = 0; i < n; i++) {
    out.push(turn(d)(deg * 2, r));
    d = -d;
  }
  out.push(turn(d)(deg, r));
  return out;
}

// Boustrophedon levels: lanes stacked bottom→top joined by hairpins.
// Lane ops are written relative to "up" (toward the next lane). With columns:true
// the whole layout is turned a quarter so lanes run vertically and stack right→left.
function lanesLevel(o) {
  const path = [];
  const islands = [];
  const gates = [];
  let right = o.dir !== -1;
  o.lanes.forEach((lane, k) => {
    const len = lane.len != null ? lane.len : o.laneLen;
    const up = right ? 1 : -1;
    const last = k === o.lanes.length - 1;
    let used = 0;
    for (const op of lane.ops || []) {
      const kind = op[0];
      if (kind === "s" || kind === "w") {
        path.push(S(op[1], op[2]));
        used += op[1];
      } else if (kind === "bump" || kind === "dip") {
        const fwd = op[1];
        const deg = op[2];
        path.push(...bump(kind === "bump" ? up : -up, deg, fwd / (4 * Math.sin(deg * DEG))));
        used += fwd;
      } else if (kind === "fork") {
        const [, span, wf, off, rad] = op;
        const a = "f" + k + "a";
        const b = "f" + k + "b";
        path.push(S(0.6, wf), AT(a), S(span), AT(b), S(0.6, lane.w || o.w));
        islands.push({ from: a, to: b, off: off * up, rad });
        used += span + 1.2;
      } else if (kind === "gate") {
        const id = "g" + k + "_" + gates.length;
        path.push(AT(id));
        gates.push({ at: id, a: op[1] * up, b: op[2] * up, period: op[3], phase: op[4], duty: op[5] });
      }
    }
    const tail = last && o.endW ? 0.6 : 0;
    const rest = len - used - tail;
    if (rest > 1e-6) path.push(S(rest));
    if (tail) path.push(S(tail, o.endW));
    if (!last) path.push(turn(up)(180, o.pitch / 2, lane.hairW));
    right = !right;
  });
  const heading = o.dir === -1 ? 180 : 0;
  return {
    name: o.name,
    w: o.w,
    start: o.columns ? [-o.y0, o.x0] : [o.x0, o.y0],
    heading: o.columns ? heading + 90 : heading,
    path,
    islands,
    gates,
    hole: o.hole,
    phys: o.phys
  };
}

// Diagonal legs joined by tight bends, climbing the board.
function zigzag(o) {
  const path = [];
  const gates = [];
  const bendDeg = 180 - 2 * o.angle;
  for (let k = 0; k < o.legs; k++) {
    const last = k === o.legs - 1;
    const len = last && o.lastLen ? o.lastLen : o.legLen;
    const g = o.gates && o.gates[k];
    if (g) {
      const id = "z" + k;
      path.push(S(len * g.at), AT(id), S(len * (1 - g.at) - (last && o.endW ? 0.6 : 0)));
      gates.push({ at: id, a: g.a, b: g.b, period: g.period, phase: g.phase, duty: g.duty });
    } else path.push(S(len - (last && o.endW ? 0.6 : 0)));
    if (last && o.endW) path.push(S(0.6, o.endW));
    if (!last) path.push(turn(k % 2 === 0 ? 1 : -1)(bendDeg, o.bend));
  }
  return { name: o.name, w: o.w, start: o.start, heading: o.angle, path, gates, hole: o.hole, phys: o.phys };
}

// ─────────────────────────────────────────────────────────── levels

const LEVELS = [
  {
    name: "INTRODUCTION",
    w: 1.15,
    start: [0.75, -6.0],
    heading: 90,
    hole: 2.0,
    phys: { acc: 5.4, vmax: 3.9, roll: 0.85, damp: 0.45 },
    path: [S(1.5), ...bump(1, 38, 3.6), S(1.3)]
  },
  {
    name: "WAVES",
    w: 0.95,
    start: [0.82, -6.4],
    heading: 90,
    hole: 1.75,
    phys: { acc: 6.2, vmax: 4.5, roll: 0.75, damp: 0.4 },
    path: [S(0.8), ...wave(3, 62, 1.55), S(0.8)]
  },
  {
    name: "TIGHT TURNS",
    w: 0.84,
    start: [-2.3, -6.7],
    heading: 0,
    hole: 1.6,
    phys: { acc: 6.8, vmax: 5.0, roll: 0.68, damp: 0.36 },
    path: [
      S(4.4), L(90, 1.15), S(1.25), L(90, 1.15),
      S(4.4), R(90, 1.15), S(1.25), R(90, 1.15),
      S(4.4), L(90, 1.15), S(1.25), L(90, 1.15),
      S(2.2), R(90, 1.15), S(1.4)
    ]
  },
  lanesLevel({
    name: "LONG RUN",
    w: 0.8,
    pitch: 2.5,
    x0: -2.1,
    y0: -6.5,
    laneLen: 4.2,
    hole: 1.55,
    endW: 0.9,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.46, damp: 0.24 },
    lanes: [0, 1, 2, 3, 4, 5].map(k => ({
      ops: k < 5 ? [["w", 0.5, 0.8], ["bump", 3.2, 32], ["w", 0.5, 1.02]] : [["w", 0.5, 0.8], ["bump", 2.8, 32]]
    }))
  }),
  zigzag({
    name: "PRECISION",
    w: 0.62,
    start: [-2.25, -6.9],
    angle: 12,
    legLen: 4.6,
    bend: 0.9,
    legs: 5,
    lastLen: 3.4,
    endW: 0.74,
    hole: 1.45,
    phys: { acc: 7.0, vmax: 4.8, roll: 0.7, damp: 0.38 }
  }),
  lanesLevel({
    name: "SWITCHBACK",
    w: 0.7,
    pitch: 1.8,
    x0: -2.6,
    y0: -6.2,
    hole: 1.5,
    endW: 0.76,
    phys: { acc: 7.0, vmax: 5.0, roll: 0.6, damp: 0.32 },
    lanes: [4.8, 3.8, 4.4, 5.6, 4.6, 4.0, 4.4].map(len => ({ len }))
  }),
  {
    name: "COMPLEX PATH",
    w: 0.66,
    start: [-3.4, -6.9],
    heading: 0,
    hole: 1.45,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.55, damp: 0.3 },
    path: [
      S(5.4, 0.6), L(150, 1.05, 0.86), S(0.9, 0.62), ...wave(3, 30, 1.2), S(0.6),
      R(150, 1.0, 0.8), S(4.5, 0.58), L(140, 1.0, 0.84), S(0.8, 0.64), ...wave(3, 28, 1.05),
      R(40, 1.6), S(0.5, 0.8)
    ]
  },
  lanesLevel({
    name: "FORK",
    w: 0.78,
    pitch: 3.05,
    x0: -2.1,
    y0: -6.7,
    laneLen: 4.2,
    hole: 1.4,
    endW: 0.9,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.55, damp: 0.3 },
    lanes: [
      { ops: [["s", 0.6], ["bump", 3.0, 30]] },
      { ops: [["s", 0.2], ["fork", 2.6, 1.46, 0.3, 0.26]] },
      { ops: [["s", 0.6], ["bump", 3.0, 34]] },
      { ops: [["s", 0.2], ["fork", 2.6, 1.46, -0.3, 0.26]] },
      { ops: [["s", 0.4], ["bump", 2.6, 30]] }
    ]
  }),
  lanesLevel({
    name: "GATES",
    w: 0.8,
    pitch: 2.5,
    x0: -2.2,
    y0: -6.4,
    laneLen: 4.4,
    hole: 1.45,
    endW: 0.9,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.55, damp: 0.3 },
    lanes: [
      { ops: [["s", 2.2], ["gate", -1, 1, 3.0, 0.0, 0.42]] },
      { ops: [["s", 0.6], ["bump", 3.2, 30]] },
      { ops: [["s", 1.4], ["gate", -1, 0.25, 2.4, 0.3, 0.5], ["s", 1.6], ["gate", -0.25, 1, 2.4, 0.8, 0.5]] },
      { ops: [["s", 0.7], ["bump", 3.0, 28]] },
      { ops: [["s", 2.4], ["gate", -1, 1, 2.6, 0.5, 0.45]] }
    ]
  }),
  {
    name: "NEEDLE",
    w: 0.58,
    start: [-1.5, -6.6],
    heading: 90,
    hole: 1.3,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.42, damp: 0.22 },
    path: [S(0.6), ...wave(5, 45, 1.3), S(0.5), R(180, 1.5), S(0.5), ...wave(5, 45, 1.3), S(0.6, 0.74)]
  },
  lanesLevel({
    name: "LABYRINTH",
    w: 0.7,
    pitch: 2.95,
    x0: -2.15,
    y0: -6.8,
    laneLen: 4.3,
    hole: 1.35,
    endW: 0.84,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.48, damp: 0.26 },
    lanes: [
      { ops: [["s", 0.6], ["bump", 3.0, 32]] },
      { ops: [["s", 0.3], ["fork", 2.8, 1.42, 0.32, 0.24]] },
      { ops: [["s", 0.7], ["bump", 2.9, 30], ["gate", -1, 1, 2.8, 0.2, 0.4]] },
      { ops: [["s", 0.5], ["w", 0.7, 0.58], ["s", 1.6], ["w", 0.7, 0.7]] },
      { ops: [["s", 1.6], ["gate", -1, 0.3, 2.2, 0.6, 0.5], ["s", 1.2], ["gate", -0.3, 1, 2.2, 0.1, 0.5]] }
    ]
  }),
  lanesLevel({
    name: "CLOCKWORK",
    columns: true,
    w: 0.66,
    pitch: 2.2,
    x0: -5.8,
    y0: -3.35,
    laneLen: 11.6,
    hole: 1.35,
    endW: 0.8,
    phys: { acc: 7.0, vmax: 5.2, roll: 0.42, damp: 0.22 },
    lanes: [
      { ops: [["s", 4.0], ["gate", -1, 1, 2.2, 0.0, 0.45], ["s", 4.0], ["gate", -1, 1, 2.2, 0.5, 0.45]] },
      { ops: [["s", 2.0], ["bump", 4.0, 26], ["s", 1.6], ["gate", -1, 0.25, 1.8, 0.2, 0.5], ["s", 0.01], ["gate", -0.25, 1, 1.8, 0.7, 0.5]] },
      { ops: [["s", 3.0], ["gate", -1, 1, 2.0, 0.35, 0.5], ["s", 3.4], ["gate", -1, 1, 1.8, 0.7, 0.45]] },
      { ops: [["s", 2.0], ["bump", 3.4, 26]] }
    ]
  })
];

const MASTER_NAMES = ["DRIFT", "KEEL", "PLUMB", "TORQUE", "FULCRUM", "EBB", "MERIDIAN", "LODESTONE", "TIDE", "PENDULUM", "APEX", "VERNIER"];

function randomGate(rnd, full) {
  if (full) return ["gate", -1, 1, 2.0 + rnd() * 1.2, rnd(), 0.4 + rnd() * 0.12];
  const side = rnd() < 0.5 ? 1 : -1;
  return ["gate", -side, side * 0.3, 1.8 + rnd(), rnd(), 0.55];
}

// Seeded master levels beyond the authored set. Three layout families (rows,
// columns, zigzag); each candidate is validated and re-rolled until it fits.
function proceduralDef(n) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rnd = rng(0x5eed + n * 977 + attempt * 7919);
    const d = clamp((n - LEVELS.length) / 12, 0, 1);
    const w = lerp(0.72, 0.6, d) - rnd() * 0.04;
    const name = MASTER_NAMES[(n - LEVELS.length - 1) % MASTER_NAMES.length];
    const hole = lerp(1.38, 1.28, d);
    const phys = { acc: 7.0, vmax: 5.2, roll: lerp(0.46, 0.38, d), damp: lerp(0.25, 0.2, d) };
    const family = (n + attempt) % 3;
    let def;
    if (family === 2) {
      const angle = 9 + rnd() * 9;
      const bend = w + 0.2 + rnd() * 0.2;
      const legLen = 4.0 + rnd() * 0.8;
      const legRise = legLen * Math.sin(angle * DEG);
      const bendRise = 2 * bend * Math.cos(angle * DEG);
      let legs = 2;
      while (legs < 8 && (legs + 1) * legRise + legs * bendRise <= 15.6 - 2 * w - 1.1) legs++;
      const gates = {};
      const count = 1 + Math.floor(d * 2 + rnd() * 2);
      for (let i = 0; i < count; i++) {
        const k = 1 + Math.floor(rnd() * (legs - 1));
        gates[k] = { at: 0.35 + rnd() * 0.3, a: -1, b: 1, period: 2.0 + rnd() * 1.2, phase: rnd(), duty: 0.42 };
      }
      const span = legLen * Math.cos(angle * DEG) + 2 * (bend + w);
      def = zigzag({ name, w, start: [-span / 2 + bend + w, REGION.y0 + w + 0.35], angle, legLen, bend, legs, endW: w + 0.16, gates, hole, phys });
    } else {
      const columns = family === 1;
      const along = columns ? 15.6 : 9;
      const across = columns ? 9 : 15.6;
      const fork = rnd() < 0.45;
      const amp = 0.42 + rnd() * 0.18;
      const forkW = fork ? w + 0.7 : w;
      const pitch = Math.max(2 * w + LANE_GAP + amp, forkW + w + LANE_GAP + 0.06) + 0.06;
      const lanes = clamp(Math.floor((across - 2 * forkW - amp - 0.5) / pitch) + 1, 3, 7);
      const half = Math.min(columns ? 6.4 : 2.5, along / 2 - (pitch / 2 + w) - 0.1);
      const laneLen = half * 2;
      const specs = [];
      let gatesLeft = 1 + Math.floor(d * 2 + rnd() * 2);
      const forkLane = fork ? 1 + Math.floor(rnd() * (lanes - 2)) : -1;
      for (let k = 0; k < lanes; k++) {
        const ops = [];
        if (k === forkLane) {
          const span = Math.min(laneLen - 1.6, 2.4 + rnd() * (columns ? 3 : 0.6));
          ops.push(["s", (laneLen - span - 1.2) * rnd()], ["fork", span, forkW, (rnd() < 0.5 ? 1 : -1) * 0.3, 0.24]);
        } else if (gatesLeft > 0 && k > 0 && rnd() < 0.6) {
          gatesLeft--;
          ops.push(["s", laneLen * (0.3 + rnd() * 0.3)], randomGate(rnd, rnd() < 0.6));
          if (columns) ops.push(["s", 1.4], ["bump", Math.min(4, laneLen * 0.3), 24]);
        } else {
          const fwd = Math.min(laneLen * (0.6 + rnd() * 0.25), columns ? 6 : 99);
          const deg = 26 + rnd() * 10;
          const rr = fwd / (4 * Math.sin(deg * DEG));
          if (2 * rr * (1 - Math.cos(deg * DEG)) <= amp) ops.push(["s", (laneLen - fwd) * rnd()], ["bump", fwd, deg]);
          else ops.push(["s", 0.4], ["w", 0.8, w * 0.86], ["s", laneLen * 0.3], ["w", 0.8, w]);
        }
        specs.push({ ops });
      }
      // Rows start at the bottom; columns (after the quarter turn) start at the right edge.
      const y0 = columns ? -(REGION.x1 - forkW - 0.35) : REGION.y0 + forkW + 0.35;
      def = lanesLevel({ name, columns, w, pitch, x0: -half, y0, laneLen, hole, endW: w + 0.16, phys, lanes: specs });
    }
    try {
      const lv = buildLevel(def);
      if (validateLevel(lv).length === 0) return def;
    } catch (e) {
      // try the next seed
    }
  }
  return LEVELS[LEVELS.length - 1];
}

function levelDef(n) {
  return n <= LEVELS.length ? LEVELS[n - 1] : proceduralDef(n);
}

// ─────────────────────────────────────────────────────────── level geometry

function tracePath(def) {
  const xs = [];
  const ys = [];
  const hs = [];
  const ws = [];
  const ss = [];
  const marks = {};
  let x = def.start[0];
  let y = def.start[1];
  let h = def.heading * DEG;
  let w = def.w;
  let s = 0;
  const push = () => {
    xs.push(x);
    ys.push(y);
    hs.push(h);
    ws.push(w);
    ss.push(s);
  };
  push();
  for (const cmd of def.path) {
    const kind = cmd[0];
    if (kind === "@") {
      marks[cmd[1]] = s;
      continue;
    }
    const w0 = w;
    const wT = (kind === "S" ? cmd[2] : cmd[3]) != null ? (kind === "S" ? cmd[2] : cmd[3]) : w0;
    const len = kind === "S" ? cmd[1] : Math.abs(cmd[1]) * DEG * cmd[2];
    if (len <= 0) continue;
    const n = Math.max(1, Math.ceil(len / DS));
    const x0 = x;
    const y0 = y;
    const h0 = h;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (kind === "S") {
        x = x0 + Math.cos(h0) * len * t;
        y = y0 + Math.sin(h0) * len * t;
      } else {
        const r = cmd[2];
        const sg = kind === "L" ? 1 : -1;
        const ccx = x0 - sg * Math.sin(h0) * r;
        const ccy = y0 + sg * Math.cos(h0) * r;
        h = h0 + sg * cmd[1] * DEG * t;
        x = ccx + sg * Math.sin(h) * r;
        y = ccy - sg * Math.cos(h) * r;
      }
      s += len / n;
      w = w0 + (wT - w0) * smooth01(t);
      push();
    }
  }
  return { xs, ys, hs, ws, ss, marks, length: s };
}

function arcPoints(cx, cy, r, a0, a1, segs, out) {
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

function buildLevel(def) {
  const P = tracePath(def);
  const n = P.xs.length;
  const lv = {
    def,
    n,
    length: P.length,
    cx: Float64Array.from(P.xs),
    cy: Float64Array.from(P.ys),
    w: Float64Array.from(P.ws),
    s: Float64Array.from(P.ss),
    tx: new Float64Array(n),
    ty: new Float64Array(n),
    lx: new Float64Array(n),
    ly: new Float64Array(n),
    rx: new Float64Array(n),
    ry: new Float64Array(n),
    win: new Int32Array(n),
    marks: P.marks
  };
  for (let i = 0; i < n; i++) {
    const tx = Math.cos(P.hs[i]);
    const ty = Math.sin(P.hs[i]);
    lv.tx[i] = tx;
    lv.ty[i] = ty;
    lv.lx[i] = lv.cx[i] - ty * lv.w[i];
    lv.ly[i] = lv.cy[i] + tx * lv.w[i];
    lv.rx[i] = lv.cx[i] + ty * lv.w[i];
    lv.ry[i] = lv.cy[i] - tx * lv.w[i];
    lv.win[i] = Math.ceil((1.3 * lv.w[i] + 0.3) / DS) + 2;
  }
  const e = n - 1;
  const h0 = P.hs[0];
  const hN = P.hs[e];
  // Closed outline, clockwise: back of the start cup, left wall, end cap, right wall.
  const outline = [];
  arcPoints(lv.cx[0], lv.cy[0], lv.w[0], h0 - Math.PI / 2, h0 - Math.PI * 1.5, 32, outline);
  for (let i = 1; i < n; i++) outline.push([lv.lx[i], lv.ly[i]]);
  const endCap = [];
  arcPoints(lv.cx[e], lv.cy[e], lv.w[e], hN + Math.PI / 2, hN - Math.PI / 2, 32, endCap);
  for (let i = 1; i < endCap.length - 1; i++) outline.push(endCap[i]);
  for (let i = e; i >= 1; i--) outline.push([lv.rx[i], lv.ry[i]]);
  lv.outline = outline;

  lv.start = { x: lv.cx[0], y: lv.cy[0], h: h0, w: lv.w[0], limit: lv.w[0] - BUMPER_LIMIT };
  lv.hole = { x: lv.cx[e], y: lv.cy[e], r: def.hole * BALL_R };

  const idxAt = s => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lv.s[mid] < s) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  lv.idxAt = idxAt;

  lv.islands = (def.islands || []).map(isl => {
    const i0 = idxAt(P.marks[isl.from] + 0.12);
    const i1 = idxAt(P.marks[isl.to] - 0.12);
    const m = i1 - i0 + 1;
    const qx = new Float64Array(m);
    const qy = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const j = i0 + i;
      const t = m > 1 ? i / (m - 1) : 0;
      const off = Array.isArray(isl.off) ? lerp(isl.off[0], isl.off[1], smooth01(t)) : isl.off;
      qx[i] = lv.cx[j] - lv.ty[j] * off;
      qy[i] = lv.cy[j] + lv.tx[j] * off;
    }
    // Counter-clockwise outline (island interior on the left).
    const ol = [];
    for (let i = 0; i < m; i++) {
      const j = i0 + i;
      ol.push([qx[i] + lv.ty[j] * isl.rad, qy[i] - lv.tx[j] * isl.rad]);
    }
    const ha = Math.atan2(lv.ty[i1], lv.tx[i1]);
    const cap1 = [];
    arcPoints(qx[m - 1], qy[m - 1], isl.rad, ha - Math.PI / 2, ha + Math.PI / 2, 12, cap1);
    for (let i = 1; i < cap1.length - 1; i++) ol.push(cap1[i]);
    for (let i = m - 1; i >= 0; i--) {
      const j = i0 + i;
      ol.push([qx[i] - lv.ty[j] * isl.rad, qy[i] + lv.tx[j] * isl.rad]);
    }
    const hb = Math.atan2(lv.ty[i0], lv.tx[i0]);
    const cap0 = [];
    arcPoints(qx[0], qy[0], isl.rad, hb + Math.PI / 2, hb + Math.PI * 1.5, 12, cap0);
    for (let i = 1; i < cap0.length - 1; i++) ol.push(cap0[i]);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of ol) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    return { qx, qy, rad: isl.rad, i0, i1, outline: ol, box: { x0, y0, x1, y1 } };
  });

  lv.gates = (def.gates || []).map(g => {
    const i = idxAt(P.marks[g.at]);
    const nx = -lv.ty[i];
    const ny = lv.tx[i];
    let wa = g.a * lv.w[i];
    let wb = g.b * lv.w[i];
    // A partial gate always leaves a ball-width gap (plus a little room) when raised.
    const full = Math.abs(g.a) >= 1 && Math.abs(g.b) >= 1;
    if (!full) {
      const gap = 2 * BALL_R + 0.16;
      const wall = Math.abs(g.a) >= 1 ? wa : wb;
      const free = -Math.sign(wall) * lv.w[i];
      const limit = free + Math.sign(wall) * (gap + GATE_T);
      if (Math.abs(g.a) >= 1) wb = Math.sign(wall) > 0 ? Math.max(wb, limit) : Math.min(wb, limit);
      else wa = Math.sign(wall) > 0 ? Math.max(wa, limit) : Math.min(wa, limit);
    }
    return {
      ax: lv.cx[i] + nx * wa,
      ay: lv.cy[i] + ny * wa,
      bx: lv.cx[i] + nx * wb,
      by: lv.cy[i] + ny * wb,
      period: g.period,
      phase: g.phase,
      duty: g.duty,
      lift: -0.02,
      i
    };
  });

  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of outline) {
    bx0 = Math.min(bx0, p[0]);
    by0 = Math.min(by0, p[1]);
    bx1 = Math.max(bx1, p[0]);
    by1 = Math.max(by1, p[1]);
  }
  lv.bbox = { x0: bx0 - 0.06, y0: by0 - 0.06, x1: bx1 + 0.06, y1: by1 + 0.06 };
  return lv;
}

// Geometry sanity checks: board fit, wall folding, channel overlap, hole and fork clearances.
function validateLevel(lv) {
  const issues = [];
  const b = lv.bbox;
  if (b.x0 < REGION.x0 || b.x1 > REGION.x1 || b.y0 < REGION.y0 || b.y1 > REGION.y1) {
    issues.push("outside board: x " + b.x0.toFixed(2) + ".." + b.x1.toFixed(2) + " y " + b.y0.toFixed(2) + ".." + b.y1.toFixed(2));
  }
  const n = lv.n;
  for (let i = 0; i < n - 1; i++) {
    const cdx = lv.cx[i + 1] - lv.cx[i];
    const cdy = lv.cy[i + 1] - lv.cy[i];
    const ldot = (lv.lx[i + 1] - lv.lx[i]) * cdx + (lv.ly[i + 1] - lv.ly[i]) * cdy;
    const rdot = (lv.rx[i + 1] - lv.rx[i]) * cdx + (lv.ry[i + 1] - lv.ry[i]) * cdy;
    if (ldot <= 1e-5 || rdot <= 1e-5) {
      issues.push("wall folds at s=" + lv.s[i].toFixed(2));
      break;
    }
  }
  let overlap = null;
  for (let i = 0; i < n && !overlap; i += 3) {
    for (let j = i + 3; j < n; j += 3) {
      if (lv.s[j] - lv.s[i] < 2.4 * (lv.w[i] + lv.w[j]) + 0.6) continue;
      const d = Math.hypot(lv.cx[i] - lv.cx[j], lv.cy[i] - lv.cy[j]);
      if (d < lv.w[i] + lv.w[j] + LANE_GAP - 0.02) {
        overlap = "channels too close at s=" + lv.s[i].toFixed(2) + " / " + lv.s[j].toFixed(2) + " (" + d.toFixed(2) + ")";
        break;
      }
    }
  }
  if (overlap) issues.push(overlap);
  if (lv.hole.r > lv.w[n - 1] - 0.06) issues.push("hole wider than end chamber");
  if (lv.hole.r < BALL_R * 1.2) issues.push("hole too small");
  for (const g of lv.gates) {
    // A gate must stay fully down long enough to roll across its footprint.
    const down = (1 - g.duty - 0.09) * g.period;
    if (down < 0.55) issues.push("gate window too short (" + down.toFixed(2) + "s)");
  }
  for (const isl of lv.islands) {
    for (let k = 0; k < isl.qx.length; k += 4) {
      const j = isl.i0 + k;
      const off = (isl.qx[k] - lv.cx[j]) * -lv.ty[j] + (isl.qy[k] - lv.cy[j]) * lv.tx[j];
      const upper = lv.w[j] - (off + isl.rad);
      const lower = lv.w[j] + (off - isl.rad);
      if (Math.max(upper, lower) < 2 * BALL_R + 0.12) {
        issues.push("fork impassable");
        break;
      }
    }
  }
  return issues;
}

// ─────────────────────────────────────────────────────────── collision

function segNearest(ax, ay, bx, by, px, py, out) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
  if (d2 < out.d2) {
    out.d2 = d2;
    out.x = qx;
    out.y = qy;
  }
}

function nearestIndex(lv, px, py, hint) {
  const d2 = i => (lv.cx[i] - px) * (lv.cx[i] - px) + (lv.cy[i] - py) * (lv.cy[i] - py);
  let i = clamp(hint | 0, 0, lv.n - 1);
  let best = d2(i);
  for (;;) {
    const a = i > 0 ? d2(i - 1) : Infinity;
    const b = i < lv.n - 1 ? d2(i + 1) : Infinity;
    if (a < best && a <= b) {
      i--;
      best = a;
    } else if (b < best) {
      i++;
      best = b;
    } else break;
  }
  return i;
}

function gateHeight(g, t) {
  const u = (((t / g.period + g.phase) % 1) + 1) % 1;
  const ramp = 0.09;
  let k;
  if (u < ramp) k = smooth01(u / ramp);
  else if (u < g.duty) k = 1;
  else if (u < g.duty + ramp) k = 1 - smooth01((u - g.duty) / ramp);
  else k = 0;
  return lerp(-0.02, GATE_H, k);
}

// Nearest solid surface to the ball centre. Returns gap = distance minus ball radius.
const HIT = { gap: 0, x: 0, y: 0, kind: "" };
const NEAR = { d2: 0, x: 0, y: 0 };
function probe(lv, px, py, idx, gateT) {
  HIT.gap = Infinity;
  NEAR.d2 = Infinity;
  const k = lv.win[idx];
  const j0 = Math.max(0, idx - k);
  const j1 = Math.min(lv.n - 2, idx + k);
  for (let j = j0; j <= j1; j++) {
    segNearest(lv.lx[j], lv.ly[j], lv.lx[j + 1], lv.ly[j + 1], px, py, NEAR);
    segNearest(lv.rx[j], lv.ry[j], lv.rx[j + 1], lv.ry[j + 1], px, py, NEAR);
  }
  if (NEAR.d2 < Infinity) {
    HIT.gap = Math.sqrt(NEAR.d2) - BALL_R;
    HIT.x = NEAR.x;
    HIT.y = NEAR.y;
    HIT.kind = "edge";
  }
  const e = lv.n - 1;
  if (idx >= e - k) {
    const ex = px - lv.cx[e];
    const ey = py - lv.cy[e];
    if (ex * lv.tx[e] + ey * lv.ty[e] > 0) {
      const d = Math.hypot(ex, ey) || 1e-9;
      const gap = lv.w[e] - d - BALL_R;
      if (gap < HIT.gap) {
        HIT.gap = gap;
        HIT.x = lv.cx[e] + (ex / d) * lv.w[e];
        HIT.y = lv.cy[e] + (ey / d) * lv.w[e];
        HIT.kind = "edge";
      }
    }
  }
  for (const isl of lv.islands) {
    const b = isl.box;
    if (px < b.x0 - 1 || px > b.x1 + 1 || py < b.y0 - 1 || py > b.y1 + 1) continue;
    NEAR.d2 = Infinity;
    for (let j = 0; j < isl.qx.length - 1; j++) segNearest(isl.qx[j], isl.qy[j], isl.qx[j + 1], isl.qy[j + 1], px, py, NEAR);
    const d = Math.sqrt(NEAR.d2);
    const gap = d - isl.rad - BALL_R;
    if (gap < HIT.gap) {
      HIT.gap = gap;
      HIT.x = NEAR.x + ((px - NEAR.x) / (d || 1e-9)) * isl.rad;
      HIT.y = NEAR.y + ((py - NEAR.y) / (d || 1e-9)) * isl.rad;
      HIT.kind = "edge";
    }
  }
  for (const g of lv.gates) {
    const hgt = gateHeight(g, gateT);
    if (hgt <= 0.002) continue;
    const reach = hgt >= BALL_R ? BALL_R : Math.sqrt(BALL_R * BALL_R - (BALL_R - hgt) * (BALL_R - hgt));
    NEAR.d2 = Infinity;
    segNearest(g.ax, g.ay, g.bx, g.by, px, py, NEAR);
    const d = Math.sqrt(NEAR.d2);
    const gap = d - GATE_T - reach;
    if (gap < HIT.gap) {
      HIT.gap = gap;
      HIT.x = NEAR.x + ((px - NEAR.x) / (d || 1e-9)) * GATE_T;
      HIT.y = NEAR.y + ((py - NEAR.y) / (d || 1e-9)) * GATE_T;
      HIT.kind = "gate";
    }
  }
  return HIT;
}

// One fixed physics step for the ball, shared by the game and the offline checks.
// b carries { x, y, vx, vy, idx } and is updated in place.
const STEP = { kind: "roll", x: 0, y: 0, hitKind: "", gap: 0, toward: 0, bump: 0, moved: 0 };
function simulateStep(lv, b, tiltX, tiltY, P, dt, gateT, tolerance) {
  let ax = tiltX;
  let ay = -tiltY;
  const mag = Math.hypot(ax, ay);
  if (mag > 1) {
    ax /= mag;
    ay /= mag;
  }
  const m = Math.min(1, mag);
  const shaped = m > 1e-4 ? Math.pow(m, 1.2) / m : 0;
  ax *= P.acc * shaped;
  ay *= P.acc * shaped;

  // Hole lip: once the centre is over the hole the ball tips toward its middle.
  const hx = lv.hole.x - b.x;
  const hy = lv.hole.y - b.y;
  const hd = Math.hypot(hx, hy);
  if (hd < lv.hole.r && hd > 1e-4) {
    const pull = 12 * (1 - hd / lv.hole.r) + 3;
    ax += (hx / hd) * pull;
    ay += (hy / hd) * pull;
  }

  let vx = b.vx + ax * dt;
  let vy = b.vy + ay * dt;
  let sp = Math.hypot(vx, vy);
  const dec = (P.roll + P.damp * sp) * dt;
  if (sp <= dec) {
    vx = 0;
    vy = 0;
    sp = 0;
  } else {
    const k = (sp - dec) / sp;
    vx *= k;
    vy *= k;
    sp -= dec;
  }
  if (sp > P.vmax) {
    vx *= P.vmax / sp;
    vy *= P.vmax / sp;
    sp = P.vmax;
  }

  const ox = b.x;
  const oy = b.y;
  let nx = ox + vx * dt;
  let ny = oy + vy * dt;
  let idx = nearestIndex(lv, nx, ny, b.idx);
  STEP.bump = 0;

  // Rubber start cup: bounce, never fail. Only inside the cup itself, i.e. when the
  // nearest centreline sample is the very start and the ball is behind it.
  const st = lv.start;
  if (idx <= 2) {
    const bx = nx - st.x;
    const by = ny - st.y;
    if (bx * Math.cos(st.h) + by * Math.sin(st.h) < 0) {
      const d = Math.hypot(bx, by);
      if (d > st.limit) {
        const ux = bx / d;
        const uy = by / d;
        nx = st.x + ux * st.limit;
        ny = st.y + uy * st.limit;
        const vn = vx * ux + vy * uy;
        if (vn > 0) {
          vx -= 1.35 * vn * ux;
          vy -= 1.35 * vn * uy;
          STEP.bump = vn;
        }
        idx = nearestIndex(lv, nx, ny, idx);
      }
    }
  }

  const hit = probe(lv, nx, ny, idx, gateT);
  if (hit.gap < -tolerance) {
    // Find the touching position along this step, then stop dead there.
    const kind = hit.kind;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const mx = lerp(ox, nx, mid);
      const my = lerp(oy, ny, mid);
      if (probe(lv, mx, my, nearestIndex(lv, mx, my, b.idx), gateT).gap < -tolerance) hi = mid;
      else lo = mid;
    }
    b.x = lerp(ox, nx, lo);
    b.y = lerp(oy, ny, lo);
    b.vx = 0;
    b.vy = 0;
    b.idx = nearestIndex(lv, b.x, b.y, b.idx);
    const h2 = probe(lv, b.x, b.y, b.idx, gateT);
    STEP.kind = "fail";
    STEP.x = h2.x;
    STEP.y = h2.y;
    STEP.hitKind = kind;
    STEP.moved = Math.hypot(b.x - ox, b.y - oy);
    return STEP;
  }

  b.x = nx;
  b.y = ny;
  b.vx = vx;
  b.vy = vy;
  b.idx = idx;
  STEP.moved = Math.hypot(nx - ox, ny - oy);
  STEP.gap = hit.gap;
  STEP.x = hit.x;
  STEP.y = hit.y;
  STEP.toward = sp > 0 ? ((hit.x - nx) * vx + (hit.y - ny) * vy) / (Math.hypot(hit.x - nx, hit.y - ny) || 1) : 0;
  const cd = Math.hypot(lv.hole.x - nx, lv.hole.y - ny);
  STEP.kind = cd < Math.max(lv.hole.r - BALL_R * 0.28, 0.2) ? "capture" : "roll";
  return STEP;
}

// ─────────────────────────────────────────────────────────── procedural textures (no canvas)

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function periodicNoise(seed, p) {
  const r = rng(seed);
  const g = new Float32Array(p * p);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % p) + p) % p;
    const y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * p + x0];
    const b = g[y0 * p + x1];
    const c = g[y1 * p + x0];
    const d = g[y1 * p + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbmField(size, seed, base, octaves) {
  const layers = [];
  for (let k = 0; k < octaves; k++) layers.push(periodicNoise(seed + k * 101, base << k));
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let tot = 0;
      for (let k = 0; k < octaves; k++) {
        const per = base << k;
        v += amp * layers[k]((x / size) * per, (y / size) * per);
        tot += amp;
        amp *= 0.5;
      }
      out[y * size + x] = v / tot;
    }
  }
  return out;
}

function grayTexture(size, seed, lo, hi, speck) {
  const f = fbmField(size, seed, 6, 4);
  const r = rng(seed ^ 0x9e3779b9);
  const d = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    let v = lerp(lo, hi, f[i]) + (r() - 0.5) * 0.05;
    if (speck && r() < speck) v *= r() < 0.6 ? 0.8 : 1.08;
    const b = clamp(v, 0, 1) * 255;
    d[i * 4] = b;
    d[i * 4 + 1] = b;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  return d;
}

function woodTexture(size, seed) {
  const warp = fbmField(size, seed, 4, 4);
  const fine = fbmField(size, seed + 7, 32, 2);
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = (y / size) * 16 + warp[i] * 2.4 + fine[i] * 0.35;
      let k = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      k = Math.pow(k, 2.2) * 0.6 + fine[i] * 0.4;
      const v = clamp(0.84 + k * 0.2, 0, 1) * 255;
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
  }
  return d;
}

function radialTexture(size) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - smooth01(r), 1.6) * 255;
      const i = (y * size + x) * 4;
      d[i] = a;
      d[i + 1] = a;
      d[i + 2] = a;
      d[i + 3] = 255;
    }
  }
  return d;
}

function ballTexture(w, h, seed) {
  const r = rng(seed);
  const d = new Uint8Array(w * h * 4);
  const streaks = [];
  for (let k = 0; k < 9; k++) streaks.push({ y: r() * h, a: 0.25 + r() * 0.35, wv: 0.6 + r() * 1.2 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0.5 + (r() - 0.5) * 0.08;
      for (const s of streaks) {
        const dd = Math.abs(y - s.y - Math.sin((x / w) * Math.PI * 2) * 3);
        if (dd < s.wv) v += s.a * (1 - dd / s.wv);
      }
      if (r() < 0.0015) v = 1;
      const b = clamp(v, 0, 1) * 255;
      const i = (y * w + x) * 4;
      d[i] = 255;
      d[i + 1] = b;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  return d;
}

// ─────────────────────────────────────────────────────────── finishes

const FINISHES = {
  graphite: {
    bg: 0x111214,
    plate: 0x2c2e32,
    plateMetal: 0.35,
    plateRough: 0.6,
    plateTex: "grain",
    base: 0x7c8b95,
    glassTint: 0xd2efe6,
    trailAdd: false,
    rail: 0xc9a66b,
    mark: 0xdfeaf0,
    rubber: 0x1b1a19,
    gate: 0xb8bec5,
    envRoom: 0x57524b,
    envGround: 0xb9b0a1,
    aoAlpha: 0.42,
    ui: { ink: "#ece6da", dim: "rgba(236,230,218,0.52)", line: "rgba(236,230,218,0.2)", accent: "#c9a66b", card: "rgba(19,19,21,0.74)", veil: "#111214", danger: "#ff6a45" }
  },
  walnut: {
    bg: 0x1a120c,
    plate: 0x4f3221,
    plateMetal: 0.0,
    plateRough: 0.55,
    plateTex: "wood",
    base: 0xcdbfa4,
    glassTint: 0xe6efd8,
    trailAdd: false,
    rail: 0xd4ae6f,
    mark: 0xf1e6d2,
    rubber: 0x221a14,
    gate: 0xc5c9cd,
    envRoom: 0x5a4a3c,
    envGround: 0xc4b59c,
    aoAlpha: 0.38,
    ui: { ink: "#f4ecde", dim: "rgba(244,236,222,0.55)", line: "rgba(244,236,222,0.22)", accent: "#d6b06f", card: "rgba(30,21,15,0.76)", veil: "#1a120c", danger: "#ff6a45" }
  },
  porcelain: {
    bg: 0xd4d0c9,
    plate: 0xeeebe5,
    plateMetal: 0.0,
    plateRough: 0.34,
    plateTex: "grain",
    base: 0x8d9ca6,
    glassTint: 0xd8efea,
    trailAdd: false,
    rail: 0x9ea6ae,
    mark: 0xf4f7f8,
    rubber: 0x2a2b2c,
    gate: 0x8d959c,
    envRoom: 0x9a958d,
    envGround: 0x8d9397,
    aoAlpha: 0.32,
    ui: { ink: "#27292b", dim: "rgba(39,41,43,0.55)", line: "rgba(39,41,43,0.2)", accent: "#8a6b3c", card: "rgba(250,249,246,0.8)", veil: "#d4d0c9", danger: "#d94a2b" }
  }
};

// ─────────────────────────────────────────────────────────── 3D world

function createWorld(THREE, renderer, finish) {
  const disposables = [];
  const keep = x => {
    disposables.push(x);
    return x;
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(finish.bg);

  // Procedural studio environment for reflections (Z is up throughout).
  const envScene = new THREE.Scene();
  const envMats = [];
  const envGeos = [];
  const envMesh = (geo, mat) => {
    envGeos.push(geo);
    envMats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    envScene.add(m);
    return m;
  };
  envMesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial({ color: finish.envRoom, side: THREE.BackSide }));
  envMesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: finish.envGround })).position.z = -3;
  const panel = (w, h, hex, k, x, y, z) => {
    const m = envMesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    return m;
  };
  const ceiling = panel(26, 26, 0xf4efe6, 1.15, 0, 0, 16);
  panel(12, 7, 0xffffff, 7, -5, 6, 14);
  panel(3, 16, 0xffe9cf, 2.6, 13, -1, 7);
  panel(16, 2.4, 0xd8e4ff, 1.8, 0, -14, 6);
  panel(4, 4, 0xffffff, 2.6, 7, 10, 12);
  // The board and glass reflect discrete softboxes; the steel ball also sees a bright ceiling.
  const pmrem = new THREE.PMREMGenerator(renderer);
  ceiling.visible = false;
  const envRT = pmrem.fromScene(envScene, 0.03);
  ceiling.visible = true;
  const ballEnvRT = pmrem.fromScene(envScene, 0.03);
  pmrem.dispose();
  keep(ballEnvRT);
  envGeos.forEach(g => g.dispose());
  envMats.forEach(m => m.dispose());
  keep(envRT);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.5, 120);

  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x2a2622, 0.55);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2e0, 2.3);
  key.position.set(-4, 5, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -11;
  sc.right = 11;
  sc.top = 11;
  sc.bottom = -11;
  sc.near = 1;
  sc.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xdce6ff, 0.35);
  fill.position.set(6, -7, 8);
  scene.add(fill);

  const tex = (data, w, h, srgb, repeat) => {
    const t = keep(new THREE.DataTexture(data, w, h, THREE.RGBAFormat));
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    return t;
  };

  const plateData = finish.plateTex === "wood" ? woodTexture(256, 11) : grayTexture(256, 5, 0.88, 1.0, 0);
  const plateMap = tex(plateData, 256, 256, true, finish.plateTex === "wood" ? 1 / 9 : 1 / 3);
  const plateBump = tex(plateData, 256, 256, false, finish.plateTex === "wood" ? 1 / 9 : 1 / 3);
  const floorData = grayTexture(256, 23, 0.91, 1.0, 0.006);
  const floorMap = tex(floorData, 256, 256, true, 1 / 4);
  const floorBump = tex(floorData, 256, 256, false, 1 / 4);
  const radial = tex(radialTexture(64), 64, 64, false);
  radial.wrapS = radial.wrapT = THREE.ClampToEdgeWrapping;
  const ballRough = tex(ballTexture(256, 128, 3), 256, 128, false);

  const mats = {
    plate: keep(new THREE.MeshStandardMaterial({ color: finish.plate, metalness: finish.plateMetal, roughness: finish.plateRough, map: plateMap, bumpMap: plateBump, bumpScale: 0.9, envMapIntensity: 0.42 })),
    wall: keep(new THREE.MeshStandardMaterial({ color: finish.rail, metalness: 1, roughness: 0.34, envMapIntensity: 1.1 })),
    rail: keep(new THREE.MeshStandardMaterial({ color: finish.rail, metalness: 1, roughness: 0.26, envMapIntensity: 1.25 })),
    base: keep(new THREE.MeshStandardMaterial({ color: finish.base, metalness: 0, roughness: 0.82, map: floorMap, bumpMap: floorBump, bumpScale: 0.5, envMapIntensity: 0.3 })),
    // The path itself: a clear, slightly green-tinted glass plate with real refraction.
    glass: keep(new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.03,
      transmission: 1,
      thickness: GLASS_T * 1.6,
      ior: 1.52,
      attenuationColor: new THREE.Color(finish.glassTint),
      attenuationDistance: 0.55,
      specularIntensity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.35
    })),
    glint: keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    // Broken glass shows its green edge; strong reflections make fragments glint as they tumble.
    shard: keep(new THREE.MeshStandardMaterial({ color: 0x8fcfc4, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.88, envMapIntensity: 2.6, side: THREE.DoubleSide, depthWrite: false })),
    crack: keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })),
    crackGlow: keep(new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })),
    frost: keep(new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: radial, transparent: true, opacity: 0.6, depthWrite: false })),
    ball: keep(new THREE.MeshStandardMaterial({ color: 0xf4f5f7, metalness: 1, roughness: 0.16, roughnessMap: ballRough, envMap: ballEnvRT.texture, envMapIntensity: 1.45 })),
    holeWall: keep(new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, side: THREE.BackSide, vertexColors: true })),
    holeBottom: keep(new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1 })),
    rubber: keep(new THREE.MeshStandardMaterial({ color: finish.rubber, roughness: 0.62, metalness: 0 })),
    gate: keep(new THREE.MeshStandardMaterial({ color: finish.gate, metalness: 1, roughness: 0.3, envMapIntensity: 1.1 })),
    slot: keep(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })),
    mark: keep(new THREE.MeshBasicMaterial({ color: finish.mark, transparent: true, opacity: 0.38, depthWrite: false })),
    ao: keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })),
    shadow: keep(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: radial, transparent: true, opacity: 0.3, depthWrite: false })),
    flash: keep(new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
  };

  const ballGeo = keep(new THREE.SphereGeometry(BALL_R, 64, 40));
  const ball = new THREE.Mesh(ballGeo, mats.ball);
  ball.castShadow = true;
  scene.add(ball);
  const contact = new THREE.Mesh(keep(new THREE.PlaneGeometry(BALL_R * 3.1, BALL_R * 3.1)), mats.shadow);
  contact.renderOrder = 2;
  scene.add(contact);
  const flash = new THREE.Mesh(keep(new THREE.RingGeometry(0.07, 0.12, 40)), mats.flash);
  flash.renderOrder = 3;
  scene.add(flash);
  const flashLight = new THREE.PointLight(0xd6f2ff, 0, 2.6, 2);
  scene.add(flashLight);
  // Soft blue light that travels with the ball while it rolls.
  const glow = new THREE.PointLight(0x2f9bff, 0, 2.2, 2);
  scene.add(glow);

  let level = null;
  const V2 = (x, y) => new THREE.Vector2(x, y);

  // Ribbon along a closed polygon: rail line on the plate side, AO on the channel side.
  function polyNormals(pts) {
    const n = pts.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      out[i] = [-dy / l, dx / l];
    }
    return out;
  }

  function ribbon(pts, normals, d0, d1, z, rgba0, rgba1) {
    const n = pts.length;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const col = rgba0 ? new Float32Array((n + 1) * 2 * 4) : null;
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      const p = pts[i];
      const q = normals[i];
      pos.set([p[0] + q[0] * d0, p[1] + q[1] * d0, z, p[0] + q[0] * d1, p[1] + q[1] * d1, z], k * 6);
      if (col) col.set([...rgba0, ...rgba1], k * 8);
    }
    const idx = [];
    for (let k = 0; k < n; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function stadium(ax, ay, bx, by, r, segs) {
    const ang = Math.atan2(by - ay, bx - ax);
    const pts = [];
    arcPoints(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2, segs, pts);
    arcPoints(ax, ay, r, ang + Math.PI / 2, ang + Math.PI * 1.5, segs, pts);
    return pts;
  }

  function setLevel(lv) {
    clearFx();
    trailClear();
    if (level) {
      scene.remove(level.group);
      level.geos.forEach(g => g.dispose());
    }
    const group = new THREE.Group();
    const geos = [];
    const add = (geo, mat, opts) => {
      geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      if (opts && opts.cast) m.castShadow = true;
      if (opts && opts.receive) m.receiveShadow = true;
      if (opts && opts.order) m.renderOrder = opts.order;
      group.add(m);
      return m;
    };

    // Carved plate: a solid slab with the route cut out.
    const slab = new THREE.Shape([V2(-16, -22), V2(16, -22), V2(16, 22), V2(-16, 22)]);
    slab.holes.push(new THREE.Path(lv.outline.map(p => V2(p[0], p[1]))));
    add(new THREE.ExtrudeGeometry(slab, { depth: PLATE_H, bevelEnabled: false, curveSegments: 1 }), [mats.plate, mats.wall], { cast: true, receive: true });

    // Base under the glass, with the destination hole.
    const baseShape = new THREE.Shape([V2(-16, -22), V2(16, -22), V2(16, 22), V2(-16, 22)]);
    const hp = new THREE.Path();
    hp.absarc(lv.hole.x, lv.hole.y, lv.hole.r, 0, Math.PI * 2, true);
    baseShape.holes.push(hp);
    add(new THREE.ShapeGeometry(baseShape, 48), mats.base, { receive: true }).position.z = -GLASS_T;

    // The glass path: a plate exactly the shape of the route, its top is what the ball rolls on.
    const glassShape = new THREE.Shape(lv.outline.map(p => V2(p[0], p[1])));
    const gh = new THREE.Path();
    gh.absarc(lv.hole.x, lv.hole.y, lv.hole.r, 0, Math.PI * 2, true);
    glassShape.holes.push(gh);
    add(new THREE.ExtrudeGeometry(glassShape, { depth: GLASS_T, bevelEnabled: false, curveSegments: 48 }), mats.glass).position.z = -GLASS_T;

    const routeN = polyNormals(lv.outline);
    add(ribbon(lv.outline, routeN, 0, 0.05, PLATE_H + 0.002), mats.rail);
    const ao = finish.aoAlpha;
    add(ribbon(lv.outline, routeN, 0, -0.3, 0.003, [0, 0, 0, ao * 0.7], [0, 0, 0, 0]), mats.ao, { order: 1 });
    // Glass edges catch light where the plate meets the wall.
    add(ribbon(lv.outline, routeN, 0, -0.035, 0.004, [0.55, 0.85, 0.8, 0.55], [0.55, 0.85, 0.8, 0]), mats.glint, { order: 2 });

    for (const isl of lv.islands) {
      const shape = new THREE.Shape(isl.outline.map(p => V2(p[0], p[1])));
      add(new THREE.ExtrudeGeometry(shape, { depth: PLATE_H, bevelEnabled: false, curveSegments: 1 }), [mats.plate, mats.wall], { cast: true, receive: true });
      const nrm = polyNormals(isl.outline);
      add(ribbon(isl.outline, nrm, 0, 0.05, PLATE_H + 0.002), mats.rail);
      add(ribbon(isl.outline, nrm, 0, -0.26, 0.003, [0, 0, 0, ao * 0.7], [0, 0, 0, 0]), mats.ao, { order: 1 });
      add(ribbon(isl.outline, nrm, 0, -0.035, 0.004, [0.55, 0.85, 0.8, 0.55], [0.55, 0.85, 0.8, 0]), mats.glint, { order: 2 });
    }

    // Destination hole: dark bore, floor, brass grommet.
    const boreH = HOLE_DEPTH - GLASS_T;
    const cyl = new THREE.CylinderGeometry(lv.hole.r, lv.hole.r, boreH, 56, 6, true);
    cyl.rotateX(Math.PI / 2);
    const cp = cyl.attributes.position;
    const cc = new Float32Array(cp.count * 3);
    for (let i = 0; i < cp.count; i++) {
      const k = clamp((cp.getZ(i) + boreH / 2) / boreH, 0, 1);
      const v = 0.06 + 0.94 * k * k;
      cc[i * 3] = v;
      cc[i * 3 + 1] = v;
      cc[i * 3 + 2] = v;
    }
    cyl.setAttribute("color", new THREE.BufferAttribute(cc, 3));
    add(cyl, mats.holeWall).position.set(lv.hole.x, lv.hole.y, -GLASS_T - boreH / 2);
    add(new THREE.CircleGeometry(lv.hole.r, 48), mats.holeBottom).position.set(lv.hole.x, lv.hole.y, -HOLE_DEPTH + 0.001);
    const rim = add(new THREE.TorusGeometry(lv.hole.r + 0.014, 0.026, 10, 72), mats.rail, { cast: true });
    rim.position.set(lv.hole.x, lv.hole.y, -0.004);

    // Start cup: rubber bumper behind the ball and an engraved ring.
    const bump = add(new THREE.TorusGeometry(lv.start.w - BUMPER_T, BUMPER_T, 12, 48, Math.PI), mats.rubber, { cast: true, receive: true });
    bump.position.set(lv.start.x, lv.start.y, BUMPER_T);
    bump.rotation.z = lv.start.h + Math.PI / 2;
    add(new THREE.RingGeometry(BALL_R * 1.34, BALL_R * 1.34 + 0.024, 64), mats.mark, { order: 1 }).position.set(lv.start.x, lv.start.y, 0.002);

    // Pop-up gates rise from slots in the floor.
    const gates = [];
    for (const g of lv.gates) {
      add(new THREE.ShapeGeometry(new THREE.Shape(stadium(g.ax, g.ay, g.bx, g.by, GATE_T + 0.03, 10).map(p => V2(p[0], p[1])))), mats.slot, { order: 1 }).position.z = 0.0015;
      const bar = add(new THREE.ExtrudeGeometry(new THREE.Shape(stadium(g.ax, g.ay, g.bx, g.by, GATE_T, 10).map(p => V2(p[0], p[1]))), { depth: GATE_H, bevelEnabled: false, curveSegments: 1 }), mats.gate, { cast: true });
      bar.position.z = -GATE_H - 0.02;
      gates.push({ g, mesh: bar });
    }

    scene.add(group);
    level = { lv, group, geos, gates };
  }

  function updateGates(t) {
    if (!level) return;
    for (const it of level.gates) {
      const h = gateHeight(it.g, t);
      it.mesh.position.z = h - GATE_H;
    }
  }

  // ── blue glowing trail: a vivid blue line with a soft light halo, fading with age.
  // Each layer is a 5-column ribbon (transparent edges, strong centre).
  const TRAIL_COLS = [-1, -0.5, 0, 0.5, 1];
  const trailLayers = [
    // halo: wide, soft blue light around the line
    { width: 0.52, alpha: [0, 0.2, 0.38, 0.2, 0], rgb: [[0.12, 0.5, 1], [0.12, 0.5, 1], [0.2, 0.6, 1], [0.12, 0.5, 1], [0.12, 0.5, 1]], blending: finish.trailAdd ? THREE.AdditiveBlending : THREE.NormalBlending, scale: 1 },
    // line: saturated blue with a brighter cyan centre
    { width: 0.14, alpha: [0, 0.9, 1, 0.9, 0], rgb: [[0.0, 0.36, 1], [0.02, 0.45, 1], [0.42, 0.82, 1], [0.02, 0.45, 1], [0.0, 0.36, 1]], blending: THREE.NormalBlending, scale: 1 }
  ];
  const trailIdx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    for (let c = 0; c < 4; c++) {
      const a = i * 5 + c;
      trailIdx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
    }
  }
  for (const layer of trailLayers) {
    layer.pos = new Float32Array(TRAIL_MAX * 5 * 3);
    layer.col = new Float32Array(TRAIL_MAX * 5 * 4);
    layer.geo = keep(new THREE.BufferGeometry());
    layer.geo.setAttribute("position", new THREE.BufferAttribute(layer.pos, 3).setUsage(THREE.DynamicDrawUsage));
    layer.geo.setAttribute("color", new THREE.BufferAttribute(layer.col, 4).setUsage(THREE.DynamicDrawUsage));
    layer.geo.setIndex(trailIdx);
    layer.geo.setDrawRange(0, 0);
    const mat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: layer.blending }));
    const mesh = new THREE.Mesh(layer.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    scene.add(mesh);
  }
  const trailPts = [];

  function trailPush(x, y, t) {
    const last = trailPts[trailPts.length - 1];
    if (last && (x - last.x) * (x - last.x) + (y - last.y) * (y - last.y) < 0.0009) return;
    trailPts.push({ x, y, t });
    if (trailPts.length > TRAIL_MAX - 1) trailPts.shift();
  }

  function trailClear() {
    trailPts.length = 0;
    for (const layer of trailLayers) layer.geo.setDrawRange(0, 0);
  }

  function trailUpdate(t, headX, headY, live) {
    while (trailPts.length && t - trailPts[0].t > TRAIL_LIFE) trailPts.shift();
    const n = trailPts.length + (live && trailPts.length ? 1 : 0);
    if (n < 2) {
      for (const layer of trailLayers) layer.geo.setDrawRange(0, 0);
      return;
    }
    const at = i => (i < trailPts.length ? trailPts[i] : { x: headX, y: headY, t });
    for (let i = 0; i < n; i++) {
      const p = at(i);
      const a = at(Math.max(0, i - 1));
      const b = at(Math.min(n - 1, i + 1));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const px = -dy / l;
      const py = dx / l;
      const f = i / (n - 1);
      const life = 1 - clamp((t - p.t) / TRAIL_LIFE, 0, 1);
      const k = Math.pow(life, 0.7) * (0.3 + 0.7 * Math.pow(f, 0.7));
      const taper = 0.45 + 0.55 * Math.pow(f, 0.5);
      for (const layer of trailLayers) {
        const half = (layer.width / 2) * taper;
        for (let c = 0; c < 5; c++) {
          const off = TRAIL_COLS[c] * half;
          const v = (i * 5 + c) * 3;
          layer.pos[v] = p.x + px * off;
          layer.pos[v + 1] = p.y + py * off;
          layer.pos[v + 2] = 0.006;
          const q = (i * 5 + c) * 4;
          const rgb = layer.rgb[c];
          layer.col[q] = rgb[0];
          layer.col[q + 1] = rgb[1];
          layer.col[q + 2] = rgb[2];
          layer.col[q + 3] = layer.alpha[c] * k * layer.scale;
        }
      }
    }
    for (const layer of trailLayers) {
      layer.geo.attributes.position.needsUpdate = true;
      layer.geo.attributes.color.needsUpdate = true;
      layer.geo.setDrawRange(0, (n - 1) * 24);
    }
  }

  // ── glass shatter: spider-web cracks spreading from the impact, crushed glass, flying shards.
  const fx = { group: null, geos: [], cracks: [], frost: null, shards: [], shardGeo: null, t: 0 };

  function clearFx() {
    if (fx.group) scene.remove(fx.group);
    fx.geos.forEach(g => g.dispose());
    fx.group = null;
    fx.geos = [];
    fx.cracks = [];
    fx.shards = [];
    fx.frost = null;
    fx.shardGeo = null;
  }

  function shatter(hx, hy, ux, uy, hint, gateT) {
    clearFx();
    if (!level) return;
    const lv = level.lv;
    const rnd = rng(((hx * 1000) | 0) * 73856093 ^ ((hy * 1000) | 0) * 19349663);
    const inside = (x, y) => {
      if (Math.hypot(x - lv.hole.x, y - lv.hole.y) < lv.hole.r) return false;
      const i = nearestIndex(lv, x, y, hint);
      return probe(lv, x, y, i, gateT).gap + BALL_R > 0.012;
    };
    const segs = [];
    const radials = [];
    const walk = (x, y, ang, maxLen, depth) => {
      const pts = [[x, y]];
      let len = 0;
      while (len < maxLen) {
        const step = 0.035 + rnd() * 0.05;
        ang += (rnd() - 0.5) * 0.42;
        let nx = x + Math.cos(ang) * step;
        let ny = y + Math.sin(ang) * step;
        if (!inside(nx, ny)) {
          // Long cracks run along the plate: deflect off the edge rather than end there.
          if (maxLen < 1.6 || rnd() < 0.25) break;
          let turned = false;
          for (const d of [0.7, -0.7, 1.3, -1.3]) {
            const a2 = ang + d;
            if (inside(x + Math.cos(a2) * step, y + Math.sin(a2) * step)) {
              ang = a2;
              nx = x + Math.cos(ang) * step;
              ny = y + Math.sin(ang) * step;
              turned = true;
              break;
            }
          }
          if (!turned) break;
        }
        segs.push([x, y, nx, ny]);
        x = nx;
        y = ny;
        len += step;
        pts.push([x, y]);
        if (depth < 2 && rnd() < 0.05) walk(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.5), maxLen * (0.25 + rnd() * 0.35), depth + 1);
      }
      return pts;
    };
    const base = Math.atan2(uy, ux);
    const count = 11 + Math.floor(rnd() * 5);
    for (let k = 0; k < count; k++) {
      const spread = (k / (count - 1) - 0.5) * 3.0;
      const ang = base + spread + (rnd() - 0.5) * 0.18;
      const long = rnd() < 0.4;
      radials.push(walk(hx + ux * 0.012, hy + uy * 0.012, ang, long ? 2.4 + rnd() * 3.2 : 0.5 + rnd() * 1.3, 0));
    }
    // Concentric rings between neighbouring radials make the spider web.
    const pointAt = (pts, r) => {
      for (const p of pts) if (Math.hypot(p[0] - hx, p[1] - hy) >= r) return p;
      return null;
    };
    for (const r of [0.14, 0.32, 0.56, 0.86]) {
      for (let k = 0; k < radials.length - 1; k++) {
        if (rnd() < 0.28) continue;
        const a = pointAt(radials[k], r * (0.85 + rnd() * 0.3));
        const b = pointAt(radials[k + 1], r * (0.85 + rnd() * 0.3));
        if (!a || !b) continue;
        const mx = (a[0] + b[0]) / 2 + (rnd() - 0.5) * 0.04;
        const my = (a[1] + b[1]) / 2 + (rnd() - 0.5) * 0.04;
        if (!inside(mx, my)) continue;
        segs.push([a[0], a[1], mx, my], [mx, my, b[0], b[1]]);
      }
    }
    // Reveal outward from the impact, like a crack racing through the plate.
    segs.sort((p, q) => Math.hypot(p[0] - hx, p[1] - hy) - Math.hypot(q[0] - hx, q[1] - hy));
    fx.group = new THREE.Group();
    // Cracks are thin quads (a sharp core plus a faint halo) so they stay visible on dense screens.
    const quads = (half, z) => {
      const arr = new Float32Array(segs.length * 18);
      segs.forEach((g, i) => {
        const dx = g[2] - g[0];
        const dy = g[3] - g[1];
        const l = Math.hypot(dx, dy) || 1;
        const w = half * (0.6 + 0.4 * clamp(1 - Math.hypot(g[0] - hx, g[1] - hy) / 3, 0, 1));
        const ox = (-dy / l) * w;
        const oy = (dx / l) * w;
        arr.set([g[0] - ox, g[1] - oy, z, g[2] - ox, g[3] - oy, z, g[2] + ox, g[3] + oy, z, g[0] - ox, g[1] - oy, z, g[2] + ox, g[3] + oy, z, g[0] + ox, g[1] + oy, z], i * 18);
      });
      return arr;
    };
    for (const [arr, mat] of [[quads(0.028, 0.0045), mats.crackGlow], [quads(0.0075, 0.005), mats.crack]]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      geo.setDrawRange(0, 0);
      fx.geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      fx.group.add(mesh);
      fx.cracks.push({ geo, count: segs.length * 6 });
    }
    const frostGeo = new THREE.CircleGeometry(0.34, 32);
    fx.geos.push(frostGeo);
    fx.frost = new THREE.Mesh(frostGeo, mats.frost);
    fx.frost.position.set(hx + ux * 0.08, hy + uy * 0.08, 0.005);
    fx.frost.renderOrder = 5;
    fx.group.add(fx.frost);

    // Shards: small triangles knocked out of the plate near the impact.
    const SH = 46;
    const sPos = new Float32Array(SH * 9);
    const sNrm = new Float32Array(SH * 9);
    fx.shardGeo = new THREE.BufferGeometry();
    fx.shardGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
    fx.shardGeo.setAttribute("normal", new THREE.BufferAttribute(sNrm, 3).setUsage(THREE.DynamicDrawUsage));
    fx.geos.push(fx.shardGeo);
    const shardMesh = new THREE.Mesh(fx.shardGeo, mats.shard);
    shardMesh.frustumCulled = false;
    shardMesh.renderOrder = 6;
    fx.group.add(shardMesh);
    const tx = -uy;
    const ty = ux;
    for (let i = 0; i < SH; i++) {
      const out = 0.12 + rnd() * 0.5;
      const side = (rnd() - 0.5) * 0.9;
      const dir = (rnd() - 0.5) * 1.6;
      const speed = 0.5 + rnd() * 2.2;
      const verts = [];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + (rnd() - 0.5) * 1.4;
        const r = 0.04 + rnd() * 0.11;
        verts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (rnd() - 0.5) * 0.01));
      }
      fx.shards.push({
        p: new THREE.Vector3(hx + ux * out + tx * side, hy + uy * out + ty * side, 0.02 + rnd() * 0.05),
        v: new THREE.Vector3((ux + tx * dir) * speed, (uy + ty * dir) * speed, 0.8 + rnd() * 2.6),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
        w: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(4 + rnd() * 12),
        verts,
        rest: false
      });
    }
    fx.t = 0;
    scene.add(fx.group);
    writeShards();
  }

  const tmpV = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  function writeShards() {
    const pos = fx.shardGeo.attributes.position.array;
    const nrm = fx.shardGeo.attributes.normal.array;
    fx.shards.forEach((sh, i) => {
      const w = [];
      for (let k = 0; k < 3; k++) {
        tmpV.copy(sh.verts[k]).applyQuaternion(sh.q).add(sh.p);
        pos[i * 9 + k * 3] = tmpV.x;
        pos[i * 9 + k * 3 + 1] = tmpV.y;
        pos[i * 9 + k * 3 + 2] = tmpV.z;
        w.push(tmpV.clone());
      }
      tmpA.subVectors(w[1], w[0]);
      tmpB.subVectors(w[2], w[0]);
      tmpA.cross(tmpB).normalize();
      for (let k = 0; k < 3; k++) nrm.set([tmpA.x, tmpA.y, tmpA.z], i * 9 + k * 3);
    });
    fx.shardGeo.attributes.position.needsUpdate = true;
    fx.shardGeo.attributes.normal.needsUpdate = true;
  }

  function updateFx(dt) {
    if (!fx.group) return;
    fx.t += dt;
    const reveal = clamp(fx.t / 0.22, 0, 1);
    for (const c of fx.cracks) c.geo.setDrawRange(0, Math.floor((c.count * smooth01(reveal)) / 6) * 6);
    const fs = 0.3 + 0.7 * smooth01(clamp(fx.t / 0.12, 0, 1));
    fx.frost.scale.set(fs, fs, 1);
    let moving = false;
    for (const sh of fx.shards) {
      if (sh.rest) continue;
      moving = true;
      sh.v.z -= 16 * dt;
      sh.p.addScaledVector(sh.v, dt);
      tmpQ.setFromAxisAngle(tmpV.copy(sh.w).normalize(), sh.w.length() * dt);
      sh.q.premultiply(tmpQ);
      if (sh.p.z < 0.012) {
        sh.p.z = 0.012;
        if (Math.abs(sh.v.z) < 0.4) {
          sh.rest = true;
        } else {
          sh.v.z = -sh.v.z * 0.28;
          sh.v.x *= 0.5;
          sh.v.y *= 0.5;
          sh.w.multiplyScalar(0.5);
        }
      }
    }
    if (moving) writeShards();
  }

  function fit(width, height, safe) {
    camera.aspect = width / height;
    camera.fov = CAM_FOV;
    camera.updateProjectionMatrix();
    const top = (safe.top || 0) + 68;
    const bottom = (safe.bottom || 0) + 18;
    const side = 10;
    const ny1 = 1 - (2 * top) / height;
    const ny0 = -1 + (2 * bottom) / height;
    const nx1 = 1 - (2 * side) / width;
    const nx0 = -nx1;
    const corners = [];
    for (const x of [REGION.x0, REGION.x1]) for (const y of [REGION.y0, REGION.y1]) for (const z of [0, PLATE_H]) corners.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    let dist = 34;
    let cy = 0;
    for (let it = 0; it < 40; it++) {
      camera.position.set(0, cy - dist * Math.sin(CAM_TILT), dist * Math.cos(CAM_TILT));
      camera.lookAt(0, cy, 0);
      camera.updateMatrixWorld(true);
      let mnx = Infinity;
      let mxx = -Infinity;
      let mny = Infinity;
      let mxy = -Infinity;
      for (const c of corners) {
        v.copy(c).project(camera);
        mnx = Math.min(mnx, v.x);
        mxx = Math.max(mxx, v.x);
        mny = Math.min(mny, v.y);
        mxy = Math.max(mxy, v.y);
      }
      const s = Math.max((mxx - mnx) / (nx1 - nx0), (mxy - mny) / (ny1 - ny0));
      dist *= Math.pow(s, 0.9);
      const worldPerNdc = (REGION.y1 - REGION.y0) / Math.max(1e-3, mxy - mny);
      cy += ((mxy + mny) / 2 - (ny1 + ny0) / 2) * worldPerNdc * 0.8;
    }
    camera.position.set(0, cy - dist * Math.sin(CAM_TILT), dist * Math.cos(CAM_TILT));
    camera.lookAt(0, cy, 0);
    camera.updateMatrixWorld(true);
  }

  function dispose() {
    clearFx();
    if (level) {
      scene.remove(level.group);
      level.geos.forEach(g => g.dispose());
      level = null;
    }
    disposables.forEach(d => d.dispose && d.dispose());
  }

  return { scene, camera, ball, contact, flash, flashLight, glow, mats, setLevel, updateGates, fit, dispose, trailPush, trailClear, trailUpdate, shatter, clearFx, updateFx };
}

// ─────────────────────────────────────────────────────────── sound

function createSound() {
  let ac = null;
  let out = null;
  let roll = null;
  let noise = null;
  let volume = 0.7;

  function ensure() {
    if (ac) {
      if (ac.state === "suspended") ac.resume().catch(() => {});
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ac = new AC();
    } catch (e) {
      ac = null;
      return false;
    }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ac.destination);
    out = ac.createGain();
    out.gain.value = volume;
    out.connect(comp);
    const len = Math.floor(ac.sampleRate * 2);
    noise = ac.createBuffer(1, len, ac.sampleRate);
    const ch = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      ch[i] = last * 3.4;
    }
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 38;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 200;
    lp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.value = 0;
    const lfo = ac.createOscillator();
    lfo.type = "triangle";
    lfo.frequency.value = 5;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(out);
    src.start();
    lfo.start();
    roll = { g, lp, lfo, lfoGain };
    return true;
  }

  function setVolume(v) {
    volume = v;
    if (out) out.gain.setTargetAtTime(v, ac.currentTime, 0.05);
  }

  function setRoll(speed, near) {
    if (!roll) return;
    const t = ac.currentTime;
    const gain = 0.62 * Math.pow(clamp(speed, 0, 1), 1.25);
    roll.g.gain.setTargetAtTime(gain, t, 0.06);
    roll.lfoGain.gain.setTargetAtTime(gain * 0.22, t, 0.06);
    roll.lfo.frequency.setTargetAtTime(3 + 16 * speed, t, 0.1);
    roll.lp.frequency.setTargetAtTime(150 + 650 * speed + 900 * near * speed, t, 0.06);
  }

  function env(node, t0, peak, attack, decay) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function tone(freq, peak, decay, at = 0, type = "sine", glideTo) {
    if (!ac) return;
    const t0 = ac.currentTime + at;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + decay);
    const g = ac.createGain();
    env(g, t0, peak, 0.004, decay);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }

  function burst(freq, q, peak, decay, at = 0, type = "bandpass") {
    if (!ac) return;
    const t0 = ac.currentTime + at;
    const s = ac.createBufferSource();
    s.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    env(g, t0, peak, 0.002, decay);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    s.start(t0, Math.random());
    s.stop(t0 + decay + 0.05);
  }

  return {
    ensure,
    setVolume,
    setRoll,
    tick() {
      burst(2600, 3, 0.09, 0.025);
    },
    shatter() {
      if (!ac) return;
      burst(5200, 0.7, 0.55, 0.06, 0, "highpass");
      burst(2800, 1.1, 0.32, 0.14);
      tone(170, 0.32, 0.09, 0, "sine", 90);
      for (let i = 0; i < 18; i++) {
        const at = 0.015 + Math.pow(Math.random(), 1.7) * 0.8;
        tone(2300 + Math.random() * 5400, 0.025 + Math.random() * 0.06, 0.05 + Math.random() * 0.18, at, i % 3 ? "sine" : "triangle");
      }
      for (let i = 0; i < 7; i++) burst(3800 + Math.random() * 3600, 4, 0.04 + Math.random() * 0.05, 0.03, 0.04 + Math.random() * 0.55);
    },
    thud(k) {
      tone(110, 0.18 * k + 0.05, 0.12, 0, "sine", 70);
      burst(500, 1, 0.08 * k + 0.02, 0.05, 0, "lowpass");
    },
    land() {
      tone(96, 0.6, 0.28, 0, "sine", 52);
      burst(900, 1.4, 0.32, 0.06);
      tone(640, 0.06, 0.12, 0, "triangle");
      burst(1100, 1.6, 0.12, 0.04, 0.11);
      tone(84, 0.18, 0.12, 0.11, "sine", 60);
    },
    chime() {
      tone(659.25, 0.1, 1.3, 0.05);
      tone(1318.5, 0.025, 0.9, 0.05);
      tone(987.77, 0.09, 1.5, 0.15);
      tone(1975.5, 0.02, 1.0, 0.15);
    },
    click() {
      burst(4200, 2, 0.05, 0.015);
    },
    close() {
      if (ac) ac.close().catch(() => {});
      ac = null;
    }
  };
}

// ─────────────────────────────────────────────────────────── UI

const CSS = `
.gr{position:absolute;inset:0;overflow:hidden;color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.gr *{box-sizing:border-box}
.gr-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 52%,transparent 55%,rgba(0,0,0,.34) 100%)}
.gr-top{position:absolute;left:18px;right:18px;top:calc(var(--sat) + 12px);display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.gr-level{pointer-events:auto;appearance:none;background:none;border:0;padding:8px 8px 8px 0;margin:0;color:var(--ink);display:flex;align-items:baseline;gap:10px;cursor:pointer;font:inherit}
.gr-lvnum{font-weight:600;font-size:12px;letter-spacing:.3em}
.gr-lvname{font-weight:400;font-size:10px;letter-spacing:.24em;color:var(--dim)}
.gr-bubble{position:relative;width:28px;height:28px;border-radius:50%;border:1px solid var(--line);transition:border-color .3s}
.gr-bubble.set{border-color:var(--accent)}
.gr-bubble:before,.gr-bubble:after{content:"";position:absolute;background:var(--line)}
.gr-bubble:before{left:50%;top:6px;bottom:6px;width:1px;margin-left:-.5px}
.gr-bubble:after{top:50%;left:6px;right:6px;height:1px;margin-top:-.5px}
.gr-dot{position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px;border-radius:50%;background:var(--accent);box-shadow:0 0 6px rgba(0,0,0,.25);will-change:transform}
.gr-prog{position:absolute;left:18px;right:18px;top:calc(var(--sat) + 52px);height:1px;background:var(--line);pointer-events:none}
.gr-prog i{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--accent);transform-origin:left;transform:scaleX(0)}
.gr-note{position:absolute;left:18px;right:18px;top:calc(var(--sat) + 60px);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);text-align:right;pointer-events:none;opacity:0;transition:opacity .4s}
.gr-note.on{opacity:1}
.gr-hint{position:absolute;left:50%;top:calc(var(--sat) + 70px);transform:translate(-50%,-4px);padding:9px 16px 9px 20px;border-radius:999px;background:var(--card);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:inset 0 0 0 1px var(--line);font-size:11px;font-weight:600;letter-spacing:.38em;text-transform:uppercase;white-space:nowrap;color:var(--ink);opacity:0;transition:opacity .45s,transform .45s;pointer-events:none}
.gr-hint.on{opacity:1;transform:translate(-50%,0)}
.gr-card{position:absolute;left:50%;top:50%;width:min(300px,calc(100% - 48px));padding:26px 24px 22px;border-radius:20px;background:var(--card);-webkit-backdrop-filter:blur(16px) saturate(1.2);backdrop-filter:blur(16px) saturate(1.2);box-shadow:0 24px 60px rgba(0,0,0,.4),inset 0 0 0 1px var(--line);text-align:center;opacity:0;transform:translate(-50%,-46%) scale(.97);transition:opacity .16s ease,transform .2s ease;pointer-events:none}
.gr-card.on{opacity:1;transform:translate(-50%,-50%) scale(1);pointer-events:auto}
.gr-card h2{margin:0 0 8px;font-size:19px;font-weight:600;letter-spacing:.01em}
.gr-card.win h2{font-size:13px;letter-spacing:.34em}
.gr-sub{margin:0 0 20px;font-size:12px;letter-spacing:.08em;color:var(--dim);min-height:15px}
.gr-btn{pointer-events:auto;appearance:none;position:relative;overflow:hidden;border:1px solid var(--accent);background:transparent;color:var(--ink);font:inherit;font-weight:600;font-size:12px;letter-spacing:.32em;padding:15px 26px 15px 30px;border-radius:999px;cursor:pointer;min-width:168px}
.gr-btn:active{transform:scale(.98)}
.gr-fill{position:absolute;inset:0;background:var(--accent);opacity:.22;transform-origin:left;transform:scaleX(0)}
.gr-btn span{position:relative}
.gr-start{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;background:radial-gradient(70% 45% at 50% 50%,var(--card) 0%,transparent 100%);transition:opacity .35s}
.gr-start.off{opacity:0;pointer-events:none!important}
.gr-start.off *,.gr-card:not(.on),.gr-card:not(.on) *,.gr-picker:not(.on),.gr-picker:not(.on) *{pointer-events:none!important}
.gr-start-in{text-align:center;padding:24px;transform:translateY(-4%)}
.gr-title{font-size:20px;font-weight:600;letter-spacing:.46em;margin-left:.46em}
.gr-tag{margin-top:14px;font-size:12px;line-height:1.7;letter-spacing:.06em;color:var(--dim)}
.gr-cta{margin-top:28px;display:inline-block;font-size:11px;font-weight:600;letter-spacing:.4em;padding:14px 22px 14px 26px;border:1px solid var(--accent);border-radius:999px;animation:grPulse 2.2s ease-in-out infinite}
@keyframes grPulse{0%,100%{opacity:.65}50%{opacity:1}}
.gr-picker{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .18s}
.gr-picker.on{opacity:1;pointer-events:auto}
.gr-picker-in{width:min(320px,calc(100% - 40px));padding:22px 20px 18px;border-radius:20px;background:var(--card);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 24px 60px rgba(0,0,0,.4),inset 0 0 0 1px var(--line);text-align:center}
.gr-picker-h{font-size:11px;font-weight:600;letter-spacing:.36em;color:var(--dim);margin-bottom:16px}
.gr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-height:min(52vh,330px);overflow-y:auto;margin-bottom:16px;padding:2px}
.gr-tile{appearance:none;aspect-ratio:1;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit;font-size:14px;font-weight:600;letter-spacing:.08em;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;pointer-events:auto;padding:0}
.gr-tile small{font-size:8px;font-weight:400;letter-spacing:.1em;color:var(--dim)}
.gr-tile.cur{border-color:var(--accent)}
.gr-tile.locked{opacity:.28;cursor:default}
.gr-veil{position:absolute;inset:0;background:var(--veil);opacity:0;pointer-events:none;transition:opacity .16s ease}
.gr-veil.on{opacity:1}
.gr-err{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);text-align:center;display:none;pointer-events:auto}
.gr-err.on{display:block}
.gr-err p{font-size:13px;line-height:1.6;color:var(--ink);margin:0 0 18px}
.gr-puck{position:absolute;width:64px;height:64px;margin:-32px;border-radius:50%;border:1px solid var(--line);pointer-events:none;opacity:0;transition:opacity .2s}
.gr-puck.on{opacity:1}
.gr-puck i{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;border-radius:50%;background:var(--accent)}
`;

const HTML = `
<style>${CSS}</style>
<div class="gr-vig"></div>
<div class="gr-top">
  <button class="gr-level" type="button" aria-label="Choose level"><span class="gr-lvnum">LEVEL 01</span><span class="gr-lvname"></span></button>
  <div class="gr-bubble" aria-hidden="true"><i class="gr-dot"></i></div>
</div>
<div class="gr-prog"><i></i></div>
<div class="gr-note"></div>
<div class="gr-hint">Tilt to roll</div>
<div class="gr-puck"><i></i></div>
<div class="gr-card fail" role="dialog"><h2 class="gr-fail-h">You hit the edge.</h2><p class="gr-sub gr-fail-sub"></p><button class="gr-btn gr-retry" type="button"><span>RETRY</span></button></div>
<div class="gr-card win" role="dialog"><h2>LEVEL COMPLETE</h2><p class="gr-sub gr-win-sub"></p><button class="gr-btn gr-next" type="button"><i class="gr-fill"></i><span>NEXT LEVEL</span></button></div>
<div class="gr-picker"><div class="gr-picker-in"><div class="gr-picker-h">LEVELS</div><div class="gr-grid"></div><button class="gr-btn gr-close" type="button"><span>CLOSE</span></button></div></div>
<div class="gr-start" role="button" tabindex="0" aria-label="Begin"><div class="gr-start-in"><div class="gr-title">GRAVITY RUN</div><div class="gr-tag">Tilt your phone to roll the ball into the hole.<br>Don't touch the edges.</div><div class="gr-cta">TAP TO BEGIN</div></div></div>
<div class="gr-err"><p></p><button class="gr-btn gr-err-btn" type="button"><span>TRY AGAIN</span></button></div>
<div class="gr-veil on"></div>
`;

// ─────────────────────────────────────────────────────────── bit

window.plethoraBit = {
  meta: {
    title: "Gravity Run",
    runtime: "plethora-bit@2",
    tags: ["game", "physics", "tilt", "skill"],
    permissions: ["motion", "haptics", "audio"]
  },

  async init(ctx) {
    let disposed = false;
    const caps = ctx.capabilities || {};

    // ── tuning
    const tn = ctx.tune || {};
    const tNum = (id, d) => {
      const v = tn.number ? tn.number(id) : undefined;
      return Number.isFinite(v) ? v : d;
    };
    const tInt = (id, d) => {
      const v = tn.integer ? tn.integer(id) : undefined;
      return Number.isFinite(v) ? v : d;
    };
    const tBool = (id, d) => {
      const v = tn.boolean ? tn.boolean(id) : undefined;
      return typeof v === "boolean" ? v : d;
    };
    const tPct = (id, d) => {
      const v = tn.percent ? tn.percent(id) : undefined;
      return Number.isFinite(v) ? v : d;
    };
    const tChoice = (id, d) => {
      const v = tn.choice ? tn.choice(id) : undefined;
      return typeof v === "string" ? v : d;
    };
    const settings = {};
    const readSettings = () => {
      settings.tiltRange = clamp(tNum("tilt_range", 22), 8, 45);
      settings.force = clamp(tNum("roll_force", 1), 0.4, 2);
      settings.friction = clamp(tNum("rolling_friction", 1), 0.3, 2.5);
      settings.tolerance = clamp(tNum("edge_tolerance", 0.04), 0, 0.2) * BALL_R;
      settings.invertY = tBool("invert_forward", false);
      settings.invertX = tBool("invert_sideways", false);
      settings.volume = clamp(tPct("sound_volume", 0.7), 0, 1);
      settings.haptics = tBool("haptics", true);
    };
    readSettings();
    const finishName = tChoice("board_finish", "graphite");
    const finish = FINISHES[finishName] || FINISHES.graphite;
    const startOverride = clamp(Math.round(tInt("start_level", 1)), 1, 60);

    // ── surfaces
    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    const root = ctx.createRoot({ layer: "overlay", input: "passthrough", className: "gr" });
    root.innerHTML = HTML;
    const css = root.style;
    const ui = finish.ui;
    css.setProperty("--ink", ui.ink);
    css.setProperty("--dim", ui.dim);
    css.setProperty("--line", ui.line);
    css.setProperty("--accent", ui.accent);
    css.setProperty("--card", ui.card);
    css.setProperty("--veil", ui.veil);
    const $ = sel => root.querySelector(sel);
    const el = {
      level: $(".gr-level"),
      lvnum: $(".gr-lvnum"),
      lvname: $(".gr-lvname"),
      bubble: $(".gr-bubble"),
      dot: $(".gr-dot"),
      prog: $(".gr-prog i"),
      note: $(".gr-note"),
      hint: $(".gr-hint"),
      puck: $(".gr-puck"),
      fail: $(".gr-card.fail"),
      failH: $(".gr-fail-h"),
      failSub: $(".gr-fail-sub"),
      retry: $(".gr-retry"),
      win: $(".gr-card.win"),
      winSub: $(".gr-win-sub"),
      next: $(".gr-next"),
      fill: $(".gr-fill"),
      picker: $(".gr-picker"),
      grid: $(".gr-grid"),
      close: $(".gr-close"),
      start: $(".gr-start"),
      err: $(".gr-err"),
      errText: $(".gr-err p"),
      errBtn: $(".gr-err-btn"),
      veil: $(".gr-veil")
    };
    root.style.background = "transparent";
    canvas.style.background = "#" + finish.bg.toString(16).padStart(6, "0");

    const applySafe = () => {
      const sa = ctx.safeArea || {};
      css.setProperty("--sat", (sa.top || 0) + "px");
    };
    applySafe();
    ctx.markVisualReady("title-card");

    // Fonts are optional polish; the system stack is a fine fallback.
    if (ctx.loadFont) {
      Promise.all([
        ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }),
        ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" })
      ]).catch(() => {});
    }

    // ── saved progress
    const save = { unlocked: 1, cur: 1, best: {}, fails: {}, reach: {}, furthest: 0 };
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => ctx.timeout(() => rej(new Error("timeout")), ms))]);
    try {
      if (ctx.game && ctx.game.progress) {
        const p = await withTimeout(ctx.game.progress.load("main"), 1800);
        const st = p && p.resumeEligible === true ? p.state : null;
        if (st && st.v === 1) {
          save.unlocked = clamp(st.unlocked | 0, 1, 999);
          save.cur = clamp(st.cur | 0, 1, save.unlocked);
          save.best = st.best || {};
          save.fails = st.fails || {};
          save.reach = st.reach || {};
          save.furthest = st.furthest | 0;
        }
      }
    } catch (e) {
      // first run, offline, or unsupported: start fresh
    }
    if (disposed) return;
    if (startOverride > 1) {
      save.unlocked = Math.max(save.unlocked, startOverride);
      save.cur = startOverride;
    }

    function persist(label) {
      if (!ctx.game || !ctx.game.progress) return;
      const state = { v: 1, unlocked: save.unlocked, cur: save.cur, best: save.best, fails: save.fails, reach: save.reach, furthest: save.furthest };
      try {
        ctx.game.progress
          .save("main", { state, label, percent: Math.min(99, Math.round((save.unlocked - 1) * (100 / (LEVELS.length + 4)))), stateSchemaVersion: 1 })
          .catch(() => {});
      } catch (e) {
        // non-fatal
      }
    }

    // ── three.js
    let THREE = null;
    let renderer = null;
    let world = null;
    let loading = false;

    function showError(text) {
      el.errText.textContent = text;
      el.err.classList.add("on");
      el.start.classList.add("off");
      el.veil.classList.remove("on");
    }

    async function boot() {
      if (loading || disposed) return;
      loading = true;
      el.err.classList.remove("on");
      let stage = "dependency";
      try {
        if (!THREE) THREE = await ctx.importModule("three", "0.164.1");
        if (disposed) return;
        stage = "renderer";
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(ctx.dpr || 1, 2));
        renderer.setSize(Math.max(1, ctx.width), Math.max(1, ctx.height), false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        stage = "world";
        world = createWorld(THREE, renderer, finish);
        ctx.onDestroy(() => {
          if (world) world.dispose();
          if (renderer) renderer.dispose();
        });
        loadLevel(save.cur);
        layout();
        stage = "first-frame";
        renderer.compile(world.scene, world.camera);
        renderFrame(1);
        el.veil.classList.remove("on");
        G.state = "title";
        ctx.platform.ready();
        startLoop();
      } catch (err) {
        const message = (err && err.message) || String(err);
        try {
          ctx.platform.error({ stage, message });
        } catch (e) {
          // ignore
        }
        if (stage === "dependency") showError("Couldn't load the 3D board. Check your connection.");
        else showError("3D rendering isn't available here (" + stage + ").");
        if (stage !== "dependency" && renderer) {
          renderer.dispose();
          renderer = null;
        }
        el.errBtn.style.display = stage === "dependency" ? "" : "none";
        ctx.platform.ready();
      } finally {
        loading = false;
      }
    }

    // ── game state
    const G = {
      state: "boot",
      n: 1,
      def: null,
      lv: null,
      phys: null,
      t: 0,
      gateT: 0,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      bounces: 0,
      idx: 0,
      quat: null,
      tiltX: 0,
      tiltY: 0,
      attemptStart: 0,
      elapsed: 0,
      armed: true,
      cueCd: 0,
      moved: 0,
      maxS: 0,
      lastWall: 0,
      flashT: 9,
      capX: 0,
      capY: 0,
      winAt: 0,
      hintUntil: 0,
      firstPlay: true
    };

    function loadLevel(n) {
      G.n = n;
      G.def = levelDef(n);
      G.lv = buildLevel(G.def);
      const base = G.def.phys || {};
      G.phys = {
        acc: (base.acc || 7) * settings.force,
        vmax: base.vmax || 5.2,
        roll: (base.roll || 0.55) * settings.friction,
        damp: (base.damp || 0.3) * settings.friction
      };
      world.setLevel(G.lv);
      el.lvnum.textContent = "LEVEL " + pad2(n);
      el.lvname.textContent = G.def.name;
      save.cur = n;
      resetBall();
    }

    function resetBall() {
      const st = G.lv.start;
      G.x = G.px = st.x;
      G.y = G.py = st.y;
      G.vx = G.vy = 0;
      G.z = 0;
      G.vz = 0;
      G.bounces = 0;
      G.idx = 0;
      G.gateT = 0;
      G.moved = 0;
      G.maxS = 0;
      G.armed = true;
      G.flashT = 9;
      if (world) {
        world.flash.material.opacity = 0;
        world.flashLight.intensity = 0;
        world.updateGates(0);
        world.clearFx();
        world.trailClear();
      }
    }

    // ── input: device motion first, drag-to-tilt only as a fallback
    let motionOn = false;
    let tc = null;
    let fallback = false;
    let motionSeen = false;
    let motionStartedAt = 0;
    const keys = { x: 0, y: 0, l: false, r: false, u: false, d: false };
    const tracker = ctx.input.track(canvas, { pointerCapture: true });

    function makeTiltControl() {
      if (tc && tc.destroy) tc.destroy();
      tc = ctx.motion.tiltControl({ maxAngle: settings.tiltRange, deadzone: 0.03, smoothing: 0.15 });
    }

    function useFallback(reason) {
      fallback = true;
      el.note.textContent = reason === "denied" ? "Motion access off · drag to tilt" : "No motion sensor · drag to tilt";
      el.note.classList.add("on");
    }

    async function enableMotion() {
      if (!ctx.motion || caps.motion === false) {
        useFallback("unavailable");
        return;
      }
      try {
        await ctx.motion.start();
        if (disposed) return;
        if (ctx.motion.permission === "denied") throw new Error("denied");
        makeTiltControl();
        motionOn = true;
        motionStartedAt = performance.now();
      } catch (e) {
        useFallback(ctx.motion.permission === "denied" ? "denied" : "unavailable");
      }
    }

    function calibrate() {
      if (!motionOn) return;
      try {
        const r = ctx.motion.calibrate();
        if (r && r.catch) r.catch(() => {});
      } catch (e) {
        // keep current neutral
      }
      el.bubble.classList.add("set");
      ctx.timeout(() => el.bubble.classList.remove("set"), 700);
    }

    function readTilt() {
      let x = 0;
      let y = 0;
      let live = false;
      if (motionOn && tc) {
        // Once any real sensor sample has arrived, trust the control even while the
        // phone is perfectly still; only a sensor that never reports falls back to drag.
        const snap = ctx.motion.snapshot;
        if (!motionSeen && snap && snap.source && snap.source !== "none" && snap.atMs) motionSeen = true;
        if (motionSeen) {
          live = true;
          if (fallback) {
            fallback = false;
            el.note.classList.remove("on");
          }
          x = tc.x || 0;
          y = tc.y || 0;
          if (settings.invertX) x = -x;
          if (settings.invertY) y = -y;
        } else if (!fallback && performance.now() - motionStartedAt > 2000) useFallback("unavailable");
      }
      if (!live) {
        if (fallback && tracker.down) {
          x = clamp((tracker.x - tracker.startX) / 70, -1, 1);
          y = clamp((tracker.y - tracker.startY) / 70, -1, 1);
        }
        const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
        const ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
        if (kx || ky) {
          x = kx;
          y = ky;
        }
      }
      return { x, y };
    }

    ctx.listen(window, "keydown", e => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "a") keys.l = true;
      else if (k === "ArrowRight" || k === "d") keys.r = true;
      else if (k === "ArrowUp" || k === "w") keys.u = true;
      else if (k === "ArrowDown" || k === "s") keys.d = true;
      else return;
      if (!motionOn && !fallback && G.state !== "title") useFallback("unavailable");
    });
    ctx.listen(window, "keyup", e => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "a") keys.l = false;
      else if (k === "ArrowRight" || k === "d") keys.r = false;
      else if (k === "ArrowUp" || k === "w") keys.u = false;
      else if (k === "ArrowDown" || k === "s") keys.d = false;
    });

    // ── sound & haptics
    const sound = createSound();
    sound.setVolume(settings.volume);
    ctx.onDestroy(() => sound.close());
    const haptic = kind => {
      if (!settings.haptics || caps.haptics === false) return;
      try {
        ctx.platform.haptic(kind);
      } catch (e) {
        // ignore
      }
    };
    if (tn.onChange) {
      tn.onChange(["tilt_range", "roll_force", "rolling_friction", "edge_tolerance", "invert_forward", "invert_sideways", "sound_volume", "haptics"], () => {
        readSettings();
        sound.setVolume(settings.volume);
        if (motionOn) makeTiltControl();
        if (G.def) {
          const base = G.def.phys || {};
          G.phys.acc = (base.acc || 7) * settings.force;
          G.phys.roll = (base.roll || 0.55) * settings.friction;
          G.phys.damp = (base.damp || 0.3) * settings.friction;
        }
      });
    }

    // ── flow
    function hideCards() {
      el.fail.classList.remove("on");
      el.win.classList.remove("on");
      el.fill.style.transition = "none";
      el.fill.style.transform = "scaleX(0)";
    }

    function beginAttempt() {
      hideCards();
      resetBall();
      G.state = "ready";
      G.t = 0;
      G.resumeElapsed = null;
      el.hint.classList.add("on");
      G.hintUntil = Infinity;
      try {
        ctx.platform.start({ level: G.n });
      } catch (e) {
        // ignore
      }
    }

    function onBegin() {
      if (G.state !== "title") return;
      sound.ensure();
      sound.click();
      el.start.classList.add("off");
      G.state = "arming";
      enableMotion().then(() => {
        if (!disposed) beginAttempt();
      });
    }
    ctx.input.activate(el.start, onBegin);

    function retry() {
      if (G.state !== "fail") return;
      sound.ensure();
      sound.click();
      ctx.platform.interact({ type: "retry", level: G.n });
      beginAttempt();
    }
    ctx.input.activate(el.retry, retry);

    let transitioning = false;
    function goToLevel(n) {
      if (transitioning) return;
      transitioning = true;
      el.veil.classList.add("on");
      hideCards();
      G.state = "loading";
      ctx.timeout(() => {
        if (disposed) return;
        try {
          loadLevel(n);
        } catch (e) {
          ctx.platform.error({ stage: "level", message: (e && e.message) || String(e), level: n });
          loadLevel(LEVELS.length);
        }
        el.veil.classList.remove("on");
        transitioning = false;
        beginAttempt();
      }, 170);
    }

    function next() {
      if (G.state !== "won") return;
      sound.ensure();
      sound.click();
      ctx.platform.interact({ type: "next", level: G.n });
      goToLevel(G.n + 1);
    }
    ctx.input.activate(el.next, next);

    // ── level picker
    const tiles = [];
    function ensureTiles(count) {
      while (tiles.length < count) {
        const n = tiles.length + 1;
        el.grid.insertAdjacentHTML("beforeend", '<button type="button" class="gr-tile"><span>' + pad2(n) + "</span><small></small></button>");
        const b = el.grid.lastElementChild;
        ctx.input.activate(b, () => {
          if (n > save.unlocked || !el.picker.classList.contains("on")) return;
          sound.click();
          el.picker.classList.remove("on");
          G.state = "loading";
          goToLevel(n);
        });
        tiles.push(b);
      }
    }
    let pickerReturn = null;
    function openPicker() {
      if (!["ready", "play", "fail", "won"].includes(G.state)) return;
      sound.ensure();
      sound.click();
      ensureTiles(Math.max(16, Math.ceil((save.unlocked + 1) / 4) * 4));
      tiles.forEach((b, i) => {
        const n = i + 1;
        b.classList.toggle("locked", n > save.unlocked);
        b.classList.toggle("cur", n === G.n);
        const best = save.best[n];
        b.querySelector("small").textContent = n > save.unlocked ? "·" : best ? (best / 1000).toFixed(1) + "s" : "";
      });
      pickerReturn = G.state;
      if (G.state === "play") G.resumeElapsed = performance.now() - G.attemptStart;
      G.state = "picker";
      el.picker.classList.add("on");
    }
    function closePicker() {
      if (G.state !== "picker") return;
      sound.click();
      el.picker.classList.remove("on");
      if (pickerReturn === "play" || pickerReturn === "ready") {
        G.state = "ready";
        G.t = 0;
        G.vx = G.vy = 0;
      } else G.state = pickerReturn;
    }
    ctx.input.activate(el.level, openPicker);
    ctx.input.activate(el.close, closePicker);
    ctx.input.activate(el.errBtn, () => boot());

    // ── physics
    function fail(hit) {
      G.state = "fail";
      G.t = 0;
      G.vx = G.vy = 0;
      G.px = G.x;
      G.py = G.y;
      G.flashT = 0;
      const fx = hit.x;
      const fy = hit.y;
      world.flash.position.set(fx, fy, 0.006);
      world.flashLight.position.set(fx, fy, 0.3);
      const nx = G.x - fx;
      const ny = G.y - fy;
      const nl = Math.hypot(nx, ny) || 1;
      G.recoilX = nx / nl;
      G.recoilY = ny / nl;
      world.shatter(fx, fy, G.recoilX, G.recoilY, G.idx, G.gateT);
      sound.shatter();
      sound.setRoll(0, 0);
      haptic("heavy");
      const pct = clamp(G.maxS / G.lv.length, 0, 1);
      save.fails[G.n] = (save.fails[G.n] || 0) + 1;
      const prevBest = save.reach[G.n] || 0;
      if (pct > prevBest) save.reach[G.n] = Math.round(pct * 100) / 100;
      el.failH.textContent = hit.kind === "gate" ? "You hit a gate." : "You hit the edge.";
      const bestPct = Math.round(Math.max(pct, prevBest) * 100);
      el.failSub.textContent = Math.round(pct * 100) + "% of the way" + (bestPct > Math.round(pct * 100) ? " · best " + bestPct + "%" : "");
      try {
        ctx.platform.fail({ level: G.n, progress: Math.round(pct * 100) / 100 });
      } catch (e) {
        // ignore
      }
    }

    function capture() {
      G.state = "drop";
      G.t = 0;
      G.capX = G.x;
      G.capY = G.y;
      G.z = 0;
      G.vz = -Math.min(1.2, Math.hypot(G.vx, G.vy) * 0.25);
      G.bounces = 0;
      G.elapsed = performance.now() - G.attemptStart;
      sound.setRoll(0, 0);
    }

    function landed() {
      sound.land();
      haptic("success");
      const n = G.n;
      const ms = Math.round(G.elapsed);
      const prev = save.best[n];
      const isBest = !prev || ms < prev;
      if (isBest) save.best[n] = ms;
      save.unlocked = Math.max(save.unlocked, n + 1);
      save.cur = n + 1;
      const newFurthest = n > save.furthest;
      if (newFurthest) save.furthest = n;
      persist("Level " + pad2(n + 1));
      el.winSub.textContent = (ms / 1000).toFixed(1) + " s" + (isBest && prev ? " · NEW BEST" : prev ? " · BEST " + (prev / 1000).toFixed(1) + " s" : "");
      try {
        ctx.platform.milestone("level_clear", { level: n, timeMs: ms });
      } catch (e) {
        // ignore
      }
      if (newFurthest && ctx.memory && ctx.memory.record) {
        try {
          const r = ctx.memory.record("furthest_level").checkpoint(n, { label: "Level " + n });
          if (r && r.catch) r.catch(() => {});
        } catch (e) {
          // leaderboard is optional
        }
      }
      G.pulseLevel = n % 5 === 0 ? n : 0;
    }

    function stepBall(dt) {
      const ox = G.x;
      const oy = G.y;
      const r = simulateStep(G.lv, G, G.tiltX, G.tiltY, G.phys, dt, G.gateT, settings.tolerance);
      if (r.bump > 0.35) {
        sound.thud(clamp(r.bump / 3, 0, 1));
        if (r.bump > 0.9) haptic("light");
      }
      if (r.kind === "fail") {
        fail({ x: r.x, y: r.y, kind: r.hitKind });
        return;
      }
      G.moved += r.moved;
      if (G.lv.s[G.idx] > G.maxS) G.maxS = G.lv.s[G.idx];

      // Rolling: rotate about the axis perpendicular to travel.
      if (r.moved > 1e-6 && G.quat) {
        G.rotAxis.set(-(G.y - oy) / r.moved, (G.x - ox) / r.moved, 0);
        G.rotQ.setFromAxisAngle(G.rotAxis, r.moved / BALL_R);
        G.quat.premultiply(G.rotQ);
      }

      // Near-edge cue: one light tick per approach.
      G.lastWall = r.gap;
      if (G.armed && r.gap < 0.09 && r.toward > 0.3) {
        G.armed = false;
        if (G.cueCd <= 0) {
          sound.tick();
          haptic("light");
          G.cueCd = 0.45;
        }
      } else if (!G.armed && r.gap > 0.22) G.armed = true;

      if (r.kind === "capture") capture();
    }

    // ── per-frame
    let pendingPulse = false;
    function update(dtMs) {
      const dt = Math.min(0.1, dtMs / 1000);
      G.t += dt;
      G.cueCd -= dt;
      const now = performance.now();

      if (G.state === "ready" && G.t >= 0.45) {
        calibrate();
        G.state = "play";
        G.t = 0;
        // A paused run keeps the time it had already spent.
        G.attemptStart = now - (G.resumeElapsed || 0);
        G.resumeElapsed = null;
        G.hintUntil = G.firstPlay ? Infinity : now + 1300;
      }
      if (G.state === "play") {
        if (G.firstPlay && G.moved > 0.8) {
          G.firstPlay = false;
          G.hintUntil = now + 600;
        }
        if (now > G.hintUntil) el.hint.classList.remove("on");
      } else if (G.state !== "ready") el.hint.classList.remove("on");

      if (G.state === "drop") {
        const lv = G.lv;
        const k = smooth01(clamp(G.t / 0.22, 0, 1));
        G.x = G.px = lerp(G.capX, lv.hole.x, k);
        G.y = G.py = lerp(G.capY, lv.hole.y, k);
        if (G.bounces < 2) {
          G.vz -= 26 * dt;
          G.z += G.vz * dt;
          if (G.z <= -HOLE_DEPTH) {
            G.z = -HOLE_DEPTH;
            if (G.bounces === 0) landed();
            G.vz = G.bounces === 0 ? Math.abs(G.vz) * 0.22 : 0;
            G.bounces++;
            if (G.bounces >= 2) G.winAt = now + 280;
          }
        } else if (now >= G.winAt) {
          G.state = "won";
          G.t = 0;
          sound.chime();
          el.win.classList.add("on");
          el.fill.style.transition = "none";
          el.fill.style.transform = "scaleX(0)";
          void el.fill.offsetWidth;
          el.fill.style.transition = "transform " + AUTO_NEXT_MS + "ms linear";
          el.fill.style.transform = "scaleX(1)";
          if (G.pulseLevel && ctx.pulse && ctx.pulse.complete) pendingPulse = true;
        }
      }
      if (G.state === "won") {
        if (pendingPulse && G.t > 0.25) {
          pendingPulse = false;
          try {
            ctx.pulse.complete({ level: G.pulseLevel, timeMs: Math.round(G.elapsed), result: "clear", mode: "levels" });
          } catch (e) {
            // ignore
          }
        }
        if (G.t * 1000 >= AUTO_NEXT_MS) next();
      }
      if (G.state === "fail" && G.t >= 0.32 && !el.fail.classList.contains("on")) el.fail.classList.add("on");

      // HUD
      const tx = G.tiltX;
      const ty = G.tiltY;
      el.dot.style.transform = "translate(" + (tx * 9).toFixed(1) + "px," + (ty * 9).toFixed(1) + "px)";
      if (G.lv) {
        const pct = G.state === "drop" || G.state === "won" ? 1 : clamp(G.lv.s[G.idx] / G.lv.length, 0, 1);
        el.prog.style.transform = "scaleX(" + pct.toFixed(4) + ")";
      }
      const showPuck = fallback && tracker.down && (G.state === "play" || G.state === "ready");
      el.puck.classList.toggle("on", showPuck);
      if (showPuck) {
        el.puck.style.left = tracker.startX + "px";
        el.puck.style.top = tracker.startY + "px";
        el.puck.firstChild.style.transform = "translate(" + (tx * 22).toFixed(1) + "px," + (ty * 22).toFixed(1) + "px)";
      }

      // Rolling sound follows speed; it brightens as the ball nears an edge.
      if (G.state === "play" && G.phys) {
        const sp = Math.hypot(G.vx, G.vy) / G.phys.vmax;
        const near = 1 - clamp(G.lastWall / 0.4, 0, 1);
        sound.setRoll(sp, near);
      } else sound.setRoll(0, 0);

      // Impact flash.
      if (world) {
        G.flashT += dt;
        const f = clamp(G.flashT / 0.42, 0, 1);
        world.flash.material.opacity = f < 1 ? (1 - f) * 0.95 : 0;
        const s = 1 + f * 5;
        world.flash.scale.set(s, s, 1);
        world.flashLight.intensity = f < 1 ? (1 - f) * (1 - f) * 7 : 0;
        world.updateGates(G.gateT);
        world.updateFx(dt);
        // The glass gives a little under the ball once it breaks.
        if (G.state === "fail") G.z = -0.03 * smooth01(clamp(G.t / 0.18, 0, 1));
        const glowTarget = G.state === "play" && G.phys ? 2.4 * clamp(Math.hypot(G.vx, G.vy) / G.phys.vmax, 0, 1) + 0.25 : 0;
        world.glow.intensity += (glowTarget - world.glow.intensity) * Math.min(1, dt * 8);
      }
    }

    function fixedUpdate(stepMs) {
      const dt = stepMs / 1000;
      if (G.state === "ready" || G.state === "play") G.gateT += dt;
      const raw = readTilt();
      const k = 1 - Math.exp(-dt / 0.05);
      G.tiltX += (raw.x - G.tiltX) * k;
      G.tiltY += (raw.y - G.tiltY) * k;
      if (G.state === "play") {
        G.px = G.x;
        G.py = G.y;
        stepBall(dt);
        if (world) world.trailPush(G.x, G.y, performance.now() / 1000);
      } else if (G.state !== "drop") {
        G.px = G.x;
        G.py = G.y;
      }
    }

    function renderFrame(alpha) {
      if (!world) return;
      let x = G.x;
      let y = G.y;
      if (G.state === "play") {
        x = lerp(G.px, G.x, alpha);
        y = lerp(G.py, G.y, alpha);
      }
      if (G.state === "fail" && G.t < 0.14) {
        const r = Math.sin((G.t / 0.14) * Math.PI) * 0.025;
        x += G.recoilX * r;
        y += G.recoilY * r;
      }
      const b = world.ball;
      b.position.set(x, y, BALL_R + G.z);
      if (G.quat) b.quaternion.copy(G.quat);
      const depth = clamp(-G.z / HOLE_DEPTH, 0, 1);
      // Sinking into the bore: reflections and light fall away.
      world.mats.ball.envMapIntensity = 1.45 * (1 - depth * 0.9);
      world.mats.ball.color.setScalar(1 - depth * 0.62);
      world.contact.position.set(x, y, 0.004);
      world.glow.position.set(x, y, 0.1 + G.z);
      world.trailUpdate(performance.now() / 1000, x, y, G.state === "play");
      world.contact.material.opacity = 0.6 * (1 - clamp(depth * 3, 0, 1));
      renderer.render(world.scene, world.camera);
    }

    // ── layout
    function layout() {
      if (!renderer || !world) return;
      applySafe();
      renderer.setPixelRatio(Math.min(ctx.dpr || 1, 2));
      renderer.setSize(Math.max(1, ctx.width), Math.max(1, ctx.height), false);
      world.fit(Math.max(1, ctx.width), Math.max(1, ctx.height), ctx.safeArea || {});
    }
    ctx.onResize(() => {
      layout();
      if (G.state !== "boot") renderFrame(1);
    });

    // ── loop
    let lastUpdateAt = 0;
    function startLoop() {
      G.quat = new THREE.Quaternion();
      G.rotQ = new THREE.Quaternion();
      G.rotAxis = new THREE.Vector3();
      ctx.game.loop({
        fixedHz: STEP_HZ,
        maxSubsteps: 12,
        maxDeltaMs: 100,
        input: tracker,
        fixedUpdate,
        update(dtMs) {
          const now = performance.now();
          // Returning from the background: hold the ball and re-level before play resumes.
          if (lastUpdateAt && now - lastUpdateAt > 1500 && G.state === "play") {
            G.resumeElapsed = lastUpdateAt - G.attemptStart;
            G.state = "ready";
            G.t = 0;
            G.vx = G.vy = 0;
            el.hint.classList.add("on");
          }
          lastUpdateAt = now;
          update(dtMs);
        },
        render: renderFrame
      });
    }

    ctx.onDestroy(() => {
      disposed = true;
      if (tc && tc.destroy) tc.destroy();
    });

    await boot();
  }
};
