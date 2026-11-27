// The collection: eight ceramic objects, each a surface of revolution shaped by
// a hand-drawn profile plus small angular modulations (asymmetry, fluting, a
// folded rim). u in [0,1) runs around the object (u = 0 faces the viewer), v in
// [0,1] runs along the profile from the centre of the foot to the lip.

const OBJECTS = {
  cup: {
    name: 'Cup', thick: 0.034, elev: 0.24, glaze: [0.925, 0.900, 0.840], speck: 0.6, rings: 1.0,
    profile: [[0, 0.014], [0.27, 0.0], [0.305, 0.018], [0.33, 0.07], [0.36, 0.30], [0.385, 0.58], [0.41, 0.86], [0.43, 1.02]],
    rad: (u, v) => 1 + 0.014 * Math.sin(TAU * u * 3 + 1.1) * v + 0.008 * Math.sin(TAU * u * 2 + 0.3) * v * v,
    lift: (u, v) => 0.010 * Math.sin(TAU * u * 2 + 0.6) * Math.pow(v, 6)
  },
  bowl: {
    name: 'Bowl', thick: 0.034, elev: 0.52, glaze: [0.930, 0.905, 0.850], speck: 0.4, rings: 0.8,
    profile: [[0, 0.02], [0.17, 0.0], [0.205, 0.02], [0.24, 0.06], [0.38, 0.16], [0.52, 0.30], [0.62, 0.45], [0.68, 0.56], [0.70, 0.60]],
    rad: (u, v) => 1 + 0.018 * Math.cos(TAU * u * 2 + 0.4) * v * v,
    lift: (u, v) => 0.016 * Math.sin(TAU * u * 3 + 2.0) * Math.pow(v, 5)
  },
  plate: {
    name: 'Plate', thick: 0.032, elev: 0.92, glaze: [0.935, 0.915, 0.865], speck: 0.3, rings: 0.6,
    profile: [[0, 0.018], [0.26, 0.0], [0.29, 0.018], [0.33, 0.04], [0.52, 0.07], [0.72, 0.11], [0.84, 0.16], [0.90, 0.205], [0.915, 0.215]],
    rad: (u, v) => 1 + 0.010 * Math.sin(TAU * u * 2 + 0.9) * v,
    lift: (u, v) => 0.012 * Math.sin(TAU * u * 4 + 0.2) * Math.pow(v, 8)
  },
  vase: {
    name: 'Vase', thick: 0.034, elev: 0.16, glaze: [0.920, 0.895, 0.835], speck: 0.7, rings: 1.0,
    profile: [[0, 0.014], [0.22, 0.0], [0.255, 0.03], [0.32, 0.20], [0.42, 0.48], [0.47, 0.72], [0.44, 0.92], [0.33, 1.10], [0.20, 1.25], [0.155, 1.36], [0.165, 1.48], [0.20, 1.56], [0.215, 1.58]],
    rad: (u, v) => 1 + 0.016 * Math.sin(TAU * u + 0.5) * Math.sin(Math.PI * v),
    lift: (u, v) => 0.008 * Math.sin(TAU * u * 2 + 1.7) * Math.pow(v, 10)
  },
  holder: {
    name: 'Candle holder', thick: 0.036, elev: 0.50, glaze: [0.925, 0.905, 0.855], speck: 0.5, rings: 0.7,
    profile: [[0, 0.016], [0.36, 0.0], [0.41, 0.02], [0.43, 0.08], [0.42, 0.16], [0.36, 0.22], [0.27, 0.26], [0.22, 0.32], [0.205, 0.45], [0.215, 0.56], [0.24, 0.62]],
    rad: (u, v) => 1 + 0.012 * Math.sin(TAU * u * 3 + 0.2) * v,
    lift: (u, v) => 0.014 * Math.sin(TAU * u * 2 + 2.4) * Math.pow(v, 9)
  },
  fluted: {
    name: 'Fluted vessel', thick: 0.034, elev: 0.24, glaze: [0.935, 0.915, 0.870], speck: 0.25, rings: 0.0,
    profile: [[0, 0.014], [0.17, 0.0], [0.22, 0.03], [0.32, 0.16], [0.42, 0.40], [0.46, 0.66], [0.43, 0.90], [0.35, 1.08], [0.31, 1.18], [0.315, 1.22]],
    rad: (u, v) => 1 + 0.055 * Math.cos(TAU * u * 13 + v * 4.2) * smooth((v - 0.06) / 0.18) * (1 - 0.65 * smooth((v - 0.8) / 0.2)),
    lift: (u, v) => 0.012 * Math.cos(TAU * u * 13 + v * 4.2) * Math.pow(v, 12)
  },
  moonjar: {
    name: 'Moon jar', thick: 0.036, elev: 0.18, glaze: [0.928, 0.905, 0.845], speck: 0.8, rings: 0.5,
    profile: [[0, 0.014], [0.25, 0.0], [0.30, 0.05], [0.47, 0.24], [0.58, 0.52], [0.585, 0.74], [0.52, 0.98], [0.38, 1.14], [0.25, 1.21], [0.245, 1.27], [0.27, 1.31]],
    rad: (u, v) => 1 + 0.03 * Math.sin(TAU * u + 2.2) * Math.sin(Math.PI * v) + 0.012 * Math.sin(TAU * u * 3 + 0.7) * Math.sin(Math.PI * v),
    lift: (u, v) => 0.012 * Math.sin(TAU * u + 1.0) * Math.pow(v, 8)
  },
  folded: {
    name: 'Folded vessel', thick: 0.032, elev: 0.44, glaze: [0.940, 0.922, 0.878], speck: 0.2, rings: 0.3,
    profile: [[0, 0.016], [0.15, 0.0], [0.19, 0.04], [0.26, 0.22], [0.33, 0.45], [0.43, 0.70], [0.55, 0.90], [0.62, 1.00]],
    rad: (u, v) => 1 + 0.13 * Math.cos(TAU * u * 3 + 0.35) * Math.pow(v, 2.2) + 0.03 * Math.sin(TAU * u * 5 + 1.3) * Math.pow(v, 3),
    lift: (u, v) => 0.16 * Math.cos(TAU * u * 3 + 0.35 + 0.5) * Math.pow(v, 3.2) + 0.02 * Math.sin(TAU * u * 7) * Math.pow(v, 4)
  }
};

