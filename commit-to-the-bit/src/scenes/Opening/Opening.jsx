import { useRef } from 'react';
import gsap from 'gsap';
import { opening as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { FoliageDefs, Plants, limb } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax, Vignette } from '../../systems/environment/atmosphere.jsx';
import { Motes } from '../../systems/environment/Motes.jsx';
import { rectInStage } from '../../systems/typography/measure.js';
import { chord, thump, pluck, note } from '../../systems/audio/sound.js';
import './opening.css';

/* The portal: a forest at night opening onto a clearing where a glowing
   path leads to a low moon. Game primitives rest along the path like toys
   left in a playground. The Bit — the coral light that runs through the
   whole talk — rolls out of the distance and commits to the title. */

const PATH = { p0: [960, 1110], p1: [1230, 880], p2: [960, 712] };
const PATH_D = `M${PATH.p0} Q${PATH.p1} ${PATH.p2}`;

const FAR = [
  { kind: 'canopy', x: 520, y: 742, s: 0.62, fill: 'mist', seed: 2 },
  { kind: 'cone', x: 640, y: 744, s: 0.7, fill: 'mist', h: 230, w: 90 },
  { kind: 'canopy', x: 740, y: 738, s: 0.45, fill: 'mist', seed: 9 },
  { kind: 'canopy', x: 1180, y: 738, s: 0.5, fill: 'mist', seed: 4 },
  { kind: 'cone', x: 1290, y: 742, s: 0.8, fill: 'mist', h: 250, w: 100 },
  { kind: 'canopy', x: 1400, y: 744, s: 0.7, fill: 'mist', seed: 6 },
  { kind: 'canopy', x: 860, y: 732, s: 0.3, fill: 'mist', seed: 12 },
  { kind: 'canopy', x: 1065, y: 732, s: 0.34, fill: 'mist', seed: 13 },
];

const MID = [
  { kind: 'glowtree', x: 250, y: 1000, s: 1, h: 760, seed: 11, dust: 150 },
  { kind: 'discs', x: 600, y: 860, s: 1.05, h: 330, size: 110, fill: 'sea', stem: '#0b4a50' },
  { kind: 'capsule', x: 1420, y: 900, s: 1, h: 380, w: 78, fill: 'violet' },
  { kind: 'capsule', x: 1500, y: 905, s: 1, h: 290, w: 62, fill: 'plum' },
  { kind: 'discs', x: 1580, y: 880, s: 0.8, h: 300, size: 90, n: 2, fill: 'teal', stem: '#0b3e48' },
  { kind: 'lantern', x: 700, y: 900, s: 1.1, h: 260, bend: 0.5, fill: 'coral' },
  { kind: 'lantern', x: 1330, y: 905, s: 0.9, h: 240, bend: -0.5, fill: 'sun', flip: true },
  { kind: 'tuft', x: 820, y: 905, s: 1.2, fill: 'teal', seed: 4 },
  { kind: 'tuft', x: 1120, y: 880, s: 1, fill: 'teal', seed: 8 },
  { kind: 'frond', x: 520, y: 960, s: 1, h: 360, n: 11, bend: 0.5, leaf: 44, fill: 'jade', r: -8 },
  { kind: 'frond', x: 1690, y: 980, s: 1.1, h: 380, n: 12, bend: -0.45, leaf: 46, fill: 'teal', r: 6 },
];

