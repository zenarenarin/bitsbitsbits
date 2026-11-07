import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { scene02 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { FoliageDefs, Plants, limb } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax, Vignette } from '../../systems/environment/atmosphere.jsx';
import { Motes } from '../../systems/environment/Motes.jsx';
import { Split } from '../../systems/typography/Split.jsx';
import { toStage } from '../../systems/stage/Stage.jsx';
import { pluck, note, chord } from '../../systems/audio/sound.js';
import './scene02.css';

/* Six things that have nothing to do with each other, each keeping its own
   time in a violet forest. A thread of light joins two of them — and the
   second one starts moving with the first. Thread by thread, the separate
   rhythms lock into one system nobody could have predicted from the parts. */

const TAU = Math.PI * 2;
const F0 = 0.34; // shared rhythm (Hz) once connected

const OBJ = [
  { id: 'pend', x: 560, y: 70, f: 0.47, ph: 0.3 },
  { id: 'orb', x: 1210, y: 250, f: 0.71, ph: 2.1 },
  { id: 'orbit', x: 1560, y: 470, f: 0.29, ph: 4.0 },
  { id: 'bulb', x: 1250, y: 640, f: 0.58, ph: 1.0 },
  { id: 'flower', x: 880, y: 560, f: 0.21, ph: 5.2 },
  { id: 'drift', x: 300, y: 470, f: 0.16, ph: 3.3 },
];
// the order threads appear in; the last one closes the loop
const LINKS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
];
const LINK_TIMES = [0.6, 1.9, 2.9, 3.7, 4.35, 4.9];

const TRUNKS = [
  { x: 90, w: 120, c: '#120b38', d: 0.9 },
  { x: 430, w: 46, c: '#3a1660', d: 0.3 },
  { x: 700, w: 70, c: '#2b1258', d: 0.45 },
  { x: 1050, w: 38, c: '#4a1a6c', d: 0.25 },
  { x: 1400, w: 64, c: '#2b1258', d: 0.45 },
  { x: 1720, w: 52, c: '#3a1660', d: 0.3 },
  { x: 1860, w: 150, c: '#120b38', d: 0.9 },
];

const FLOOR = [
  { kind: 'twig', x: 120, y: 1090, s: 1.1, h: 280, bend: 0.4, buds: 6, fill: 'coral', stem: '#2a0f45', seed: 3, bud: 13 },
  { kind: 'frond', x: 40, y: 1100, r: 14, h: 380, n: 11, leaf: 44, bend: 0.35, fill: 'indigo', stem: '#1a1048' },
  { kind: 'tuft', x: 230, y: 1080, s: 1.4, fill: 'plum', seed: 5 },
  { kind: 'lantern', x: 300, y: 1090, s: 0.9, h: 220, bend: 0.5, fill: 'sun', stem: '#2a0f45' },
  { kind: 'twig', x: 1800, y: 1090, s: 1.1, h: 300, bend: -0.4, buds: 7, fill: 'magenta', stem: '#2a0f45', seed: 8, bud: 12 },
  { kind: 'frond', x: 1900, y: 1100, r: -14, h: 400, n: 11, leaf: 46, bend: -0.35, fill: 'indigo', stem: '#1a1048' },
  { kind: 'tuft', x: 1680, y: 1080, s: 1.4, fill: 'plum', seed: 9 },
];

