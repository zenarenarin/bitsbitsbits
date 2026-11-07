import { useRef } from 'react';
import gsap from 'gsap';
import { scene04 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { pluck, note, thump, chord } from '../../systems/audio/sound.js';
import { FoliageDefs, Plants, limb } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax } from '../../systems/environment/atmosphere.jsx';
import { Motes } from '../../systems/environment/Motes.jsx';
import './scene04.css';

/* Two systems on one stage. On the left, a complete idea (one disc) is cut
   into rules, broken into mechanics and scattered into details — it unfolds
   downward. On the right, loose tiles find partners, collide, merge and climb
   into a finished board — it assembles upward. Both pass through the same row
   of mechanics, which is where they finally meet. */

const MY = 668; // the shared mechanics line
const L = { cx: 700, concept: 340, rules: 510, details: 850 };
const Rr = { cx: 1210, game: 360, interaction: 810, action: 912 };
const BW = 64;
const BH = 40;
const rowX = (x0) => Array.from({ length: 6 }, (_, i) => x0 + i * (BW + 8));
const LROW = rowX(L.cx - (6 * BW + 5 * 8) / 2);
const RROW = rowX(Rr.cx - (6 * BW + 5 * 8) / 2);

// rules: three bars, each will split into two mechanics blocks
const BAR_W = 2 * BW + 8;
const BARS = [0, 1, 2].map((i) => LROW[i * 2]);
// details: 24 dots settle into a loose field
const DOTS = Array.from({ length: 24 }, (_, i) => ({
  from: i % 6,
  x: L.cx - 220 + ((i * 97) % 440) + ((i * 13) % 17),
  y: L.details - 30 + ((i * 53) % 70),
  r: 5 + (i % 3) * 2,
  c: ['#ff6a55', '#ffc94a', '#f5ead3'][i % 3],
}));
// action: twelve loose tiles
const TILES = Array.from({ length: 12 }, (_, i) => ({
  x: Rr.cx - 206 + i * 37.5 + ((i * 7) % 5),
  y: Rr.action + (i % 2 ? 26 : -22) + ((i * 13) % 9),
  r: ((i * 47) % 40) - 20,
  c: i % 2 ? '#34d6c2' : '#ffc94a',
}));
// interaction: pair i ↔ i+6, meeting halfway along the row above
const PAIRS = Array.from({ length: 6 }, (_, i) => [i, i + 6]);
// game: 3 × 2 board
const CELL = 104;
const BOARD = Array.from({ length: 6 }, (_, i) => ({
  x: Rr.cx - (3 * CELL + 2 * 10) / 2 + (i % 3) * (CELL + 10),
  y: Rr.game - CELL - 5 + Math.floor(i / 3) * (CELL + 10),
}));

/* The world: on the left a great tree at night — the whole idea — that is
   unpacked into branches (rules), leaves (mechanics) and spores (details).
   On the right a seedbed — loose seeds sprout tendrils, fuse into buds and
   climb a vine into a bloom. A single vine carries the shared mechanics. */