const NEAR = [
  // lower-left mass
  { kind: 'blade', x: 30, y: 1110, r: 22, h: 640, w: 100, bend: 0.3, fill: 'deep' },
  { kind: 'paddle', x: 90, y: 1130, s: 1.05, r: 40, h: 520, w: 210, stripes: 7, fill: 'forest', stripe: '#03201a' },
  { kind: 'paddle', x: 300, y: 1140, s: 0.8, r: 8, h: 460, w: 170, stripes: 6, fill: 'jade', stripe: '#082e26' },
  { kind: 'frond', x: 470, y: 1110, s: 0.9, r: 34, h: 400, n: 13, leaf: 50, bend: 0.4, fill: 'forest' },
  // lower-right mass
  { kind: 'blade', x: 1900, y: 1110, r: -20, h: 680, w: 110, bend: -0.3, fill: 'deep' },
  { kind: 'paddle', x: 1830, y: 1130, s: 1.05, r: -38, h: 520, w: 210, stripes: 7, fill: 'forest', stripe: '#03201a', flip: true },
  { kind: 'paddle', x: 1620, y: 1140, s: 0.78, r: -6, h: 440, w: 160, stripes: 6, fill: 'jade', stripe: '#082e26', flip: true },
  { kind: 'blade', x: 1480, y: 1110, s: 0.9, r: -30, h: 380, w: 74, bend: -0.4, fill: 'forest' },
  // hanging from the top
  { kind: 'paddle', x: -40, y: -60, s: 1.05, r: 130, h: 480, w: 190, stripes: 6, fill: 'deep', stripe: '#0b3a35' },
  { kind: 'twig', x: 210, y: -20, s: 1.1, r: 172, h: 380, bend: 0.45, buds: 7, fill: 'violet', stem: '#160e33', seed: 4 },
  { kind: 'frond', x: 1860, y: -40, s: 1.05, r: 210, h: 440, n: 13, leaf: 46, bend: 0.4, fill: 'night' },
  { kind: 'paddle', x: 1980, y: -40, s: 1, r: -128, h: 460, w: 180, stripes: 5, fill: 'deep', stripe: '#0b3a35', flip: true },
  { kind: 'twig', x: 1680, y: -30, s: 0.9, r: 190, h: 340, bend: -0.4, buds: 6, fill: 'coral', stem: '#160e33', seed: 9 },
];

// Game primitives resting in the clearing — the "playground" inside the forest
const TOYS = [
  { x: 862, y: 820, el: <circle r="20" fill="none" stroke="#ffc94a" strokeWidth="6" /> },
  { x: 1102, y: 846, el: <path d="M0,-26 L24,16 L-24,16Z" fill="#ff6a55" /> },
  { x: 1006, y: 760, el: <rect x="-11" y="-11" width="22" height="22" fill="#f5ead3" transform="rotate(12)" /> },
  { x: 900, y: 948, el: <rect x="-34" y="-8" width="68" height="16" rx="8" fill="#34d6c2" transform="rotate(-8)" /> },
];

