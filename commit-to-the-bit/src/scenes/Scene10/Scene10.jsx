import { useRef } from 'react';
import gsap from 'gsap';
import { scene10 as C, opening as O } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { rectInStage } from '../../systems/typography/measure.js';
import { pluck, note, thump, chord } from '../../systems/audio/sound.js';
import { FoliageDefs, Plants } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax } from '../../systems/environment/atmosphere.jsx';
import { Motes } from '../../systems/environment/Motes.jsx';
import './scene10.css';

// the opening's world, grown: the same night, the same canopy line, the
// luminous tree — now holding everything the talk has gathered
const HORIZON = [
  { kind: 'canopy', x: 980, y: 1090, s: 0.7, fill: 'mist', seed: 2 },
  { kind: 'cone', x: 1120, y: 1090, s: 0.9, h: 240, w: 90, fill: 'mist' },
  { kind: 'canopy', x: 1290, y: 1095, s: 0.55, fill: 'mist', seed: 6 },
  { kind: 'discs', x: 1500, y: 1095, s: 0.8, h: 280, size: 100, n: 3, fill: 'mist', stem: '#0b3e44' },
  { kind: 'canopy', x: 1700, y: 1090, s: 0.8, fill: 'mist', seed: 9 },
];
const FRAME = [
  { kind: 'twig', x: 1520, y: -20, s: 1, r: 186, h: 320, bend: 0.4, buds: 7, fill: 'violet', stem: '#160e33', seed: 4 },
  { kind: 'frond', x: 1960, y: -30, s: 1, r: 208, h: 420, n: 13, leaf: 46, bend: 0.4, fill: 'night' },
  { kind: 'paddle', x: 2060, y: 1160, s: 0.95, r: -50, h: 480, w: 200, stripes: 7, fill: 'forest', stripe: '#03201a', flip: true },
  { kind: 'twig', x: 1250, y: -20, s: 0.8, r: 170, h: 280, bend: -0.4, buds: 6, fill: 'coral', stem: '#160e33', seed: 9 },
];

/* The finale gathers one motif from each idea in the talk — the wall you
   chose to jump, the tiles that merged, the dish of grammar, the fence, the
   corridor, the flow channel, the flower that caught the seed. They arrive
   from every direction, a single thread runs through them all and ends at
   the Bit. Then the Bit goes back to work: it becomes a full stop. */

const NODES = [
  { id: 'wall', x: 1040, y: 250, from: [-700, -200] },
  { id: 'tiles', x: 1290, y: 170, from: [0, -500] },
  { id: 'dish', x: 1680, y: 270, from: [600, -300] },
  { id: 'fence', x: 1730, y: 600, from: [700, 0] },
  { id: 'corridor', x: 1360, y: 560, from: [300, 500] },
  { id: 'flow', x: 1010, y: 650, from: [-600, 300] },
  { id: 'flower', x: 1170, y: 920, from: [-200, 600] },
];
const END = { x: 1600, y: 900 };
const PTS = [...NODES.map((n) => [n.x, n.y]), [END.x, END.y]];

