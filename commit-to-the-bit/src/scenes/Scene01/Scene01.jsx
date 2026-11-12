import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { scene01 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { FoliageDefs, Plants } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax, Vignette } from '../../systems/environment/atmosphere.jsx';
import { Split } from '../../systems/typography/Split.jsx';
import { Bit } from '../../components/Bit.jsx';
import { pluck, note, thump, chord } from '../../systems/audio/sound.js';
import './scene01.css';

/* A meadow at first light: open, abundant, unconstrained. The Bit wanders
   wherever it likes. Then a goal appears — and a wall it could simply walk
   around. It jumps it anyway. That is the paradox, made physical. */

const GY = 880; // ground line of the course
const R = 28; // bit radius
const X0 = 520;
const WX = 1120; // wall centre
const BW = 92; // block width
const BH = 62; // block height
const HOLE = 1640;
const TAKEOFF = WX - 250;
const LAND = WX + 250;
const EASY_D = `M${TAKEOFF - 40},${GY + 6} C${WX - 160},${GY + 140} ${WX + 160},${GY + 140} ${LAND + 40},${GY + 6}`;

const EDGE = [
  { kind: 'blade', x: 30, y: 1100, r: 14, h: 520, w: 90, bend: 0.35, fill: 'meadow' },
  { kind: 'blade', x: 110, y: 1110, r: 4, h: 380, w: 70, bend: 0.2, fill: 'jade' },
  { kind: 'lantern', x: 200, y: 1090, s: 1.1, h: 300, bend: 0.6, fill: 'coral', stem: '#1f5e52' },
  { kind: 'discs', x: 300, y: 1100, s: 0.8, h: 280, size: 90, n: 2, fill: 'sea', stem: '#1b6a66' },
  { kind: 'tuft', x: 380, y: 1080, s: 1.3, fill: 'meadow', seed: 3 },
  { kind: 'frond', x: 1960, y: 1000, s: 1, r: -24, h: 420, n: 12, leaf: 48, bend: -0.4, fill: 'jade', stem: '#1f5e52' },
  { kind: 'blade', x: 1880, y: 1110, r: -18, h: 520, w: 84, bend: -0.35, fill: 'meadow' },
  { kind: 'capsule', x: 1480, y: 1120, s: 1, h: 200, w: 50, fill: 'dusk' },
  { kind: 'tuft', x: 1540, y: 1090, s: 1.2, fill: 'meadow', seed: 6 },
];

const FAR = [
  { kind: 'canopy', x: 240, y: 690, s: 0.5, fill: 'pale', trunk: '#8cc8ba', seed: 2 },
  { kind: 'canopy', x: 330, y: 700, s: 0.36, fill: 'pale', trunk: '#8cc8ba', seed: 5 },
  { kind: 'cone', x: 420, y: 702, s: 0.6, h: 200, w: 70, fill: 'pale' },
  { kind: 'canopy', x: 1500, y: 690, s: 0.44, fill: 'pale', trunk: '#8cc8ba', seed: 7 },
  { kind: 'cone', x: 1590, y: 694, s: 0.7, h: 210, w: 76, fill: 'pale' },
  { kind: 'canopy', x: 1700, y: 700, s: 0.6, fill: 'pale', trunk: '#8cc8ba', seed: 8 },
  { kind: 'canopy', x: 1820, y: 690, s: 0.4, fill: 'pale', trunk: '#8cc8ba', seed: 9 },
];

