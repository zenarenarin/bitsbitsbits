import { useId, useMemo } from 'react';

/* ------------------------------------------------------------------
   Foliage library.
   Every shape is drawn with its root at (0,0), growing toward −y, so a
   plant can grow from its base, sway around its base and hang upside-down
   from the top edge with the same geometry.
   ------------------------------------------------------------------ */

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// base → tip gradients, sampled from the illustration references
export const GRADS = {
  deep: ['#03171c', '#0e4540'],
  night: ['#04161d', '#0f3b45'],
  forest: ['#062722', '#1d7a5e'],
  jade: ['#0b3f36', '#46b083'],
  moss: ['#0c3a2c', '#5c9a4a'],
  teal: ['#09444f', '#2fb3a8'],
  sea: ['#0a5a66', '#5fe0cf'],
  lumen: ['#18b8a6', '#d6fff0'],
  mist: ['#0d4f5a', '#1d7983'],
  indigo: ['#120f44', '#3f42b8'],
  violet: ['#2a1a6a', '#8f6ad8'],
  plum: ['#220c3c', '#74379a'],
  magenta: ['#5a1258', '#e0508f'],
  coral: ['#b8392b', '#ff9a72'],
  ember: ['#7e2a10', '#f2913d'],
  sun: ['#d98a17', '#ffe7a0'],
  cream: ['#d9c9a6', '#fff8ea'],
  dusk: ['#1b2a6b', '#3d6fb0'],
  meadow: ['#2c8573', '#86cfa8'],
  pale: ['#86c9bb', '#c9ecdf'],
  haze: ['#a9dccf', '#dcf3ea'],
};