export default function Opening({ beat, replayKey, lite }) {
  const scope = useRef(null);
  useParallax(scope, { enabled: !lite });

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 1 : 2.4 });
      gsap.to(q('.op-halo'), { scale: 1.06, opacity: 0.85, duration: 3.2, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 50%' });
      gsap.to(q('.op-flow'), { strokeDashoffset: -240, duration: 3.6, repeat: -1, ease: 'none' });
      q('.op-toy-inner').forEach((t, i) =>
        gsap.to(t, { y: -8 - i * 2, rotation: i % 2 ? 8 : -6, duration: 2.2 + i * 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 50%' }),
      );
    },
    init: (q) => {
      gsap.set(q('.op-sky'), { opacity: 0 });
      gsap.set(q('.op-moon'), { y: 60, opacity: 0 });
      gsap.set(q('.far .plant, .mid .plant'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.near .plant'), { scale: 0.2, opacity: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.op-ground'), { opacity: 0 });
      gsap.set(q('.op-path-line'), { strokeDasharray: 1200, strokeDashoffset: 1200 });
      gsap.set(q('.op-toy'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.op-presents'), { opacity: 0, y: 14 });
      gsap.set(q('.op-title .split-line'), { yPercent: 105 });
      gsap.set(q('.op-sub'), { opacity: 0, y: 20 });
      gsap.set(q('.op-enter'), { opacity: 0 });
      gsap.set(q('.op-bit'), { opacity: 0, x: 960, y: 712, scale: 0.2 });
      gsap.set(q('.motes'), { opacity: 0 });
    },
    beats: [
      (tl, q) => {
        const path = q('.op-path-line')[0];
        tl.to(q('.op-sky'), { opacity: 1, duration: 1.2, ease: 'power2.out' }, 0)
          .to(q('.op-moon'), { y: 0, opacity: 1, duration: 1.8, ease: 'power3.out' }, 0.1)
          .to(q('.far .plant'), { scale: 1, duration: 0.9, ease: 'back.out(1.8)', stagger: { each: 0.05, from: 'center' } }, 0.3)
          .to(q('.op-ground'), { opacity: 1, duration: 0.8 }, 0.35)
          .to(q('.mid .plant'), { scale: 1, duration: 1, ease: 'back.out(1.7)', stagger: { each: 0.06, from: 'random' } }, 0.5)
          .to(q('.near .plant'), { scale: 1, opacity: 1, duration: 1.3, ease: 'back.out(1.25)', stagger: { each: 0.05, from: 'edges' } }, 0.6)
          .to(q('.motes'), { opacity: 1, duration: 2 }, 0.8)
          .to(path, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut' }, 0.9)
          .to(q('.op-toy'), { scale: 1, duration: 0.6, ease: 'back.out(3)', stagger: 0.09 }, 1.4)
          .call(() => chord([0, 2, 4, 7], 220, { vol: 0.12, decay: 1.4, spread: 0.09 }), null, 1.2)
          .to(q('.op-presents'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 1.3)
          .to(q('.op-title .split-line'), { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.12 }, 1.45)
          .to(q('.op-sub'), { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 2.0);

        // The Bit rolls out of the distance along the path, then leaps into the title.
        const bit = q('.op-bit')[0];
        const proxy = { t: 1 };
        const L = path.getTotalLength();
        tl.set(bit, { opacity: 1 }, 2.2).to(
          proxy,
          {
            t: 0.38,
            duration: 1.1,
            ease: 'power1.in',
            onUpdate: () => {
              const pt = path.getPointAtLength(L * proxy.t);
              const k = 0.25 + (1 - proxy.t) * 1.2;
              gsap.set(bit, { x: pt.x, y: pt.y - 24 * k, scale: k, rotation: (1 - proxy.t) * 540 });
            },
          },
          2.2,
        );
        const slot = q('.bit-slot')[0];
        const target = () => rectInStage(slot);
        tl.call(() => pluck(note(5, 220), { vol: 0.2 }), null, 3.3)
          .to(bit, { x: () => target().cx, duration: 0.75, ease: 'power1.inOut' }, 3.3)
          .to(bit, { y: () => target().cy - 240, duration: 0.38, ease: 'power2.out' }, 3.3)
          .to(bit, { y: () => target().cy, duration: 0.37, ease: 'power2.in' }, 3.68)
          .to(bit, { scale: 1, rotation: 720, duration: 0.75, ease: 'none' }, 3.3)
          .call(() => thump({ freq: 140, vol: 0.4 }), null, 4.05)
          .to(bit, { scaleX: 1.5, scaleY: 0.55, duration: 0.07, ease: 'power2.out', transformOrigin: '50% 100%' }, 4.05)
          .to(bit, { scaleX: 1, scaleY: 1, duration: 0.9, ease: 'elastic.out(1.1, 0.32)' }, 4.12)
          .to(q('.op-title .t-word-last'), { y: 10, duration: 0.07, ease: 'power2.out' }, 4.05)
          .to(q('.op-title .t-word-last'), { y: 0, duration: 0.8, ease: 'elastic.out(1, 0.35)' }, 4.12)
          .to(q('.op-enter'), { opacity: 1, duration: 1 }, 4.6);
      },
    ],
  });

  return (
    <div ref={scope} className="scene op">
      <div className="op-sky layer" />
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="op" />
        <defs>
          <radialGradient id="op-moon-g" cx="0.45" cy="0.4">
            <stop offset="0" stopColor="#fff2c4" />
            <stop offset="0.7" stopColor="#ffcf6a" />
            <stop offset="1" stopColor="#f2a33a" />
          </radialGradient>
          <radialGradient id="op-halo-g">
            <stop offset="0" stopColor="#ffd98a" stopOpacity="0.55" />
            <stop offset="0.35" stopColor="#3fe0c5" stopOpacity="0.18" />
            <stop offset="1" stopColor="#3fe0c5" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="op-ground-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d3f46" />
            <stop offset="0.25" stopColor="#072a2c" />
            <stop offset="1" stopColor="#020f12" />
          </linearGradient>
          <linearGradient id="op-path-g" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#0f4c4c" />
            <stop offset="1" stopColor="#2a8f86" />
          </linearGradient>
          <linearGradient id="op-hazeband" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d7983" stopOpacity="0" />
            <stop offset="0.6" stopColor="#1f8a8a" stopOpacity="0.45" />
            <stop offset="1" stopColor="#0d3f46" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g data-depth="0.15">
          <g className="op-moon">
            <circle className="op-halo" cx="960" cy="690" r="440" fill="url(#op-halo-g)" />
            <circle cx="960" cy="696" r="112" fill="url(#op-moon-g)" />
          </g>
        </g>
        <g className="far" data-depth="0.3">
          <Plants list={FAR} p="op" />
        </g>
        <rect x="0" y="600" width="1920" height="200" fill="url(#op-hazeband)" />
        <g className="op-ground">
          <path d="M-20,740 Q480,700 960,712 T1940,736 V1100 H-20Z" fill="url(#op-ground-g)" />
          <path d={limb(PATH.p0, PATH.p1, PATH.p2, 420, 10, 30)} fill="url(#op-path-g)" opacity="0.6" />
        </g>
        <g className="mid" data-depth="0.6">
          <Plants list={MID} p="op" />
        </g>
        <g className="toys" data-depth="0.5">
          {TOYS.map((t, i) => (
            <g key={i} transform={`translate(${t.x} ${t.y})`}>
              <ellipse cx="0" cy="22" rx="26" ry="5" fill="#000" opacity="0.3" />
              <g className="op-toy">
                <g className="op-toy-inner">{t.el}</g>
              </g>
            </g>
          ))}
        </g>
        <path d={PATH_D} className="op-path-glow" fill="none" stroke="#8ff7dc" strokeWidth="18" strokeOpacity="0.12" strokeLinecap="round" />
        <path d={PATH_D} className="op-path-line" fill="none" stroke="#8ff7dc" strokeWidth="3.5" strokeLinecap="round" />
        <path d={PATH_D} className="op-flow" fill="none" stroke="#fff6d6" strokeWidth="3.5" strokeDasharray="4 236" strokeLinecap="round" />
      </svg>

      <Motes lite={lite} count={120} colors={['#8ff7dc', '#ffd98a', '#a77cf2']} size={30} speed={0.8} />

      <svg className="fill near" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="opn" />
        <g data-depth="1.3">
          <Plants list={NEAR} p="opn" />
        </g>
      </svg>

      <div className="op-type">
        <div className="op-presents">
          <img src="./assets/brand/plethora-wordmark.png" alt="Plethora" />
          <span className="t-mono">{C.presents}</span>
        </div>
        <h1 className="t-display caps op-title">
          <span className="mask-line">
            <span className="split-line">{C.title[0]}</span>
          </span>
          <span className="mask-line">
            <span className="split-line">
              <span className="split-unit t-word-last">
                {C.title[1]}
                <span className="bit-slot" />
              </span>
            </span>
          </span>
        </h1>
        <p className="op-sub">{C.subtitle}</p>
      </div>

      <div className="op-bit" />
      <div className="op-enter t-mono">{C.enter}</div>
      <Vignette strength={0.6} />
    </div>
  );
}