// a smooth curve through every point (Catmull-Rom → cubic Bézier)
function through(p) {
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const THREAD = through(PTS);

function Glyph({ id }) {
  switch (id) {
    case 'wall':
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="-36" y={20 - i * 40} width="72" height="37" rx="5" fill="#3c3cb0" />
              <rect x="-36" y={20 - i * 40} width="72" height="7" rx="4" fill="#7a7cf0" />
            </g>
          ))}
        </g>
      );
    case 'tiles':
      return (
        <g>
          <rect x="-52" y="-52" width="48" height="48" rx="9" fill="#ffc94a" />
          <rect x="4" y="-52" width="48" height="48" rx="9" fill="#34d6c2" />
          <rect x="-52" y="4" width="48" height="48" rx="9" fill="#34d6c2" />
          <rect x="4" y="4" width="48" height="48" rx="9" fill="#f5ead3" />
        </g>
      );
    case 'dish':
      return (
        <g>
          <circle r="58" fill="#1a1440" stroke="#e3d6ba" strokeWidth="7" />
          <path d="M14,-26 L26,-8 L14,10 L2,-8Z" fill="#ffc94a" />
          <circle cx="-18" cy="18" r="11" fill="#ff6a55" />
        </g>
      );
    case 'fence':
      return (
        <g>
          {Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2;
            return <rect key={i} x="-4" y="-9" width="8" height="18" rx="2" fill="#f5ead3" transform={`translate(${Math.cos(a) * 52} ${Math.sin(a) * 52}) rotate(${(a * 180) / Math.PI})`} />;
          })}
        </g>
      );
    case 'corridor':
      return (
        <g>
          <rect x="-70" y="-40" width="140" height="80" fill="#121a4a" />
          <rect x="-70" y="-43" width="140" height="4" fill="#ffc94a" />
          <rect x="-70" y="39" width="140" height="4" fill="#ffc94a" />
          <rect x="18" y="8" width="22" height="31" rx="4" fill="#f5ead3" />
          <rect x="-26" y="-39" width="20" height="28" rx="4" fill="#ff6a55" />
        </g>
      );
    case 'flow':
      return (
        <g transform="rotate(-45)">
          <rect x="-74" y="-17" width="148" height="34" rx="17" fill="#1fa596" />
          <path d="M-56,0 q10,-12 20,0 t20,0 t20,0 t20,0 t20,0" fill="none" stroke="#ffe7a0" strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M-6,46 Q-2,22 0,6" stroke="#16614f" strokeWidth="7" fill="none" strokeLinecap="round" />
          <ellipse cx="-24" cy="-14" rx="16" ry="28" fill="#e4702a" transform="rotate(-18 -24 -14)" />
          <ellipse cx="24" cy="-14" rx="16" ry="28" fill="#e4702a" transform="rotate(18 24 -14)" />
          <path d="M-38,-18 Q-36,16 0,16 Q36,16 38,-18 Q0,-4 -38,-18Z" fill="#ff6a55" />
        </g>
      );
  }
}