/* ---------- object drawings (centred on 0,0) ---------- */
function Draw({ id }) {
  if (id === 'pend')
    return (
      <>
        <circle r="90" fill="url(#s2-halo-sun)" />
        <path d="M0,-34 C22,-10 26,18 0,40 C-26,18 -22,-10 0,-34Z" fill="#ffc94a" />
        <path d="M0,-22 C10,-6 12,12 0,26" fill="none" stroke="#fff4c8" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
      </>
    );
  if (id === 'orb')
    return (
      <>
        <circle r="120" fill="url(#s2-halo-lumen)" />
        <circle r="38" fill="url(#s2-orb)" />
        <ellipse cx="-12" cy="-14" rx="11" ry="7" fill="#fff" opacity="0.7" transform="rotate(-30 -12 -14)" />
      </>
    );
  if (id === 'orbit')
    return (
      <>
        <circle r="80" fill="url(#s2-halo-cream)" />
        <circle r="74" fill="none" stroke="#f5ead3" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="3 9" />
        <circle r="12" fill="#f5ead3" />
        <g className="moons">
          <circle cx="74" r="15" fill="#f5ead3" />
          <circle cx="-74" r="9" fill="#ffc94a" />
        </g>
      </>
    );
  if (id === 'bulb')
    return (
      <>
        <circle r="110" fill="url(#s2-halo-violet)" />
        <path d="M0,-46 C40,-46 52,-6 46,18 C40,38 -40,38 -46,18 C-52,-6 -40,-46 0,-46Z" fill="#a77cf2" />
        <path d="M-30,30 Q-34,60 -24,86 M0,34 Q4,66 -4,96 M30,30 Q36,60 26,84" fill="none" stroke="#a77cf2" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
        <ellipse cx="-14" cy="-20" rx="14" ry="9" fill="#e6d8ff" opacity="0.6" />
      </>
    );
  if (id === 'flower')
    return (
      <>
        <circle r="110" fill="url(#s2-halo-coral)" />
        <g className="petals">
          {Array.from({ length: 7 }, (_, i) => (
            <ellipse key={i} cx="0" cy="-40" rx="17" ry="36" fill={i % 2 ? '#ff6a55' : '#ff8a6a'} transform={`rotate(${(i * 360) / 7})`} />
          ))}
        </g>
        <circle r="18" fill="#ffc94a" />
      </>
    );
  // drift — a winged seed
  return (
    <>
      <circle r="90" fill="url(#s2-halo-coral)" opacity="0.7" />
      <path d="M0,0 C30,-60 90,-70 110,-50 C80,-30 40,-10 0,0Z" fill="#ff9a72" opacity="0.9" />
      <path d="M0,0 C-30,-60 -90,-70 -110,-50 C-80,-30 -40,-10 0,0Z" fill="#ff9a72" opacity="0.75" />
      <ellipse cx="0" cy="8" rx="14" ry="18" fill="#e4702a" />
    </>
  );
}