const LEFT_FLORA = [
  { kind: 'paddle', x: -40, y: -40, s: 1.05, r: 132, h: 460, w: 180, stripes: 6, fill: 'deep', stripe: '#0b3a35' },
  { kind: 'twig', x: 300, y: -20, s: 1, r: 176, h: 320, bend: 0.4, buds: 6, fill: 'violet', stem: '#160e33', seed: 4 },
  { kind: 'blade', x: 30, y: 1110, r: 16, h: 520, w: 90, bend: 0.3, fill: 'deep' },
  { kind: 'frond', x: 130, y: 1120, s: 0.9, r: 26, h: 380, n: 12, leaf: 44, bend: 0.4, fill: 'night' },
];
const RIGHT_FLORA = [
  { kind: 'frond', x: 1940, y: 700, s: 1, r: -40, h: 420, n: 12, leaf: 46, bend: -0.4, fill: 'teal', stem: '#0a3d40' },
  { kind: 'tuft', x: 1020, y: 975, s: 1.4, fill: 'jade', seed: 3 },
  { kind: 'tuft', x: 1260, y: 985, s: 1.2, fill: 'teal', seed: 5 },
  { kind: 'tuft', x: 1450, y: 975, s: 1.3, fill: 'jade', seed: 7 },
  { kind: 'lantern', x: 1120, y: 990, s: 0.8, h: 180, bend: 0.5, fill: 'sun', stem: '#0b3a35' },
];
const VINE = `M${Rr.cx + 280},995 C${Rr.cx + 330},880 ${Rr.cx + 250},${MY + 90} ${Rr.cx + 262},${MY} S${Rr.cx + 290},${Rr.game + 120} ${Rr.cx + 210},${Rr.game - 125}`;

