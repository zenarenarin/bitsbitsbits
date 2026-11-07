import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { scene03 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { FoliageDefs, Plants, limb } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax, Vignette } from '../../systems/environment/atmosphere.jsx';
import { Motes } from '../../systems/environment/Motes.jsx';
import { Split } from '../../systems/typography/Split.jsx';
import { toStage } from '../../systems/stage/Stage.jsx';
import { pluck, note, chord, thump, miss, whoosh } from '../../systems/audio/sound.js';
import { W, simulate, idealSpeed } from './physics.js';
import './scene03.css';

/* Night in a mushroom forest under an orange moon. A springy stalk holds a
   seed; across a ravine, a flower is waiting to catch it. The first throw
   falls short. The second sails past. Each one leaves its trace, so the
   third knows where to aim. Then it's the audience's turn. */

const K = 10; // pull distance → launch speed
const MAX_PULL = 260;
const BASE = { x: 330, y: 794 };
const L = W.launch;

const FAR = [
  { kind: 'discs', x: 980, y: 830, s: 1.2, h: 360, size: 120, n: 3, fill: 'mist', stem: '#0b3e40' },
  { kind: 'cone', x: 1120, y: 840, s: 1, h: 300, w: 110, fill: 'mist' },
  { kind: 'discs', x: 1780, y: 840, s: 1.3, h: 420, size: 120, n: 3, fill: 'mist', stem: '#0b3e40' },
  { kind: 'canopy', x: 1320, y: 840, s: 0.8, fill: 'mist', trunk: '#0b3e40', seed: 3 },
  { kind: 'cone', x: 640, y: 800, s: 0.9, h: 280, w: 100, fill: 'mist' },
  { kind: 'canopy', x: 120, y: 800, s: 0.9, fill: 'mist', trunk: '#0b3e40', seed: 7 },
];

const NEAR = [
  { kind: 'paddle', x: -110, y: 1150, s: 1, r: 48, h: 460, w: 190, stripes: 6, fill: 'forest', stripe: '#03201a' },
  { kind: 'tuft', x: 190, y: 800, s: 1.4, fill: 'jade', seed: 2 },
  { kind: 'tuft', x: 560, y: 800, s: 1.1, fill: 'jade', seed: 4 },
  { kind: 'lantern', x: 640, y: 800, s: 0.9, h: 220, bend: 0.5, fill: 'sun', stem: '#0b3a35' },
  { kind: 'tuft', x: 1330, y: 840, s: 1.2, fill: 'jade', seed: 6 },
  { kind: 'frond', x: 1700, y: 850, s: 0.9, r: 10, h: 300, n: 10, leaf: 40, bend: 0.3, fill: 'jade', stem: '#0b3a35' },
  { kind: 'blade', x: 1890, y: 1110, r: -20, h: 560, w: 100, bend: -0.3, fill: 'forest' },
  { kind: 'paddle', x: 1960, y: 1140, s: 1, r: -42, h: 460, w: 190, stripes: 6, fill: 'deep', stripe: '#0b3a35', flip: true },
  { kind: 'twig', x: 1240, y: -20, s: 0.9, r: 186, h: 300, bend: 0.4, buds: 6, fill: 'ember', stem: '#06201c', seed: 3 },
  { kind: 'frond', x: 1880, y: -30, s: 1, r: 200, h: 380, n: 12, leaf: 44, bend: 0.4, fill: 'night' },
];

const stalkPath = (bx, by) => limb([BASE.x, BASE.y], [BASE.x + 14, (BASE.y + by) / 2 + 26], [bx, by + W.r * 0.8], 18, 7, 16);
const holderPath = (bx, by) => `M${bx - 30},${by + 10} Q${bx},${by + 46} ${bx + 30},${by + 10} Q${bx},${by + 30} ${bx - 30},${by + 10}Z`;