export default function Scene02({ beat, replayKey, lite }) {
  const scope = useRef(null);
  const objEls = useRef([]);
  const linkEls = useRef([]);
  const pulseEls = useRef([]);
  const coreEls = useRef([]);
  const threadEl = useRef(null);
  const sim = useRef({ base: OBJ.map((o) => ({ x: o.x, y: o.y })), drag: -1 });
  useParallax(scope, { enabled: !lite, strength: 18 });

  /* ---------- simulation ---------- */
  useEffect(() => {
    const S = sim.current;
    const n = OBJ.length;
    const theta = OBJ.map((o) => o.ph);
    const lock = new Float32Array(n); // 0 = own rhythm, 1 = locked to the system
    const born = LINKS.map(() => (beat >= 2 ? -10 : Infinity));
    if (beat >= 2) lock.fill(1);
    let master = 0;
    const t0 = performance.now();
    const sounded = LINKS.map(() => beat !== 1);
    let finale = beat !== 1;
    if (beat === 1) LINK_TIMES.forEach((t, i) => (born[i] = t));
    let last = performance.now();
    let raf;
    const pos = OBJ.map(() => ({ x: 0, y: 0 }));

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const time = (now - t0) / 1000;
      master += dt * TAU * F0;
      LINKS.forEach((_, i) => {
        if (!sounded[i] && time >= born[i]) {
          sounded[i] = true;
          pluck(note(3 + i, 220), { vol: 0.2, decay: 1.2 });
        }
      });
      if (!finale && time > LINK_TIMES[5] + 0.8) {
        finale = true;
        chord([5, 7, 9, 12], 220, { vol: 0.12, spread: 0.05, decay: 2 });
      }

      // which objects have been reached by a finished thread
      LINKS.forEach(([a, b], i) => {
        const age = time - born[i];
        if (age > 0.7) lock[b] = Math.min(1, lock[b] + dt * 0.9);
        if (i === 0 && age > 0) lock[a] = Math.min(1, lock[a] + dt * 0.9);
      });

      for (let i = 0; i < n; i++) {
        const f = OBJ[i].f + (F0 - OBJ[i].f) * lock[i];
        theta[i] += dt * TAU * f;
        // phase-lock into a travelling wave around the loop
        const target = master - i * (TAU / n);
        let d = target - theta[i];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        theta[i] += d * lock[i] * dt * 2.2;
      }

      // place objects
      for (let i = 0; i < n; i++) {
        const el = objEls.current[i];
        if (!el) continue;
        const b = S.base[i];
        const th = theta[i];
        const id = OBJ[i].id;
        let x = b.x;
        let y = b.y;
        let tr = '';
        if (id === 'pend') {
          const a = 0.55 * Math.sin(th);
          x = b.x + 300 * Math.sin(a);
          y = b.y + 300 * Math.cos(a);
          tr = ` rotate(${(-a * 180) / Math.PI})`;
          threadEl.current.setAttribute('d', `M${b.x},${b.y - 200} L${b.x},${b.y} L${x},${y - 34}`);
        } else if (id === 'orb') {
          y = b.y + 46 * Math.sin(th);
        } else if (id === 'orbit') {
          el.querySelector('.moons').setAttribute('transform', `rotate(${(th * 180) / Math.PI})`);
          y = b.y + 10 * Math.sin(th * 2);
        } else if (id === 'bulb') {
          const k = 1 + 0.16 * Math.sin(th);
          y = b.y - 20 * Math.sin(th);
          tr = ` scale(${2 - k} ${k})`;
        } else if (id === 'flower') {
          el.querySelector('.petals').setAttribute('transform', `rotate(${(th * 180) / Math.PI / 2})`);
          tr = ` scale(${1 + 0.06 * Math.sin(th)})`;
          y = b.y + 8 * Math.sin(th);
        } else {
          x = b.x + 120 * Math.sin(th);
          y = b.y + 26 * Math.sin(th * 2);
          tr = ` rotate(${18 * Math.cos(th)})`;
        }
        pos[i].x = x;
        pos[i].y = y;
        el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${tr}`);
      }

      // threads
      LINKS.forEach(([a, b], i) => {
        const el = linkEls.current[i];
        const pe = pulseEls.current[i];
        const age = time - born[i];
        if (!el) return;
        if (age < 0) {
          el.setAttribute('d', '');
          coreEls.current[i].setAttribute('d', '');
          pe.setAttribute('opacity', 0);
          return;
        }
        const p = Math.min(1, age / 0.7);
        const ep = 1 - Math.pow(1 - p, 3);
        const A = pos[a];
        const B = pos[b];
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const L = Math.hypot(dx, dy) || 1;
        const sag = 46 + 14 * Math.sin(master + i);
        const cx = mx + (-dy / L) * sag * 0.3;
        const cy = my + sag;
        let d = `M${A.x.toFixed(1)},${A.y.toFixed(1)}`;
        const steps = 26;
        for (let k = 1; k <= steps; k++) {
          const t = (k / steps) * ep;
          const u = 1 - t;
          d += `L${(u * u * A.x + 2 * u * t * cx + t * t * B.x).toFixed(1)},${(u * u * A.y + 2 * u * t * cy + t * t * B.y).toFixed(1)}`;
        }
        el.setAttribute('d', d);
        coreEls.current[i].setAttribute('d', d);
        // a light pulse rides each finished thread, in step with the shared rhythm
        if (p >= 1) {
          const t = ((master / TAU + i / n) % 1 + 1) % 1;
          const u = 1 - t;
          pe.setAttribute('cx', u * u * A.x + 2 * u * t * cx + t * t * B.x);
          pe.setAttribute('cy', u * u * A.y + 2 * u * t * cy + t * t * B.y);
          pe.setAttribute('opacity', Math.sin(t * Math.PI));
        } else pe.setAttribute('opacity', 0);
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [beat, replayKey]);

  /* ---------- drag any object ---------- */
  useEffect(() => {
    const S = sim.current;
    const move = (e) => {
      if (S.drag < 0) return;
      const p = toStage(e);
      S.base[S.drag].x = p.x - S.off.x;
      S.base[S.drag].y = p.y - S.off.y;
    };
    const up = () => (S.drag = -1);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
  const grab = (i) => (e) => {
    const p = toStage(e);
    const S = sim.current;
    S.drag = i;
    S.off = { x: p.x - S.base[i].x, y: p.y - S.base[i].y };
    pluck(note(i + 2, 330), { vol: 0.12, decay: 0.5 });
  };

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 1 : 2.4 });
      gsap.to(q('.s2-glow'), { opacity: 0.75, duration: 5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    },
    init: (q) => {
      gsap.set(q('.s2-trunk'), { scaleY: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s2-obj-in'), { scale: 0, transformOrigin: '50% 50%' });
      gsap.set(q('.s2-kicker, .s2-hint'), { opacity: 0, y: 20 });
      gsap.set(q('.s2-w0 .split-unit .split-unit'), { opacity: 0, y: 60 });
      gsap.set(q('.s2-w1 .split-unit .split-unit'), { opacity: 0 });
      gsap.set(q('.s2-statement .split-line'), { yPercent: 110 });
      gsap.set(q('.s2-threads'), { opacity: 1 });
    },
    beats: [
      (tl, q, { instant }) => {
        tl.to(q('.s2-trunk'), { scaleY: 1, duration: 1.2, ease: 'expo.out', stagger: { each: 0.06, from: 'center' } }, 0)
          .to(q('.plant'), { scale: 1, duration: 1, ease: 'back.out(1.6)', stagger: 0.05 }, 0.3)
          .to(q('.s2-obj-in'), { scale: 1, duration: 0.8, ease: 'back.out(2.4)', stagger: { each: 0.12, from: 'random' } }, 0.5)
          .to(q('.s2-kicker'), { opacity: 1, y: 0, duration: 0.8 }, 0.4);
        // UNRELATED. — letters arrive on their own and keep their own time
        const chars = q('.s2-w0 .split-unit .split-unit');
        chars.forEach((c, i) => {
          tl.to(c, { opacity: 1, y: 0, duration: 0.9 + (i % 3) * 0.3, ease: 'power3.out' }, 0.8 + ((i * 7) % 10) * 0.07);
          if (!instant) gsap.to(c, { y: `+=${10 + (i % 4) * 6}`, rotation: (i % 2 ? 1 : -1) * (2 + (i % 3)), duration: 1.4 + (i % 5) * 0.37, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 2 + i * 0.05 });
        });
      },
      (tl, q) => {
        // UNTIL CONNECTED. — letters start apart, then pull together and lock
        tl.to(q('.s2-w0'), { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in' }, 0);
        const chars = q('.s2-w1 .split-unit .split-unit');
        const mid = (chars.length - 1) / 2;
        chars.forEach((c, i) => {
          tl.fromTo(c, { opacity: 0, x: (i - mid) * 46, y: ((i * 37) % 7) * 6 - 18 }, { opacity: 1, x: (i - mid) * 46, y: 0, duration: 0.4 }, 0.3 + i * 0.03);
        });
        tl.to(chars, { x: 0, duration: 1.1, ease: 'elastic.out(1, 0.55)', stagger: { each: 0.02, from: 'center' } }, 1.3);
      },
      (tl, q) => {
        tl.set(q('.s2-w0'), { opacity: 0 })
          .to(q('.s2-w1'), { yPercent: -40, opacity: 0, duration: 0.6, ease: 'power3.in' }, 0)
          .to(q('.s2-statement .split-line'), { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.12 }, 0.45)
          .to(q('.s2-hint'), { opacity: 1, y: 0, duration: 0.8 }, 1.4);
      },
    ],
  });

  return (
    <div ref={scope} className="scene s2">
      <div className="layer s2-sky" />
      <div className="layer s2-glow" />
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s2" />
        <defs>
          {[
            ['sun', '#ffc94a'],
            ['lumen', '#8ff7dc'],
            ['cream', '#f5ead3'],
            ['violet', '#a77cf2'],
            ['coral', '#ff6a55'],
          ].map(([k, c]) => (
            <radialGradient key={k} id={`s2-halo-${k}`}>
              <stop offset="0" stopColor={c} stopOpacity="0.55" />
              <stop offset="0.4" stopColor={c} stopOpacity="0.14" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
          <radialGradient id="s2-orb" cx="0.4" cy="0.35">
            <stop offset="0" stopColor="#eafff8" />
            <stop offset="0.5" stopColor="#8ff7dc" />
            <stop offset="1" stopColor="#1fa596" />
          </radialGradient>
          <linearGradient id="s2-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a0f45" stopOpacity="0" />
            <stop offset="0.3" stopColor="#1b0c3a" />
            <stop offset="1" stopColor="#0c0722" />
          </linearGradient>
        </defs>

        {/* far red trees */}
        <g data-depth="0.15" opacity="0.55">
          {[260, 980, 1580].map((x, i) => (
            <g key={i} className="s2-trunk">
              <path d={limb([x, 1080], [x + 20, 600], [x - 10, 120], 26, 8)} fill="#e0405a" />
              <path d={limb([x + 5, 640], [x + 120, 560], [x + 210, 380], 12, 3)} fill="#e0405a" />
              <path d={limb([x, 480], [x - 110, 400], [x - 170, 230], 10, 2.5)} fill="#e0405a" />
              <path d={limb([x + 8, 820], [x - 90, 760], [x - 150, 640], 10, 3)} fill="#e0405a" />
            </g>
          ))}
        </g>
        {TRUNKS.map((t, i) => (
          <g key={i} data-depth={t.d}>
            <path className="s2-trunk" d={`M${t.x - t.w / 2},1090 L${t.x - t.w * 0.38},-20 L${t.x + t.w * 0.38},-20 L${t.x + t.w / 2},1090Z`} fill={t.c} />
          </g>
        ))}
        <rect x="0" y="700" width="1920" height="380" fill="url(#s2-floor)" />
      </svg>

      <Motes lite={lite} count={90} colors={['#ff9a72', '#a77cf2', '#ffc94a']} size={26} speed={0.6} />

      <svg className="fill s2-system" viewBox="0 0 1920 1080">
        <path ref={threadEl} fill="none" stroke="#ffc94a" strokeOpacity="0.5" strokeWidth="2" />
        <g className="s2-threads">
          {LINKS.map((_, i) => (
            <path key={i} ref={(el) => (linkEls.current[i] = el)} fill="none" stroke="#ffe7a0" strokeOpacity="0.2" strokeWidth="12" strokeLinecap="round" />
          ))}
          {LINKS.map((_, i) => (
            <path key={'c' + i} ref={(el) => (coreEls.current[i] = el)} fill="none" stroke="#fff3cf" strokeOpacity="0.9" strokeWidth="2.5" strokeLinecap="round" />
          ))}
        </g>
        <g className="s2-cores">
          {LINKS.map((_, i) => (
            <circle key={i} ref={(el) => (pulseEls.current[i] = el)} r="7" fill="#fff8e0" opacity="0" />
          ))}
        </g>
        {OBJ.map((o, i) => (
          <g key={o.id} ref={(el) => (objEls.current[i] = el)} onPointerDown={grab(i)} style={{ cursor: 'grab', pointerEvents: 'auto' }}>
            <g className="s2-obj-in">
              <Draw id={o.id} />
            </g>
          </g>
        ))}
      </svg>

      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s2n" />
        <g data-depth="1.1">
          <Plants list={FLOOR} p="s2n" />
        </g>
      </svg>

      <div className="s2-kicker t-mono">
        <span className="idx">{C.index}</span> {C.kicker}
      </div>
      <div className="s2-words">
        <h2 className="t-display s2-w s2-w0">
          <Split text={C.words[0]} />
        </h2>
        <h2 className="t-display s2-w s2-w1">
          <Split text={C.words[1]} />
        </h2>
        <p className="t-quote s2-statement">
          {C.statement.map((l, i) => (
            <span className="mask-line" key={i}>
              <span className="split-line">{l}</span>
            </span>
          ))}
        </p>
      </div>
      <div className="s2-hint t-mono">{C.hint}</div>
      <Vignette strength={0.5} />
    </div>
  );
}