export default function Scene10({ beat, replayKey, lite }) {
  const scope = useRef(null);
  useParallax(scope, { enabled: !lite, strength: 14 });

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 1 : 2 });
      gsap.to(q('.s10-tree'), { opacity: 0.5, duration: 3.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    },
    init: (q) => {
      gsap.set(q('.s10-world .plant'), { scale: 0, transformOrigin: '50% 100%' });
      q('.s10-node').forEach((n, i) => gsap.set(n, { x: NODES[i].from[0], y: NODES[i].from[1], rotation: (i % 2 ? 1 : -1) * 70, scale: 0.6, opacity: 0 }));
      gsap.set(q('.s10-thread'), { strokeDashoffset: 1 });
      gsap.set(q('.s10-ring'), { scale: 0, opacity: 0, transformOrigin: '50% 50%' });
      gsap.set(q('.s10-word'), { yPercent: -160, opacity: 0, rotation: 0 });
      gsap.set(q('.s10-now'), { opacity: 0 });
      gsap.set(q('.s10-bit'), { x: END.x, y: END.y, scale: 0, opacity: 1 });
      gsap.set(q('.s10-sign'), { opacity: 0, y: 20 });
      gsap.set(q('.s10-glow'), { opacity: 0 });
    },
    beats: [
      // everything arrives, one thread joins it, the words drop in
      (tl, q, { instant }) => {
        tl.to(q('.s10-glow'), { opacity: 1, duration: 2 }, 0).to(q('.s10-world .plant'), { scale: 1, duration: 1.2, ease: 'back.out(1.5)', stagger: { each: 0.06, from: 'random' } }, 0);
        q('.s10-node').forEach((n, i) => {
          tl.to(n, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 1.1, ease: 'back.out(1.5)' }, 0.1 + i * 0.12);
        });
        tl.to(q('.s10-thread'), { strokeDashoffset: 0, duration: 2.2, ease: 'power1.inOut' }, 1.3);
        q('.s10-ring').forEach((r, i) => {
          const at = 1.3 + (i / (PTS.length - 1)) * 2.2;
          tl.to(r, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(3)' }, at);
          if (!instant) tl.call(() => pluck(note(i + 2, 220), { vol: 0.15, decay: 0.9 }), null, at);
        });
        tl.to(q('.s10-bit'), { scale: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.4)' }, 3.5);
        q('.s10-word').forEach((w, i) => {
          tl.to(w, { yPercent: 0, opacity: 1, duration: 0.55, ease: 'bounce.out' }, 3.9 + i * 0.32);
          if (!instant) tl.call(() => thump({ freq: 120 - i * 15, vol: 0.3 }), null, 4.15 + i * 0.32);
        });
      },
      // Now make one. — the Bit leaves the constellation and becomes its full stop
      (tl, q, { instant }) => {
        const slot = q('.s10-slot')[0];
        const bit = q('.s10-bit')[0];
        tl.to(q('.s10-now'), { opacity: 1, duration: 0.01 }, 0)
          .fromTo(q('.s10-now .w'), { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.08 }, 0)
          .to(bit, { x: () => rectInStage(slot).cx, duration: 1.0, ease: 'power1.inOut' }, 0.6)
          .to(bit, { y: () => rectInStage(slot).cy - 260, duration: 0.5, ease: 'power2.out' }, 0.6)
          .to(bit, { y: () => rectInStage(slot).cy, duration: 0.5, ease: 'power2.in' }, 1.1)
          .to(bit, { scaleX: 1.5, scaleY: 0.55, duration: 0.07, transformOrigin: '50% 100%' }, 1.6)
          .to(bit, { scaleX: 1, scaleY: 1, duration: 0.9, ease: 'elastic.out(1.1, 0.32)' }, 1.67);
        if (!instant) tl.call(() => thump({ freq: 140, vol: 0.4 }), null, 1.6).call(() => chord([0, 4, 7, 12], 262, { vol: 0.14, spread: 0.06, decay: 2.2 }), null, 1.7);
      },
      // the signature
      (tl, q) => tl.to(q('.s10-sign'), { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out' }, 0.2),
    ],
  });

  return (
    <div ref={scope} className="scene s10">
      <div className="layer s10-glow" />
      <svg className="fill s10-world" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s10" />
        <g data-depth="0.2" className="s10-tree" opacity="0.38">
          <Plants list={[{ kind: 'glowtree', x: 1930, y: 1100, s: 1, h: 820, seed: 11, dust: 130 }]} p="s10" />
        </g>
        <g data-depth="0.3" opacity="0.6">
          <Plants list={HORIZON} p="s10" />
        </g>
        <g data-depth="1.1">
          <Plants list={FRAME} p="s10" />
        </g>
      </svg>
      <Motes lite={lite} count={80} colors={['#8ff7dc', '#ffd98a']} size={26} speed={0.5} />
      <svg className="fill" viewBox="0 0 1920 1080">
        <path className="s10-thread" d={THREAD} fill="none" stroke="#ffe7a0" strokeWidth="3.5" strokeLinecap="round" pathLength="1" strokeDasharray="1" />
        {PTS.map(([x, y], i) => (
          <circle key={i} className="s10-ring" cx={x} cy={y} r={i === PTS.length - 1 ? 46 : 86} fill="none" stroke="#ffe7a0" strokeOpacity="0.35" strokeWidth="2" />
        ))}
        {NODES.map((n) => (
          <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
            <g className="s10-node">
              <Glyph id={n.id} />
            </g>
          </g>
        ))}
      </svg>

      <h2 className="s10-words t-display">
        {C.words.map((w) => (
          <span key={w} className="s10-wline">
            <span className="s10-word">{w}</span>
          </span>
        ))}
      </h2>

      <p className="s10-now t-quote">
        {C.now.split(' ').map((w, i, a) => (
          <span key={i} className="mask-word split-unit">
            <span className="w split-unit">
              {i === a.length - 1 ? w.replace('.', '') : w}
              {i < a.length - 1 ? ' ' : ''}
            </span>
          </span>
        ))}
        <span className="s10-slot" />
      </p>

      <div className="s10-sign">
        <img src="./assets/brand/plethora-wordmark.png" alt="Plethora" />
        <span className="t-mono">{O.presents}</span>
        <span className="s10-sign-title t-display">{C.signature}</span>
      </div>

      <div className="bit s10-bit" style={{ width: 58, height: 58, margin: '-29px 0 0 -29px' }} />
    </div>
  );
}