export default function Scene03({ beat, replayKey, lite }) {
  const scope = useRef(null);
  const bitEl = useRef(null);
  const stalkEl = useRef(null);
  const holderEl = useRef(null);
  const liveEl = useRef(null);
  const previewEl = useRef(null);
  const [ghosts, setGhosts] = useState([]);
  const [count, setCount] = useState(0);
  const st = useRef({ ready: false, busy: false, drag: false });
  useParallax(scope, { enabled: !lite, strength: 16 });

  const vStar = useMemo(() => idealSpeed(), []);
  const demo = useMemo(
    () =>
      [0.72, 1.13, 1].map((k) => {
        const v = vStar * k;
        return { vx: v * Math.cos(W.angle), vy: v * Math.sin(W.angle) };
      }),
    [vStar],
  );

  const anims = useRef(new Set()); // every throw-related tween, so nothing outlives the scene
  const track = (a) => (anims.current.add(a), a);
  const killAll = () => {
    anims.current.forEach((a) => a.kill());
    anims.current.clear();
  };
  useEffect(() => killAll, []);

  const setBit = (x, y, extra = {}) => {
    if (bitEl.current) gsap.set(bitEl.current, { x, y, ...extra });
  };
  const setStalk = (x, y) => {
    if (!stalkEl.current) return;
    stalkEl.current.setAttribute('d', stalkPath(x, y));
    holderEl.current.setAttribute('d', holderPath(x, y));
  };
  const setLive = (d) => liveEl.current && liveEl.current.setAttribute('d', d);

  const bloom = () => {
    const q = (s) => scope.current.querySelectorAll(s);
    gsap.to(q('.s3-petal-l'), { rotation: -48, duration: 0.9, ease: 'elastic.out(1.1, 0.4)', transformOrigin: '50% 100%', stagger: 0.04 });
    gsap.to(q('.s3-petal-r'), { rotation: 48, duration: 0.9, ease: 'elastic.out(1.1, 0.4)', transformOrigin: '50% 100%', stagger: 0.04 });
    gsap.fromTo(q('.s3-cupglow'), { opacity: 0.9, scale: 0.4 }, { opacity: 0, scale: 2.4, duration: 1.4, ease: 'power2.out', transformOrigin: '50% 50%' });
    q('.s3-pollen').forEach((p, i) => {
      const a = (i / 14) * Math.PI - Math.PI;
      gsap.fromTo(p, { x: 0, y: 0, opacity: 1, scale: 1 }, { x: Math.cos(a) * (90 + (i % 3) * 50), y: Math.sin(a) * (120 + (i % 4) * 30), opacity: 0, scale: 0.4, duration: 1.4 + (i % 3) * 0.3, ease: 'power3.out' });
    });
  };
  const closeCup = () => {
    const q = (s) => scope.current.querySelectorAll(s);
    gsap.to(q('.s3-petal-l, .s3-petal-r'), { rotation: 0, duration: 0.6, ease: 'power2.inOut' });
  };

  const respawn = (delay = 0.9) => {
    track(gsap.delayedCall(delay, () => {
      if (!bitEl.current) return;
      closeCup();
      setStalk(L.x, L.y);
      setBit(L.x, L.y, { scale: 0, opacity: 1, rotation: 0 });
      gsap.to(bitEl.current, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
      st.current.busy = false;
      st.current.ready = true;
    }));
  };

  // Fly a precomputed throw. Returns the timeline.
  const fly = (vx, vy, { pulled = false, auto = false } = {}) => {
    const S = st.current;
    S.busy = true;
    S.ready = false;
    const sim = simulate(vx, vy);
    const n = sim.pts.length;
    const tl = track(gsap.timeline());
    const dir = Math.atan2(vy, vx);
    const pull = Math.hypot(vx, vy) / K;
    if (!pulled) {
      const p = { k: 0 };
      tl.to(p, {
        k: 1,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => {
          const x = L.x - Math.cos(dir) * pull * p.k;
          const y = L.y - Math.sin(dir) * pull * p.k;
          setBit(x, y);
          setStalk(x, y);
        },
      }).to({}, { duration: 0.25 });
    }
    const spring = { x: 0, y: 0 };
    tl.call(() => {
      whoosh({ dur: 0.5, from: 500, to: 2000, vol: 0.1 });
      pluck(note(2, 220), { vol: 0.15, decay: 0.3 });
      // the stalk snaps back with real spring
      const sx = L.x - Math.cos(dir) * pull;
      const sy = L.y - Math.sin(dir) * pull;
      spring.x = sx;
      spring.y = sy;
      track(gsap.to(spring, { x: L.x, y: L.y, duration: 1.1, ease: 'elastic.out(1.2, 0.25)', onUpdate: () => setStalk(spring.x, spring.y) }));
    });
    const prog = { i: 0 };
    tl.to(prog, {
      i: n - 1,
      duration: n / 60,
      ease: 'none',
      onUpdate: () => {
        const i = Math.floor(prog.i);
        const [x, y] = sim.pts[i];
        setBit(x, y, { rotation: x * 1.2 });
        setLive('M' + sim.pts.slice(0, i + 1).map((p) => p[0].toFixed(0) + ',' + p[1].toFixed(0)).join('L'));
      },
    });
    tl.call(() => {
      setLive('');
      setCount((c) => c + 1);
      setGhosts((g) => [...g.slice(-5), { pts: sim.pts, outcome: sim.outcome, landed: sim.landed, id: Math.random() }]);
      if (sim.outcome === 'hit') {
        thump({ freq: 110, vol: 0.35 });
        chord([0, 4, 7, 9, 12], 262, { vol: 0.16, spread: 0.07, decay: 1.8 });
        bloom();
        gsap.to(bitEl.current, { scale: 0.75, duration: 0.4, ease: 'back.out(3)' });
        respawn(auto ? 2.6 : 2.2);
      } else {
        miss();
        gsap.to(bitEl.current, { opacity: 0, scale: 0.4, duration: 0.4, delay: 0.2 });
        respawn(1);
      }
    });
    return tl;
  };

  /* ---------- per-beat demo throws ---------- */
  useEffect(() => {
    killAll();
    gsap.killTweensOf(bitEl.current);
    // replay earlier attempts instantly as feedback ghosts
    const prior = demo.slice(0, beat).map((d) => {
      const s = simulate(d.vx, d.vy);
      return { pts: s.pts, outcome: s.outcome, landed: s.landed, id: Math.random() };
    });
    setGhosts(prior);
    setCount(prior.length);
    closeCup();
    setLive('');
    setStalk(L.x, L.y);
    setBit(L.x, L.y, { scale: 1, opacity: 1, rotation: 0 });
    st.current.ready = false;
    track(
      gsap.delayedCall(beat === 0 ? 2.2 : 1.1, () => {
        const d = demo[beat];
        fly(d.vx, d.vy, { auto: true });
      }),
    );
    return killAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, replayKey]);

  /* ---------- the audience's turn: drag the seed back, let go ---------- */
  useEffect(() => {
    const S = st.current;
    const dirOf = (e) => {
      const p = toStage(e);
      let dx = L.x - p.x;
      let dy = L.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > MAX_PULL) {
        dx *= MAX_PULL / d;
        dy *= MAX_PULL / d;
      }
      return { dx, dy };
    };
    const move = (e) => {
      if (!S.drag) return;
      const { dx, dy } = dirOf(e);
      setBit(L.x - dx, L.y - dy);
      setStalk(L.x - dx, L.y - dy);
      // a short preview only — enough to aim, not enough to solve it
      const vx = dx * K;
      const vy = dy * K;
      let d = '';
      for (let i = 1; i <= 7; i++) {
        const t = i * 0.045;
        d += `M${(L.x + vx * t).toFixed(0)},${(L.y + vy * t + 0.5 * W.g * t * t).toFixed(0)}h0.1`;
      }
      previewEl.current.setAttribute('d', d);
      S.last = { dx, dy };
    };
    const up = () => {
      if (!S.drag) return;
      S.drag = false;
      previewEl.current.setAttribute('d', '');
      const { dx, dy } = S.last || { dx: 0, dy: 0 };
      if (Math.hypot(dx, dy) < 24) {
        setBit(L.x, L.y);
        setStalk(L.x, L.y);
        S.ready = true;
        return;
      }
      fly(dx * K, dy * K, { pulled: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grab = (e) => {
    const S = st.current;
    if (!S.ready || S.busy) return;
    S.drag = true;
    S.last = null;
    pluck(note(0, 220), { vol: 0.1, decay: 0.3 });
  };

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 1 : 2 });
      gsap.to(q('.s3-moonhalo'), { scale: 1.07, duration: 3.6, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 50%' });
      gsap.to(q('.s3-fog'), { x: 60, duration: 7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    },
    init: (q) => {
      gsap.set(q('.s3-kicker'), { opacity: 0, y: 20 });
      gsap.set(q('.s3-h0 .split-unit .split-unit'), { yPercent: 110 });
      gsap.set(q('.s3-h1 .split-unit .split-unit'), { yPercent: -160, opacity: 0 });
      gsap.set(q('.s3-support, .s3-hint'), { opacity: 0, y: 24 });
      gsap.set(q('.s3-moon'), { y: 60, opacity: 0 });
      gsap.set(q('.s3-land'), { y: 80, opacity: 0 });
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s3-cup'), { scale: 0, transformOrigin: '50% 100%' });
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.s3-moon'), { y: 0, opacity: 1, duration: 1.6, ease: 'power3.out' }, 0)
          .to(q('.s3-land'), { y: 0, opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.1 }, 0.1)
          .to(q('.plant'), { scale: 1, duration: 1, ease: 'back.out(1.6)', stagger: { each: 0.04, from: 'random' } }, 0.4)
          .to(q('.s3-cup'), { scale: 1, duration: 0.9, ease: 'back.out(2.2)' }, 0.8)
          .to(q('.s3-kicker'), { opacity: 1, y: 0, duration: 0.7 }, 0.3)
          .to(q('.s3-h0 .split-unit .split-unit'), { yPercent: 0, duration: 1, ease: 'expo.out', stagger: 0.02 }, 0.5),
      (tl, q) => tl.to(q('.s3-support'), { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 0.2),
      (tl, q) => {
        // IT'S WANTING ANOTHER ATTEMPT. — drops in, compresses, rebounds
        tl.to(q('.s3-h0 .split-unit .split-unit'), { yPercent: 110, duration: 0.45, ease: 'power3.in', stagger: 0.012 }, 0)
          .to(q('.s3-h1 .split-unit .split-unit'), { yPercent: 0, opacity: 1, duration: 0.9, ease: 'bounce.out', stagger: 0.025 }, 0.35)
          .to(q('.s3-hint'), { opacity: 1, y: 0, duration: 0.8 }, 1.4);
      },
    ],
  });

  const label = (o) => (o === 'hit' ? C.feedback.hit : o === 'long' ? C.feedback.long : C.feedback.short);

  return (
    <div ref={scope} className="scene s3">
      <div className="layer s3-sky" />
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s3" />
        <defs>
          <radialGradient id="s3-moon-g" cx="0.42" cy="0.38">
            <stop offset="0" stopColor="#ffe2a8" />
            <stop offset="0.55" stopColor="#f6a24a" />
            <stop offset="1" stopColor="#d9692a" />
          </radialGradient>
          <radialGradient id="s3-halo">
            <stop offset="0" stopColor="#ffb766" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffb766" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="s3-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0f4a3e" />
            <stop offset="0.2" stopColor="#0a3029" />
            <stop offset="1" stopColor="#031210" />
          </linearGradient>
          <linearGradient id="s3-fog-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#34d6c2" stopOpacity="0" />
            <stop offset="1" stopColor="#34d6c2" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="s3-mistband" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b3a33" stopOpacity="0" />
            <stop offset="1" stopColor="#0b3a33" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id="s3-abyss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#061f1c" stopOpacity="0" />
            <stop offset="0.3" stopColor="#041614" stopOpacity="0.95" />
            <stop offset="0.75" stopColor="#020a09" />
            <stop offset="1" stopColor="#0a3a36" />
          </linearGradient>
          <radialGradient id="s3-cupglow-g">
            <stop offset="0" stopColor="#ffe7a0" stopOpacity="1" />
            <stop offset="1" stopColor="#ffe7a0" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g data-depth="0.12" className="s3-moon">
          <circle className="s3-moonhalo" cx="1540" cy="300" r="420" fill="url(#s3-halo)" />
          <circle cx="1540" cy="300" r="170" fill="url(#s3-moon-g)" />
        </g>
        <g data-depth="0.3" className="s3-land" opacity="0.55">
          <Plants list={FAR} p="s3" />
        </g>
        <rect x="0" y="520" width="1920" height="340" fill="url(#s3-mistband)" />
        <rect x={W.gapL - 80} y={W.groundL - 10} width={W.gapR - W.gapL + 160} height="320" fill="url(#s3-abyss)" />

        {/* the ravine */}
        
        <rect className="s3-fog" x="700" y="940" width="620" height="160" fill="url(#s3-fog-g)" />
        <g className="s3-land">
          <path d={`M-20,${W.groundL} C200,${W.groundL - 6} 600,${W.groundL - 4} ${W.gapL - 30},${W.groundL} Q${W.gapL + 10},${W.groundL + 10} ${W.gapL - 6},${W.groundL + 120} L${W.gapL - 60},1100 H-20Z`} fill="url(#s3-ground)" />
          <path d={`M1940,${W.groundR} C1700,${W.groundR - 6} 1400,${W.groundR - 4} ${W.gapR + 30},${W.groundR} Q${W.gapR - 14},${W.groundR + 12} ${W.gapR + 6},${W.groundR + 120} L${W.gapR + 70},1100 H1940Z`} fill="url(#s3-ground)" />
        </g>

        {/* feedback: every attempt leaves its trace */}
        <g className="s3-ghosts">
          {ghosts.map((g, i) => (
            <path
              key={g.id}
              d={'M' + g.pts.map((p) => p[0].toFixed(0) + ',' + p[1].toFixed(0)).join('L')}
              fill="none"
              stroke={g.outcome === 'hit' ? '#ffc94a' : '#f5ead3'}
              strokeOpacity={g.outcome === 'hit' ? 0.9 : 0.2 + (i / ghosts.length) * 0.3}
              strokeWidth="3.5"
              strokeDasharray="1 13"
              strokeLinecap="round"
            />
          ))}
          {ghosts.map((g) => (
            <g key={'m' + g.id} transform={`translate(${g.landed.x} ${g.outcome === 'hit' ? W.cup.y - 90 : g.landed.y + 10})`}>
              {g.outcome !== 'hit' && <path d="M-9,-9 L9,9 M9,-9 L-9,9" stroke="#ff6a55" strokeWidth="3.5" strokeLinecap="round" />}
            </g>
          ))}
        </g>
        <path ref={liveEl} fill="none" stroke="#ff9a72" strokeOpacity="0.85" strokeWidth="3.5" strokeDasharray="1 13" strokeLinecap="round" />
        <path ref={previewEl} fill="none" stroke="#ffc94a" strokeWidth="9" strokeLinecap="round" opacity="0.8" />

        {/* the flower that catches */}
        <g className="s3-cup" transform={`translate(${W.cup.x} ${W.groundR})`}>
          <path d={limb([0, 0], [10, -40], [0, -(W.groundR - W.cup.y) + 12], 16, 10)} fill="#16614f" />
          <circle className="s3-cupglow" cx="0" cy={W.cup.y - W.groundR} r="120" fill="url(#s3-cupglow-g)" opacity="0" />
          <g transform={`translate(0 ${W.cup.y - W.groundR + 36})`}>
            <ellipse className="s3-petal-l" cx="-40" cy="-30" rx="26" ry="44" fill="#e4702a" transform="rotate(-14 -40 -30)" />
            <ellipse className="s3-petal-r" cx="40" cy="-30" rx="26" ry="44" fill="#e4702a" transform="rotate(14 40 -30)" />
            <path d="M-62,-36 Q-60,22 0,22 Q60,22 62,-36 Q0,-14 -62,-36Z" fill="#ff6a55" />
            <ellipse className="s3-petal-l" cx="-18" cy="-34" rx="22" ry="46" fill="#ff8a6a" />
            <ellipse className="s3-petal-r" cx="18" cy="-34" rx="22" ry="46" fill="#ff8a6a" />
            {Array.from({ length: 14 }, (_, i) => (
              <circle key={i} className="s3-pollen" cx="0" cy="-30" r={3 + (i % 3)} fill={i % 2 ? '#ffe7a0' : '#ffc94a'} opacity="0" />
            ))}
          </g>
        </g>

        {/* the launcher stalk */}
        <path ref={stalkEl} fill="#1d7a5e" />
        <path ref={holderEl} fill="#46b083" />
      </svg>

      <Motes lite={lite} count={70} colors={['#ffc94a', '#8ff7dc']} size={24} speed={0.5} />

      <div ref={bitEl} className="bit s3-bit" style={{ width: W.r * 2, height: W.r * 2, margin: `${-W.r}px 0 0 ${-W.r}px` }} onPointerDown={grab} />

      {ghosts.map((g) => (
        <div
          key={'l' + g.id}
          className={`s3-label t-mono ${g.outcome}`}
          style={{ left: Math.min(1790, Math.max(200, g.landed.x)), top: g.outcome === 'hit' ? W.cup.y - 150 : g.landed.y + 34 }}
        >
          {label(g.outcome)}
        </div>
      ))}

      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s3n" />
        <g data-depth="1.1">
          <Plants list={NEAR} p="s3n" />
        </g>
      </svg>

      <div className="s3-kicker t-mono">
        <span className="idx">{C.index}</span> {C.kicker}
      </div>
      <div className="s3-hwrap">
        <h2 className="t-display s3-h s3-h0">
          {C.headline.map((l, i) => (
            <span key={i} className="split-line">
              <Split text={l} wordClass="mask-word" />
            </span>
          ))}
        </h2>
        <h2 className="t-display s3-h s3-h1">
          {C.payoff.map((l, i) => (
            <span key={i} className="split-line">
              <Split text={l} />
            </span>
          ))}
        </h2>
      </div>
      <p className="t-quote s3-support">{C.support}</p>

      <div className="s3-attempt t-mono">
        {C.attempt} <span>{String(Math.max(1, count + (st.current.busy ? 1 : 0))).padStart(2, '0')}</span>
      </div>
      <div className="s3-hint t-mono">{C.yourTurn}</div>
      <Vignette strength={0.5} />
    </div>
  );
}