export default function Scene04({ beat, replayKey, lite }) {
  const scope = useRef(null);
  useParallax(scope, { enabled: !lite, strength: 14 });

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 1 : 2 });
      gsap.to(q('.s4-trunk-glow'), { opacity: 0.55, duration: 3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      gsap.to(q('.s4-disc'), { y: -6, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      q('.s4-tile-in').forEach((t, i) =>
        gsap.to(t, { y: -6 - (i % 3) * 3, rotation: i % 2 ? 6 : -6, duration: 1.4 + (i % 4) * 0.3, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 50%' }),
      );
      gsap.to(q('.s4-disc-spin'), { scale: 1.03, duration: 2.2, yoyo: true, repeat: -1, ease: 'sine.inOut', svgOrigin: `${L.cx} ${L.concept}` });
    },
    init: (q) => {
      gsap.set(q('.s4-head .split-line, .s4-anchor .split-line'), { yPercent: 110, opacity: 0 });
      gsap.set(q('.s4-arrow, .s4-lvl, .s4-ex'), { opacity: 0, y: 16 });
      gsap.set(q('.s4-half'), { scaleY: 0, transformOrigin: '50% 0%' });
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s4-tree'), { opacity: 0, y: 40 });
      gsap.set(q('.s4-vine'), { strokeDasharray: 1400, strokeDashoffset: 1400 });
      gsap.set(q('.s4-divider'), { scaleY: 0, transformOrigin: '50% 50%' });
      // left
      gsap.set(q('.s4-disc'), { scale: 0, transformOrigin: '50% 50%' });
      gsap.set(q('#s4-clip circle'), { attr: { r: 120 } });
      q('.s4-slice').forEach((s, i) => gsap.set(s, { attr: { x: L.cx - 120, y: L.concept - 120 + i * 80, width: 240, height: 80, rx: 0 } }));
      gsap.set(q('.s4-lblock'), { opacity: 0 });
      gsap.set(q('.s4-dot'), { opacity: 0 });
      // right
      gsap.set(q('.s4-tile'), { scale: 0, transformOrigin: '50% 50%' });
      gsap.set(q('.s4-link'), { strokeDashoffset: 1, opacity: 1 });
      gsap.set(q('.s4-rblock'), { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' });
      gsap.set(q('.s4-cell'), { opacity: 0 });
      gsap.set(q('.s4-frame'), { strokeDashoffset: 1 });
      // meet
      gsap.set(q('.s4-meetline'), { strokeDasharray: 1200, strokeDashoffset: 1200 });
    },
    beats: [
      // 0 — the question, two directions, two starting points
      (tl, q) => {
        tl.to(q('.s4-half'), { scaleY: 1, duration: 1, ease: 'expo.inOut', stagger: 0.1 }, 0)
          .to(q('.plant'), { scale: 1, duration: 1, ease: 'back.out(1.6)', stagger: { each: 0.05, from: 'random' } }, 0.5)
          .to(q('.s4-tree'), { opacity: 1, y: 0, duration: 1.4, ease: 'expo.out' }, 0.4)
          .to(q('.s4-vine'), { strokeDashoffset: 0, duration: 1.8, ease: 'power2.inOut' }, 0.9)
          .to(q('.s4-divider'), { scaleY: 1, duration: 1.1, ease: 'expo.out' }, 0.3)
          .to(q('.s4-head .split-line'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.1 }, 0.4)
          .to(q('.s4-anchor .split-line'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.15 }, 0.8)
          .to(q('.s4-arrow'), { opacity: 1, y: 0, duration: 0.7 }, 1.2)
          .to(q('.s4-lvl'), { opacity: 1, y: 0, duration: 0.6, stagger: 0.05 }, 1.3)
          .to(q('.s4-disc'), { scale: 1, duration: 1, ease: 'elastic.out(1, 0.5)' }, 1.0)
          .to(q('.s4-tile'), { scale: 1, duration: 0.6, ease: 'back.out(3)', stagger: { each: 0.05, from: 'random' } }, 1.2)
          .call(() => thump({ freq: 90, vol: 0.25 }), null, 1.05);
      },
      // 1 — top down: a whole idea is cut, broken, scattered
      (tl, q, { instant }) => {
        const slices = q('.s4-slice');
        tl.to(q('.s4-ex-top'), { opacity: 1, y: 0, duration: 0.8 }, 0)
          // anticipation: the disc tightens before it opens
          .to(q('.s4-disc'), { scale: 0.92, duration: 0.25, ease: 'power2.in' }, 0.1)
          .to(q('#s4-clip circle'), { attr: { r: 1400 }, duration: 0.9, ease: 'power2.in' }, 0.35)
          .to(q('.s4-disc'), { scale: 1, duration: 0.3 }, 0.35);
        slices.forEach((s, i) =>
          tl.to(s, { attr: { x: BARS[i], y: L.rules - BH / 2, width: BAR_W, height: BH, rx: BH / 2 }, duration: 0.85, ease: 'power3.inOut' }, 0.4 + i * 0.06),
        );
        if (!instant) tl.call(() => pluck(note(4, 220), { vol: 0.16 }), null, 1.2);
        // rules break into mechanics
        tl.set(slices, { opacity: 0 }, 1.6).set(q('.s4-lblock'), { opacity: 1 }, 1.6);
        q('.s4-lblock').forEach((b, i) => {
          tl.fromTo(
            b,
            { attr: { x: BARS[Math.floor(i / 2)] + (i % 2) * (BW + 8), y: L.rules - BH / 2 } },
            { attr: { x: LROW[i], y: MY - BH / 2 }, duration: 0.7, ease: 'bounce.out' },
            1.6 + i * 0.05,
          );
        });
        if (!instant) tl.call(() => thump({ freq: 120, vol: 0.25 }), null, 2.1);
        // mechanics shed their details
        q('.s4-dot').forEach((d, i) => {
          const D = DOTS[i];
          tl.fromTo(
            d,
            { opacity: 1, attr: { cx: LROW[D.from] + BW / 2, cy: MY } },
            { attr: { cx: D.x, cy: D.y }, duration: 0.9, ease: 'power2.in' },
            2.5 + i * 0.025,
          );
        });
        if (!instant) tl.call(() => chord([0, 2, 4], 330, { vol: 0.08, spread: 0.05 }), null, 3.2);
      },
      // 2 — bottom up: loose actions meet, merge, climb into a game
      (tl, q, { instant }) => {
        const tiles = q('.s4-tile');
        tl.to(q('.s4-ex-bot'), { opacity: 1, y: 0, duration: 0.8 }, 0);
        // pairs approach each other on the interaction line
        PAIRS.forEach(([a, b], k) => {
          const mx = RROW[k] + BW / 2;
          tl.to(tiles[a], { x: mx - 22 - TILES[a].x, y: Rr.interaction - TILES[a].y, rotation: 0, duration: 0.7, ease: 'power3.out' }, 0.2 + k * 0.06);
          tl.to(tiles[b], { x: mx + 22 - TILES[b].x, y: Rr.interaction - TILES[b].y, rotation: 0, duration: 0.7, ease: 'power3.out' }, 0.25 + k * 0.06);
        });
        tl.to(q('.s4-link'), { strokeDashoffset: 0, duration: 0.4, stagger: 0.05 }, 0.9);
        // collision → merge
        PAIRS.forEach(([a, b], k) => {
          const mx = RROW[k] + BW / 2;
          tl.to([tiles[a], tiles[b]], { x: (j) => mx - [TILES[a], TILES[b]][j].x, duration: 0.22, ease: 'power3.in' }, 1.5 + k * 0.08);
          tl.set([tiles[a], tiles[b]], { opacity: 0 }, 1.72 + k * 0.08);
          tl.fromTo(q('.s4-rblock')[k], { opacity: 1, scale: 1.5, attr: { y: Rr.interaction - BH / 2 } }, { scale: 1, duration: 0.5, ease: 'elastic.out(1.2, 0.4)' }, 1.72 + k * 0.08);
          if (!instant) tl.call(() => pluck(note(2 + k, 220), { vol: 0.12, decay: 0.4 }), null, 1.72 + k * 0.08);
        });
        tl.to(q('.s4-link'), { opacity: 0, duration: 0.3 }, 1.8);
        // climb to the mechanics row
        tl.to(q('.s4-rblock'), { attr: { y: MY - BH / 2 }, duration: 0.7, ease: 'back.out(1.6)', stagger: 0.05 }, 2.4);
        // copies climb on and lock into a board
        q('.s4-cell').forEach((c, i) => {
          tl.fromTo(
            c,
            { opacity: 1, attr: { x: RROW[i], y: MY - BH / 2, width: BW, height: BH } },
            { attr: { x: BOARD[i].x, y: BOARD[i].y, width: CELL, height: CELL }, duration: 0.8, ease: 'power3.inOut' },
            3.1 + i * 0.07,
          );
        });
        tl.to(q('.s4-frame'), { strokeDashoffset: 0, duration: 0.8, ease: 'power2.inOut' }, 3.9);
        if (!instant) tl.call(() => chord([0, 4, 7, 9], 262, { vol: 0.12, spread: 0.06 }), null, 4.0);
      },
      // 3 — both pass through the same layer
      (tl, q, { instant }) => {
        tl.to(q('.s4-dim'), { opacity: 0.32, duration: 0.6 }, 0)
          .to(q('.s4-meetline'), { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, 0.1)
          .to(q('.s4-lblock, .s4-rblock'), { fill: '#ff8a6a', duration: 0.3, stagger: { each: 0.05, from: 'start' } }, 0.5)
          .to(q('.s4-lblock, .s4-rblock'), { y: -14, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out', stagger: 0.05 }, 0.5)
          .to(q('.s4-lvl-m'), { scale: 1.45, backgroundColor: '#ff6a55', color: '#0a1430', borderColor: '#ff6a55', duration: 0.7, ease: 'back.out(2.5)' }, 0.7);
        if (!instant) tl.call(() => chord([0, 4, 7, 12], 220, { vol: 0.14, spread: 0.04, decay: 1.8 }), null, 0.7);
      },
    ],
  });

  const ex = C.examples;
  return (
    <div ref={scope} className="scene s4">
      <div className="s4-half s4-half-l" />
      <div className="s4-half s4-half-r" />

      <svg className="fill" viewBox="0 0 1920 1080">
        <defs>
          <clipPath id="s4-clip">
            <circle cx={L.cx} cy={L.concept} r="120" />
          </clipPath>
          <radialGradient id="s4-disc-g" cx="0.4" cy="0.35">
            <stop offset="0" stopColor="#ffb08a" />
            <stop offset="1" stopColor="#e2442f" />
          </radialGradient>
        </defs>
        <FoliageDefs prefix="s4" />
        <defs>
          <linearGradient id="s4-leaf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff3d6" />
            <stop offset="1" stopColor="#e9c98a" />
          </linearGradient>
          <radialGradient id="s4-seed" cx="0.35" cy="0.3">
            <stop offset="0" stopColor="#fff6d6" />
            <stop offset="1" stopColor="#d99a2a" />
          </radialGradient>
        </defs>
        {/* left territory: a great tree, the whole idea */}
        <g data-depth="0.25" opacity="0.35">
          {[120, 340, 560].map((x, i) => (
            <path key={i} d={limb([x, 1090], [x + 14, 600], [x - 6, -20], 46 - i * 8, 26 - i * 4)} fill="#1a2a66" />
          ))}
        </g>
        <g className="s4-tree" data-depth="0.4">
          <g className="s4-trunk-glow" opacity="0.4">
            <Plants list={[{ kind: 'glowtree', x: L.cx + 10, y: 1100, s: 1, h: 900, seed: 21, dust: 120 }]} p="s4" />
          </g>
        </g>
        <g data-depth="1">
          <Plants list={LEFT_FLORA} p="s4" />
        </g>
        {/* right territory: a seedbed and the vine that climbs out of it */}
        <path d="M960,1000 C1200,960 1600,975 1940,990 V1100 H960Z" fill="#06261f" />
        <path className="s4-vine" d={VINE} fill="none" stroke="#1d7a5e" strokeWidth="9" strokeLinecap="round" opacity="0.8" />
        <g data-depth="1">
          <Plants list={RIGHT_FLORA} p="s4" />
        </g>
        <line className="s4-divider" x1="960" y1="170" x2="960" y2="1010" stroke="#f5ead3" strokeOpacity="0.14" strokeWidth="2" strokeDasharray="2 10" />

        {/* level guides */}
        <g className="s4-dim">
          {[L.concept, L.rules, L.details].map((y) => (
            <line key={'l' + y} x1="440" x2="930" y1={y} y2={y} stroke="#f5ead3" strokeOpacity="0.08" strokeWidth="2" />
          ))}
          {[Rr.game, Rr.interaction, Rr.action].map((y) => (
            <line key={'r' + y} x1="990" x2="1480" y1={y} y2={y} stroke="#f5ead3" strokeOpacity="0.08" strokeDasharray="2 10" strokeWidth="2" />
          ))}
        </g>
        <path className="s4-meetline" d={`M420,${MY + 6} C700,${MY - 18} 1200,${MY + 22} 1500,${MY - 4}`} fill="none" stroke="#5fd6a8" strokeWidth="6" strokeLinecap="round" />

        {/* top down */}
        <g className="s4-disc">
          <g className="s4-disc-spin" clipPath="url(#s4-clip)">
            {[0, 1, 2].map((i) => (
              <rect key={i} className="s4-slice" x={L.cx - 120} y={L.concept - 120 + i * 80} width="240" height="80" rx="0" fill={['#5fd6a8', '#2fb3a8', '#1d7a5e'][i]} />
            ))}
          </g>
        </g>
        {LROW.map((x, i) => (
          <rect key={i} className="s4-lblock" x={x} y={MY - BH / 2} width={BW} height={BH} rx={BH / 2} fill="url(#s4-leaf)" />
        ))}
        <g className="s4-dim">
          {DOTS.map((d, i) => (
            <circle key={i} className="s4-dot" cx={d.x} cy={d.y} r={d.r} fill={d.c} />
          ))}
        </g>

        {/* bottom up */}
        {PAIRS.map(([a, b], k) => (
          <path key={k} className="s4-link" d={`M${RROW[k] + BW / 2 - 22},${Rr.interaction} q11,-22 22,0 t22,0`} fill="none" stroke="#8ff7dc" strokeWidth="3" strokeLinecap="round" pathLength="1" strokeDasharray="1" />
        ))}
        {TILES.map((t, i) => (
          <g key={i} className="s4-tile" style={{ transformBox: 'fill-box' }}>
            <g transform={`translate(${t.x} ${t.y}) rotate(${t.r})`}>
              <ellipse className="s4-tile-in" cx="0" cy="0" rx="15" ry="19" fill={t.c === '#ffc94a' ? 'url(#s4-seed)' : t.c} />
            </g>
          </g>
        ))}
        {RROW.map((x, i) => (
          <rect key={i} className="s4-rblock" x={x} y={MY - BH / 2} width={BW} height={BH} rx={BH / 2} fill="url(#s4-leaf)" />
        ))}
        <g className="s4-dim">
          {BOARD.map((_, i) => (
            <rect key={i} className="s4-cell" x={BOARD[i].x} y={BOARD[i].y} width={CELL} height={CELL} rx="40" fill={i % 2 ? 'url(#s4-f-sea)' : 'url(#s4-f-sun)'} />
          ))}
          <rect className="s4-frame" x={BOARD[0].x - 16} y={BOARD[0].y - 16} width={3 * CELL + 20 + 32} height={2 * CELL + 10 + 32} rx="60" fill="none" stroke="#5fd6a8" strokeWidth="5" pathLength="1" strokeDasharray="1" />
        </g>
      </svg>

      <Motes lite={lite} count={70} colors={['#8ff7dc', '#ffd98a']} size={26} speed={0.5} />

      {/* type */}
      <h2 className="s4-head">
        <span className="mask-line">
          <span className="split-line">
            <span className="t-display">{C.headline[0]}</span> <span className="t-quote">{C.headline[1]}</span>
          </span>
        </span>
      </h2>

      <div className="s4-anchor s4-anchor-top">
        {C.topDown.split(' ').map((w) => (
          <span key={w} className="mask-line"><span className="split-line t-display">{w}</span></span>
        ))}
        <svg className="s4-arrow" width="44" height="90" viewBox="0 0 44 90"><path d="M22 0 V84 M4 66 L22 86 L40 66" fill="none" stroke="#ff6a55" strokeWidth="5" /></svg>
      </div>
      <div className="s4-ex s4-ex-top">
        <span className="t-quote g">{ex.topDown.game}</span>
        <span className="l">{ex.topDown.line}</span>
      </div>

      <div className="s4-anchor s4-anchor-bot">
        <svg className="s4-arrow" width="44" height="90" viewBox="0 0 44 90"><path d="M22 90 V6 M4 24 L22 4 L40 24" fill="none" stroke="#34d6c2" strokeWidth="5" /></svg>
        {C.bottomUp.split(' ').map((w) => (
          <span key={w} className="mask-line"><span className="split-line t-display">{w}</span></span>
        ))}
      </div>
      <div className="s4-ex s4-ex-bot">
        <span className="t-quote g">{ex.bottomUp.game}</span>
        <span className="l">{ex.bottomUp.line}</span>
      </div>

      {C.left.map((l, i) =>
        l === C.meet ? null : (
          <div key={l} className="s4-lvl s4-dim t-mono" style={{ left: LROW[0], top: [L.concept - 120 - 44, L.rules - 64, 0, L.details - 84][i] }}>
            {l}
          </div>
        ),
      )}
      {C.right.map((l, i) =>
        l === C.meet ? null : (
          <div key={l} className="s4-lvl s4-dim t-mono" style={{ left: RROW[0], top: [Rr.action - 70, Rr.interaction - 60, 0, Rr.game - CELL - 70][i] }}>
            {l}
          </div>
        ),
      )}
      <div className="s4-lvl s4-lvl-m t-mono" style={{ left: 960, top: MY - 108 }}>
        {C.meet}
      </div>
    </div>
  );
}