// Levels: difficulty rises through fragment count, rotation, pieces hidden
// round the back, tolerance, crack shape and the gold allowance.
//   loose     movable fragments (the foot piece stays on the plinth)
//   anchor    [front, back] height (v) of the foot piece's edge; back > 1 means
//             the whole back wall stays standing
//   spread    how far round the object the loose pieces reach (0.5 = all round)
//   roll      max initial rotation error of a piece (degrees)
//   warp      irregularity of the crack paths
//   pos/yaw/rollTol  placement tolerances (fraction of object size / degrees)
//   magnet    gold attraction radius (object units); gold  allowance factor
const LEVELS = [
  { obj: 'cup',     seed: 11, loose: 3,  anchor: [0.50, 1.30], spread: 0.13, roll: 0,   warp: 0.030, pos: 0.10,  yawTol: 26, rollTol: 24, magnet: 0.052, gold: 2.4 },
  { obj: 'bowl',    seed: 23, loose: 4,  anchor: [0.36, 0.90], spread: 0.24, roll: 14,  warp: 0.036, pos: 0.09,  yawTol: 24, rollTol: 22, magnet: 0.048, gold: 2.2 },
  { obj: 'plate',   seed: 31, loose: 5,  anchor: [0.40, 1.20], spread: 0.22, roll: 120, warp: 0.040, pos: 0.08,  yawTol: 22, rollTol: 18, magnet: 0.044, gold: 2.0 },
  { obj: 'vase',    seed: 47, loose: 6,  anchor: [0.30, 0.30], spread: 0.50, roll: 35,  warp: 0.044, pos: 0.075, yawTol: 18, rollTol: 16, magnet: 0.040, gold: 1.85 },
  { obj: 'holder',  seed: 59, loose: 6,  anchor: [0.36, 0.36], spread: 0.50, roll: 100, warp: 0.050, pos: 0.07,  yawTol: 16, rollTol: 14, magnet: 0.036, gold: 1.75 },
  { obj: 'fluted',  seed: 71, loose: 7,  anchor: [0.26, 0.26], spread: 0.50, roll: 160, warp: 0.056, pos: 0.065, yawTol: 14, rollTol: 12, magnet: 0.034, gold: 1.65 },
  { obj: 'moonjar', seed: 83, loose: 9,  anchor: [0.24, 0.24], spread: 0.50, roll: 180, warp: 0.060, pos: 0.06,  yawTol: 12, rollTol: 10, magnet: 0.031, gold: 1.55 },
  { obj: 'folded',  seed: 97, loose: 11, anchor: [0.24, 0.24], spread: 0.50, roll: 180, warp: 0.066, pos: 0.055, yawTol: 10, rollTol: 9,  magnet: 0.028, gold: 1.5 }
];