export default function Scene01({ beat, replayKey, lite }) {
  const scope = useRef(null);
  const bit = useRef(null);
  const trail = useRef(null);
  const [blocks, setBlocks] = useState(3);
  const beatRef = useRef(beat);
  beatRef.current = beat;
  useParallax(scope, { enabled: !lite, strength: 20 });

  const wallTop = GY - blocks * BH;
  const apex = wallTop - 130;
  const arcD = `M${TAKEOFF},${GY - R} Q${WX},${2 * apex - GY + R - 20} ${LAND},${GY - R}`;

  /* ---------- the Bit: free wandering (beat 0) ---------- */
  useEffect(() => {
    if (beat !== 0) return;
    const pts = [];
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      const t = (now - t0) / 1000 + 2;
      const x = 1080 + 520 * Math.sin(t * 0.38) + 90 * Math.sin(t * 1.1);
      const depth = 0.5 + 0.5 * Math.sin(t * 0.73 + 1.2);
      const hop = Math.abs(Math.sin(t * 2.4)) * 46 * (0.6 + 0.4 * Math.sin(t * 0.5));
      const y = 830 + depth * 120 - R - hop;
      const k = 0.82 + depth * 0.3;
      gsap.set(bit.current, { x, y, scale: k, rotation: x * 1.6 });
      pts.push([x, 830 + depth * 120 - 4]);
      if (pts.length > 150) pts.shift();
      if (trail.current) trail.current.setAttribute('d', 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L'));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [beat, replayKey]);

  /* ---------- the Bit: the course (beats 1–2) ---------- */
  useEffect(() => {
    if (beat < 1) return;
    const b = bit.current;
    const roll = (d) => (d / (2 * Math.PI * R)) * 360;
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9, delay: beat === 1 ? 2.1 : 0.4 });
    tl.set(b, { x: X0, y: GY - R, scale: 0, rotation: 0, opacity: 1 })
      .to(b, { scale: 1, duration: 0.45, ease: 'back.out(3)' })
      .to(b, { x: TAKEOFF, rotation: roll(TAKEOFF - X0), duration: 0.9, ease: 'power1.in' })
      .to(b, { scaleX: 1.25, scaleY: 0.75, duration: 0.08, transformOrigin: '50% 100%' })
      .call(() => pluck(note(4 + Math.min(blocks, 5), 220), { vol: 0.16 }))
      .to(b, { scaleX: 0.85, scaleY: 1.18, duration: 0.12 })
      .addLabel('air')
      .to(b, { x: LAND, rotation: `+=${roll(LAND - TAKEOFF)}`, duration: 0.9, ease: 'none' }, 'air')
      .to(b, { y: apex, duration: 0.45, ease: 'power2.out' }, 'air')
      .to(b, { y: GY - R, duration: 0.45, ease: 'power2.in' }, 'air+=0.45')
      .to(b, { scaleX: 1, scaleY: 1, duration: 0.3 }, 'air+=0.1')
      .call(() => thump({ freq: 150, vol: 0.3 }))
      .to(b, { scaleX: 1.35, scaleY: 0.66, duration: 0.07 })
      .to(b, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1, 0.35)' })
      .to(b, { x: HOLE, rotation: `+=${roll(HOLE - LAND)}`, duration: 0.8, ease: 'power2.out' }, '<')
      .to(b, { y: GY + 4, scale: 0.4, opacity: 0, duration: 0.3, ease: 'power2.in' })
      .call(() => chord([5, 7, 9], 220, { vol: 0.14, spread: 0.07 }))
      .fromTo(
        scope.current.querySelector('.s1-pennant'),
        { scaleX: 0.4 },
        { scaleX: 1, duration: 0.9, ease: 'elastic.out(1.2, 0.3)', transformOrigin: '0% 50%' },
        '<',
      )
      .fromTo(scope.current.querySelector('.s1-burst'), { scale: 0.2, opacity: 1 }, { scale: 1.6, opacity: 0, duration: 0.8, ease: 'power2.out', transformOrigin: '50% 50%' }, '<');
    return () => tl.kill();
  }, [beat, replayKey, blocks, apex]);

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 1 : 2 });
      q('.s1-seed').forEach((s, i) => {
        gsap.fromTo(s, { x: -200 - i * 140, y: 0 }, { x: 2200, duration: 26 + (i % 5) * 4, repeat: -1, ease: 'none', delay: -i * 3.1 });
        gsap.to(s, { y: -30 - (i % 4) * 12, duration: 3 + (i % 3), yoyo: true, repeat: -1, ease: 'sine.inOut' });
      });
      gsap.to(q('.s1-sunhalo'), { scale: 1.08, duration: 4, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 50%' });
    },
    init: (q) => {
      gsap.set(q('.s1-hill'), { y: 120, opacity: 0 });
      gsap.set(q('.s1-sun'), { y: 80, opacity: 0 });
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s1-kicker, .s1-body'), { opacity: 0, y: 24 });
      gsap.set(q('.s1-d .split-unit .split-unit'), { yPercent: 110, opacity: 0 });
      gsap.set(q('.s1-wall .blk'), { scaleY: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s1-goal'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s1-easy, .s1-chosen'), { strokeDashoffset: 1400 });
      gsap.set(q('.s1-lbl'), { opacity: 0, y: 10 });
      gsap.set(q('.s1-trail'), { opacity: 1 });
      gsap.set(q('.s1-quote, .s1-attr, .s1-hint'), { opacity: 0, y: 24 });
    },
    beats: [
      (tl, q) => {
        tl.to(q('.s1-sun'), { y: 0, opacity: 1, duration: 1.6, ease: 'power3.out' }, 0)
          .to(q('.s1-hill'), { y: 0, opacity: 1, duration: 1.4, ease: 'expo.out', stagger: 0.12 }, 0.05)
          .to(q('.plant'), { scale: 1, duration: 1, ease: 'back.out(1.6)', stagger: { each: 0.04, from: 'random' } }, 0.4)
          .to(q('.s1-kicker'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 0.5)
          .to(q('.s1-d0 .split-unit .split-unit'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.035 }, 0.6)
          .to(q('.s1-body0'), { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 1.1)
          .call(() => chord([0, 4, 7], 293, { vol: 0.1, decay: 1.6 }), null, 0.6);
      },
      (tl, q, { instant }) => {
        // the open meadow gets a goal — and a rule
        tl.to(q('.s1-d0 .split-unit .split-unit'), { yPercent: -110, opacity: 0, duration: 0.5, ease: 'power3.in', stagger: 0.02 }, 0)
          .to(q('.s1-body0'), { opacity: 0, y: -16, duration: 0.4 }, 0)
          .to(q('.s1-trail'), { opacity: 0, duration: 0.6 }, 0)
          .to(q('.s1-goal'), { scale: 1, duration: 0.8, ease: 'back.out(2.2)' }, 0.3)
          .to(q('.s1-easy'), { strokeDashoffset: 0, duration: 1, ease: 'power2.inOut' }, 0.5)
          .to(q('.s1-lbl-easy'), { opacity: 1, y: 0, duration: 0.6 }, 0.9)
          .to(q('.s1-wall .blk'), { scaleY: 1, duration: 0.55, ease: 'back.out(2.4)', stagger: 0.14 }, 1.0)
          .to(q('.s1-d1 .split-unit .split-unit'), { yPercent: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.025 }, 0.45)
          .to(q('.s1-body1'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 1.0)
          .to(q('.s1-chosen'), { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, 2.0)
          .to(q('.s1-lbl-chosen'), { opacity: 1, y: 0, duration: 0.6 }, 2.4);
        if (!instant) [0, 1, 2].forEach((i) => tl.call(() => thump({ freq: 90 + i * 30, vol: 0.2 }), null, 1.05 + i * 0.14));
      },
      (tl, q) => {
        tl.to(q('.s1-d1 .split-unit .split-unit'), { yPercent: -110, opacity: 0, duration: 0.5, ease: 'power3.in', stagger: 0.015 }, 0)
          .to(q('.s1-body1'), { opacity: 0, duration: 0.4 }, 0)
          .to(q('.s1-d2 .split-unit .split-unit'), { yPercent: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.025 }, 0.35)
          .to(q('.s1-quote'), { opacity: 1, y: 0, duration: 1, ease: 'power3.out' }, 0.7)
          .to(q('.s1-attr'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 1.0)
          .to(q('.s1-hint'), { opacity: 1, y: 0, duration: 0.8 }, 1.6);
      },
    ],
  });

  const raise = (e) => {
    e.stopPropagation();
    if (beatRef.current < 1) return;
    const n = blocks >= 5 ? 2 : blocks + 1;
    setBlocks(n);
    thump({ freq: 80 + n * 20, vol: 0.25 });
    requestAnimationFrame(() => {
      const top = scope.current.querySelector(`.s1-wall .blk[data-i="${n - 1}"]`);
      if (top && n > blocks) gsap.fromTo(top, { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: 'back.out(2.6)', transformOrigin: '50% 100%' });
    });
  };

  return (
    <div ref={scope} className="scene s1">
      <div className="layer s1-sky" />
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s1" />
        <defs>
          <radialGradient id="s1-sun-g" cx="0.45" cy="0.42">
            <stop offset="0" stopColor="#fffaf0" />
            <stop offset="0.6" stopColor="#ffeab0" />
            <stop offset="1" stopColor="#ffd77a" />
          </radialGradient>
          <radialGradient id="s1-halo-g">
            <stop offset="0" stopColor="#fff1c4" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff1c4" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="s1-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#74c4a6" />
            <stop offset="0.5" stopColor="#4ea68a" />
            <stop offset="1" stopColor="#2a7d69" />
          </linearGradient>
          <linearGradient id="s1-blk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#3c3cb0" />
            <stop offset="1" stopColor="#26217a" />
          </linearGradient>
        </defs>

        <g data-depth="0.12" className="s1-sun">
          <circle className="s1-sunhalo" cx="1560" cy="330" r="360" fill="url(#s1-halo-g)" />
          <circle cx="1560" cy="330" r="132" fill="url(#s1-sun-g)" />
        </g>

        <g className="s1-seeds">
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i} className="s1-seed" transform={`translate(0 ${170 + ((i * 97) % 420)})`}>
              <circle r={2 + (i % 3)} fill="#fffaf0" opacity="0.9" />
              <path d={`M0,0 l${-6 - (i % 3) * 2},${8 + (i % 2) * 3}`} stroke="#fffaf0" strokeOpacity="0.6" strokeWidth="1.2" />
            </g>
          ))}
        </g>

        <g data-depth="0.25">
          <path className="s1-hill" d="M0,690 C260,640 520,652 780,684 S1280,630 1520,656 S1820,640 1920,654 V800 H0Z" fill="#b8e4d6" />
          <g className="s1-hill">
            <Plants list={FAR} p="s1" />
          </g>
        </g>
        <g data-depth="0.4">
          <path className="s1-hill" d="M0,740 C320,700 700,728 1000,734 S1580,700 1920,722 V820 H0Z" fill="#94d0bf" />
        </g>
        <g data-depth="0.55">
          <path className="s1-hill" d="M0,790 C400,758 1200,770 1920,780 V1080 H0Z" fill="url(#s1-ground)" />
        </g>

        {/* free wandering trail */}
        <path ref={trail} className="s1-trail" fill="none" stroke="#c8341f" strokeOpacity="0.4" strokeWidth="4" strokeDasharray="1 14" strokeLinecap="round" />

        {/* the course */}
        <mask id="s1-m-easy" maskUnits="userSpaceOnUse">
          <path className="s1-easy" d={EASY_D} fill="none" stroke="#fff" strokeWidth="14" pathLength="1400" strokeDasharray="1400" />
        </mask>
        <mask id="s1-m-chosen" maskUnits="userSpaceOnUse">
          <path className="s1-chosen" d={arcD} fill="none" stroke="#fff" strokeWidth="14" pathLength="1400" strokeDasharray="1400" />
        </mask>
        <path mask="url(#s1-m-easy)" d={EASY_D} fill="none" stroke="#0b3a3f" strokeOpacity="0.55" strokeWidth="4" strokeDasharray="2 16" strokeLinecap="round" />
        <path mask="url(#s1-m-chosen)" d={arcD} fill="none" stroke="#e2442f" strokeOpacity="0.8" strokeWidth="4" strokeDasharray="2 16" strokeLinecap="round" />

        <g className="s1-wall interactive" onPointerDown={raise} style={{ cursor: beat >= 1 ? 'pointer' : 'default', pointerEvents: 'auto' }}>
          <ellipse cx={WX} cy={GY + 6} rx={BW * 0.8} ry="12" fill="#0b3a3f" opacity="0.25" />
          {Array.from({ length: blocks }, (_, i) => (
            <g key={i} className="blk" data-i={i}>
              <rect x={WX - BW / 2} y={GY - (i + 1) * BH} width={BW} height={BH - 3} rx="4" fill="url(#s1-blk)" />
              <rect x={WX - BW / 2} y={GY - (i + 1) * BH} width={BW} height="8" rx="4" fill="#7a7cf0" opacity="0.8" />
            </g>
          ))}
        </g>

        <g className="s1-goal" transform={`translate(${HOLE} ${GY})`}>
          <ellipse cx="0" cy="4" rx="42" ry="10" fill="#0b2a2e" opacity="0.75" />
          <circle className="s1-burst" cx="0" cy="-30" r="70" fill="none" stroke="#ffc94a" strokeWidth="5" opacity="0" />
          <rect x="34" y="-230" width="5" height="232" rx="2.5" fill="#f5ead3" />
          <path className="s1-pennant" d="M39,-228 L120,-204 L39,-178Z" fill="#26217a" />
        </g>
      </svg>

      <div className="s1-lbl s1-lbl-easy t-mono" style={{ left: WX - 200, top: GY + 120, width: 400 }}>
        {C.easyWay}
      </div>
      <div className="s1-lbl s1-lbl-chosen t-mono" style={{ left: WX + 150, top: apex + 10, width: 300, textAlign: 'left' }}>
        {C.chosenWay}
      </div>

      <Bit ref={bit} size={R * 2} className="on-light" />

      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s1n" />
        <g data-depth="1.1">
          <Plants list={EDGE} p="s1n" />
        </g>
      </svg>

      <div className="s1-type">
        <div className="s1-kicker t-mono">
          <span className="idx">{C.index}</span> {C.kicker}
        </div>
        <div className="s1-dwrap">
          <h2 className="t-display s1-d s1-d0">
            <Split text={C.headline} wordClass="mask-word" />
          </h2>
          <h2 className="t-display s1-d s1-d1">
            <Split text={C.beats[0]} wordClass="mask-word" />
          </h2>
          <h2 className="t-display s1-d s1-d2">
            <Split text={C.beats[1]} wordClass="mask-word" />
          </h2>
        </div>
        <p className="t-body s1-body s1-body0">{C.setup}</p>
        <p className="t-quote s1-body s1-body1">{C.answer}</p>
      </div>

      <figure className="s1-q">
        <blockquote className="t-quote s1-quote">
          <span className="lead">{C.quoteLead}</span> “{C.quote}”
        </blockquote>
        <figcaption className="s1-attr">
          <span className="t-mono name">{C.attribution}</span>
          <span className="src">{C.source}</span>
        </figcaption>
        <div className="s1-hint t-mono">{C.hint}</div>
      </figure>

      <Vignette strength={0.18} />
    </div>
  );
}