export function FoliageDefs({ prefix = 'g' }) {
  return (
    <defs>
      {Object.entries(GRADS).map(([k, [a, b]]) => (
        <linearGradient key={k} id={`${prefix}-f-${k}`} x1="0" y1="1" x2="0.15" y2="0">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      ))}
      <radialGradient id={`${prefix}-f-glow`}>
        <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="0.35" stopColor="#fff" stopOpacity="0.35" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

function mix(a, b, t) {
  const h = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const A = h(a), B = h(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const flat = (name, t = 0.5) => (name?.startsWith('#') ? name : mix(GRADS[name][0], GRADS[name][1], t));

const fillOf = (p, name) => (name?.startsWith('#') ? name : `url(#${p}-f-${name})`);

/* ---------- geometry helpers ---------- */

// Quadratic bezier point/tangent
function qpt(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function qtan(p0, p1, p2, t) {
  return [2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
}

// A tapered organic limb along a quadratic spine. Returns an SVG path.
export function limb(p0, p1, p2, w0, w1, steps = 18) {
  const L = [];
  const R = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = qpt(p0, p1, p2, t);
    const [tx, ty] = qtan(p0, p1, p2, t);
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const w = (w0 + (w1 - w0) * Math.pow(t, 0.8)) / 2;
    L.push([x + nx * w, y + ny * w]);
    R.push([x - nx * w, y - ny * w]);
  }
  const pts = [...L, ...R.reverse()];
  return 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z';
}

/* ---------- shapes ---------- */

const DARK = new Set(['deep', 'night']);

function Blade({ p, h = 420, w = 70, bend = 0.25, fill = 'jade', rib = !DARK.has(fill) }) {
  const tx = bend * h;
  const d = `M0,0 C${w * 0.7},${-h * 0.25} ${w * 0.55 + tx * 0.45},${-h * 0.72} ${tx},${-h} C${-w * 0.4 + tx * 0.45},${-h * 0.72} ${-w * 0.7},${-h * 0.25} 0,0Z`;
  return (
    <>
      <path d={d} fill={fillOf(p, fill)} />
      {rib && <path d={`M0,0 Q${tx * 0.32},${-h * 0.55} ${tx},${-h}`} fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth={Math.max(1.5, w * 0.03)} />}
    </>
  );
}

function Paddle({ p, h = 360, w = 150, fill = 'forest', stripes = 0, stripe = '#04221d', stem = '#062722', rib = !DARK.has(fill) }) {
  const id = useId().replace(/:/g, '');
  const s = h * 0.2;
  const bh = h - s;
  const d = `M0,${-s} C${w},${-s - bh * 0.08} ${w * 0.78},${-h * 0.84} 0,${-h} C${-w * 0.78},${-h * 0.84} ${-w},${-s - bh * 0.08} 0,${-s}Z`;
  const lines = [];
  for (let i = 1; i <= stripes; i++) {
    const y = -s - bh * (i / (stripes + 1)) + bh * 0.04;
    const dy = bh * 0.2;
    lines.push(`M0,${y} Q${w * 0.4},${y - dy * 0.7} ${w * 1.1},${y - dy}`, `M0,${y} Q${-w * 0.4},${y - dy * 0.7} ${-w * 1.1},${y - dy}`);
  }
  return (
    <>
      <path d={`M0,0 L0,${-s - 4}`} stroke={stem} strokeWidth={Math.max(3, w * 0.06)} strokeLinecap="round" />
      <path d={d} fill={fillOf(p, fill)} />
      {stripes > 0 && (
        <>
          <clipPath id={id}>
            <path d={d} />
          </clipPath>
          <g clipPath={`url(#${id})`}>
            <path d={lines.join(' ')} fill="none" stroke={stripe} strokeOpacity="0.75" strokeWidth={bh / (stripes * 3.2)} strokeLinecap="round" />
          </g>
        </>
      )}
      {rib && <path d={`M0,${-s} Q${w * 0.05},${-h * 0.6} 0,${-h * 0.97}`} fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth={Math.max(1.5, w * 0.025)} />}
    </>
  );
}

function Frond({ p, h = 420, n = 12, bend = 0.3, leaf = 46, fill = 'teal', stem = '#0a3d40' }) {
  const p0 = [0, 0];
  const p1 = [bend * h * 0.15, -h * 0.6];
  const p2 = [bend * h, -h];
  const items = [];
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (i / n) * 0.86;
    const [x, y] = qpt(p0, p1, p2, t);
    const [tx, ty] = qtan(p0, p1, p2, t);
    const a = (Math.atan2(ty, tx) * 180) / Math.PI;
    const size = leaf * (1 - t * 0.65);
    for (const side of [-1, 1]) {
      const ang = a + side * 62;
      items.push(
        <ellipse
          key={`${i}${side}`}
          cx={size}
          cy={0}
          rx={size}
          ry={size * 0.34}
          transform={`translate(${x} ${y}) rotate(${ang})`}
          fill={flat(fill, 0.25 + t * 0.6)}
        />,
      );
    }
  }
  return (
    <>
      <path d={limb(p0, p1, p2, Math.max(4, leaf * 0.16), 1.5)} fill={stem} />
      {items}
    </>
  );
}

function Capsule({ p, h = 300, w = 70, fill = 'violet', lines = 3 }) {
  const ls = [];
  for (let i = 0; i < lines; i++) {
    const x = -w * 0.28 + (i / Math.max(1, lines - 1)) * w * 0.56;
    ls.push(<path key={i} d={`M${x},${-w * 0.4} L${x},${-h + w * 0.55}`} stroke="#fff" strokeOpacity={0.06 + (i % 2) * 0.05} strokeWidth={w * 0.05} strokeLinecap="round" />);
  }
  return (
    <>
      <rect x={-w / 2} y={-h} width={w} height={h} rx={w / 2} fill={fillOf(p, fill)} />
      <path d={`M${w * 0.08},${-h + w * 0.3} Q${w * 0.5},${-h + w * 0.2} ${w * 0.5},${-h + w * 0.5} V${-w * 0.5} Q${w * 0.5},0 ${w * 0.08},${-w * 0.08}Z`} fill="#0a0420" opacity="0.32" />
      {ls}
    </>
  );
}

function Canopy({ p, size: r = 120, fill = 'mist', trunk = '#0b3c44', seed = 3 }) {
  const R = useMemo(() => rng(seed), [seed]);
  const blobs = useMemo(() => {
    const out = [
      [0, -r * 1.25, r],
      [-r * 0.78, -r * 0.82, r * 0.7],
      [r * 0.82, -r * 0.78, r * 0.72],
    ];
    for (let i = 0; i < 3; i++) out.push([(R() - 0.5) * r * 1.3, -r * (1.1 + R() * 0.9), r * (0.45 + R() * 0.35)]);
    return out;
  }, [r, R]);
  return (
    <>
      <rect x={-r * 0.06} y={-r * 0.9} width={r * 0.12} height={r * 0.9} fill={trunk} />
      {blobs.map(([x, y, rr], i) => (
        <circle key={i} cx={x} cy={y} r={rr} fill={fillOf(p, fill)} />
      ))}
    </>
  );
}

function Cone({ p, h = 260, w = 120, fill = 'indigo' }) {
  return <path d={`M${-w / 2},0 Q${-w * 0.16},${-h * 0.45} 0,${-h} Q${w * 0.16},${-h * 0.45} ${w / 2},0Z`} fill={fillOf(p, fill)} />;
}

function Discs({ p, h = 320, size: r = 100, n = 3, fill = 'sea', stem = '#0d4d55' }) {
  const ds = [];
  for (let i = 0; i < n; i++) {
    const y = -h * (0.45 + (i / Math.max(1, n - 1)) * 0.55);
    const rr = r * (1 - i * 0.22);
    ds.push(
      <g key={i}>
        <ellipse cx={0} cy={y + rr * 0.06} rx={rr} ry={rr * 0.2} fill={stem} opacity="0.7" />
        <ellipse cx={0} cy={y} rx={rr} ry={rr * 0.19} fill={fillOf(p, fill)} />
      </g>,
    );
  }
  return (
    <>
      <path d={limb([0, 0], [r * 0.08, -h * 0.5], [0, -h], r * 0.12, r * 0.06, 10)} fill={stem} />
      {ds}
    </>
  );
}

function GlowTree({ p, h = 900, fill = 'lumen', seed = 7, dust = 90 }) {
  const R = useMemo(() => rng(seed), [seed]);
  const parts = useMemo(() => {
    const s = h / 900;
    const L = (a, b, c, w0, w1) => [a.map((v) => v * s), b.map((v) => v * s), c.map((v) => v * s), w0 * s, w1 * s];
    const limbs = [
      L([0, 0], [-60, -380], [30, -880], 110, 16),
      L([-30, -60], [-90, -20], [-150, 10], 60, 10),
      L([20, -50], [90, -10], [140, 12], 50, 8),
      L([-20, -300], [140, -330], [300, -520], 40, 6),
      L([210, -420], [250, -560], [360, -610], 16, 3),
      L([-40, -470], [-200, -500], [-290, -760], 34, 5),
      L([-220, -600], [-150, -720], [-160, -820], 14, 3),
      L([0, -640], [140, -700], [200, -860], 26, 4),
      L([140, -740], [230, -760], [300, -720], 12, 2.5),
      L([20, -820], [-60, -900], [-140, -930], 14, 3),
    ];
    const dots = [];
    for (let i = 0; i < dust; i++) {
      const L = limbs[Math.floor(R() * limbs.length * 0.999)];
      const t = R();
      const [x, y] = qpt(L[0], L[1], L[2], t);
      const w = L[3] + (L[4] - L[3]) * t;
      dots.push([x + (R() - 0.5) * w * 1.6, y + (R() - 0.5) * w, 0.8 + R() * 2.6 * s + 0.6, 0.35 + R() * 0.6]);
    }
    return { limbs, dots };
  }, [h, R, dust]);
  return (
    <>
      <ellipse cx={0} cy={-h * 0.5} rx={h * 0.3} ry={h * 0.55} fill={`url(#${p}-f-glow)`} opacity="0.2" />
      {parts.limbs.map((L, i) => (
        <path key={i} d={limb(L[0], L[1], L[2], L[3], L[4])} fill={fillOf(p, fill)} />
      ))}
      {parts.dots.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={o} />
      ))}
    </>
  );
}

function Twig({ p, h = 300, bend = 0.4, buds = 6, fill = 'violet', stem = '#1d1240', seed = 5, bud = 12 }) {
  const R = useMemo(() => rng(seed), [seed]);
  const data = useMemo(() => {
    const main = [[0, 0], [bend * h * 0.3, -h * 0.5], [bend * h, -h]];
    const subs = [];
    for (let i = 0; i < buds; i++) {
      const t = 0.3 + (i / buds) * 0.7;
      const [x, y] = qpt(main[0], main[1], main[2], t);
      const side = i % 2 ? 1 : -1;
      const len = h * (0.12 + R() * 0.1);
      const end = [x + side * len * 0.8, y - len * 0.7];
      subs.push({ x, y, end, ctrl: [x + side * len * 0.2, y - len * 0.6] });
    }
    return { main, subs };
  }, [h, bend, buds, R]);
  return (
    <>
      <path d={limb(data.main[0], data.main[1], data.main[2], Math.max(4, h * 0.022), 1.4)} fill={stem} />
      {data.subs.map((s, i) => (
        <g key={i}>
          <path d={`M${s.x},${s.y} Q${s.ctrl[0]},${s.ctrl[1]} ${s.end[0]},${s.end[1]}`} stroke={stem} strokeWidth="2.2" fill="none" />
          <ellipse cx={s.end[0]} cy={s.end[1]} rx={bud * 0.62} ry={bud} fill={fillOf(p, fill)} transform={`rotate(${i % 2 ? 25 : -25} ${s.end[0]} ${s.end[1]})`} />
        </g>
      ))}
      <ellipse cx={data.main[2][0]} cy={data.main[2][1]} rx={bud * 0.66} ry={bud * 1.05} fill={fillOf(p, fill)} />
    </>
  );
}

function Tuft({ p, h = 90, n = 7, fill = 'jade', seed = 2 }) {
  const R = useMemo(() => rng(seed), [seed]);
  const blades = useMemo(() => Array.from({ length: n }, (_, i) => ({ x: (i - n / 2) * 7, hh: h * (0.5 + R() * 0.6), b: (R() - 0.5) * 0.9 })), [n, h, R]);
  return blades.map((b, i) => <path key={i} d={limb([b.x, 0], [b.x + b.b * b.hh * 0.2, -b.hh * 0.6], [b.x + b.b * b.hh, -b.hh], 6, 0.6, 8)} fill={fillOf(p, fill)} />);
}

function Lantern({ p, h = 260, bend = 0.5, fill = 'coral', stem = '#0b3a35' }) {
  const top = [bend * h * 0.6, -h];
  const tip = [bend * h, -h * 0.82];
  return (
    <>
      <path d={limb([0, 0], [bend * h * -0.1, -h * 0.75], top, 6, 2.5, 14)} fill={stem} />
      <path d={`M${top[0]},${top[1]} Q${tip[0]},${top[1] - 10} ${tip[0]},${tip[1]}`} stroke={stem} strokeWidth="2.5" fill="none" />
      <ellipse cx={tip[0]} cy={tip[1] + h * 0.07} rx={h * 0.06} ry={h * 0.085} fill={fillOf(p, fill)} />
      <circle cx={tip[0]} cy={tip[1] + h * 0.07} r={h * 0.2} fill={`url(#${p}-f-glow)`} opacity="0.25" />
    </>
  );
}

const SHAPES = {
  blade: Blade,
  paddle: Paddle,
  frond: Frond,
  capsule: Capsule,
  canopy: Canopy,
  cone: Cone,
  discs: Discs,
  glowtree: GlowTree,
  twig: Twig,
  tuft: Tuft,
  lantern: Lantern,
};

/**
 * <Plant kind x y s r flip className .../>
 * Outer <g> places the plant. `.plant` is for entrances (grow/scale),
 * `.sway` is for ambient motion — never the same element.
 */
export function Plant({ kind, x = 0, y = 0, s = 1, r = 0, flip = false, className = '', p = 'g', opacity, ...rest }) {
  const Shape = SHAPES[kind];
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${flip ? -s : s} ${s})`} opacity={opacity}>
      <g className={`plant ${className}`}>
        <g className="sway">
          <Shape p={p} {...rest} />
        </g>
      </g>
    </g>
  );
}

export function Plants({ list, p = 'g', className = '' }) {
  return list.map((pl, i) => <Plant key={i} p={p} {...pl} className={`${className} ${pl.className || ''}`} />);
}