// Build an evaluable surface for an object definition.
function makeSurface(def) {
  const dense = catmull2(def.profile, 24);
  // arclength parametrisation
  const s = [0];
  for (let i = 1; i < dense.length; i++) s.push(s[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const L = s[s.length - 1];
  const N = 512, R = new Float32Array(N + 1), Y = new Float32Array(N + 1);
  let k = 0;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * L;
    while (k < s.length - 2 && s[k + 1] < t) k++;
    const f = (t - s[k]) / Math.max(1e-9, s[k + 1] - s[k]);
    R[i] = lerp(dense[k][0], dense[k + 1][0], f);
    Y[i] = lerp(dense[k][1], dense[k + 1][1], f);
  }
  R[0] = 0;
  function prof(v) {
    const x = clamp01(v) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
    return [R[i] + (R[i + 1] - R[i]) * f, Y[i] + (Y[i + 1] - Y[i]) * f];
  }
  // allocation-free: this runs for every vertex of every shard
  function pos(u, v, out) {
    const x = (v < 0 ? 0 : v > 1 ? 1 : v) * N, i = x >= N ? N - 1 : Math.floor(x), f = x - i;
    const pr = R[i] + (R[i + 1] - R[i]) * f, py = Y[i] + (Y[i + 1] - Y[i]) * f;
    const r = pr * def.rad(u, v), a = u * TAU;
    out[0] = r * Math.sin(a); out[1] = py + def.lift(u, v) * smooth(v * 3); out[2] = r * Math.cos(a);
    return out;
  }
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  // outward unit normal
  function normal(u, v, out) {
    const e = 1e-3;
    if (v < 0.004) { out[0] = 0; out[1] = -1; out[2] = 0; return out; }
    pos(u + e, v, A); pos(u - e, v, B);
    const v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
    pos(u, v1, C); pos(u, v0, D);
    const tu = [A[0] - B[0], A[1] - B[1], A[2] - B[2]], tv = [C[0] - D[0], C[1] - D[1], C[2] - D[2]];
    // n = tu x tv points outward for this parametrisation
    let nx = tu[1] * tv[2] - tu[2] * tv[1], ny = tu[2] * tv[0] - tu[0] * tv[2], nz = tu[0] * tv[1] - tu[1] * tv[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }
  // circumference scale: object-length of one unit of u, relative to profile length
  function cscale(v) { const x = (v < 0 ? 0 : v > 1 ? 1 : v) * N, i = x >= N ? N - 1 : Math.floor(x); return (TAU * Math.max(0.02, R[i] + (R[i + 1] - R[i]) * (x - i))) / L; }
  // bounds
  let maxR = 0, maxY = 0;
  for (let i = 0; i <= N; i++) { maxR = Math.max(maxR, R[i]); maxY = Math.max(maxY, Y[i]); }
  return { def, pos, normal, prof, cscale, L, height: maxY + 0.05, radius: maxR * 1.15 };
}
