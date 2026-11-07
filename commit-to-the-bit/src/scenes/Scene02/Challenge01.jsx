import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { challenge01 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { FoliageDefs, Plants } from '../../systems/environment/foliage.jsx';
import { swayAll, Vignette } from '../../systems/environment/atmosphere.jsx';
import { pluck, note, chord, whoosh, thump } from '../../systems/audio/sound.js';
import './challenge01.css';

/* The forest pulls back to the edges and leaves a clean playground: two
   ingredients as two dots, and the thread between them is the clock.
   The Bit walks the thread for 45 seconds. Connect them before it arrives. */

const A = { x: 560, y: 520 };
const B = { x: 1360, y: 520 };
const RAD = 200;
const T0 = { x: A.x + RAD + 14, y: A.y };
const T1 = { x: B.x - RAD - 14, y: B.y };
const SAG = 110;
const qp = (t) => {
  const cx = (T0.x + T1.x) / 2;
  const cy = T0.y + SAG * 2;
  const u = 1 - t;
  return { x: u * u * T0.x + 2 * u * t * cx + t * t * T1.x, y: u * u * T0.y + 2 * u * t * cy + t * t * T1.y };
};
const THREAD_D = `M${T0.x},${T0.y} Q${(T0.x + T1.x) / 2},${T0.y + SAG * 2} ${T1.x},${T1.y}`;

const EDGE = [
  { kind: 'paddle', x: -60, y: 1140, s: 0.95, r: 44, h: 520, w: 210, stripes: 7, fill: 'indigo', stripe: '#120d3a', rib: false },
  { kind: 'frond', x: 40, y: 1110, s: 0.8, r: 30, h: 380, n: 12, leaf: 46, bend: 0.3, fill: 'violet', stem: '#1a1048' },
  { kind: 'paddle', x: 1980, y: 1140, s: 0.95, r: -44, h: 520, w: 210, stripes: 7, fill: 'indigo', stripe: '#120d3a', flip: true, rib: false },
  { kind: 'twig', x: 1880, y: 1100, s: 0.8, h: 300, bend: -0.4, buds: 6, fill: 'coral', stem: '#120d3a', seed: 4 },
];

function Ingredient({ side, label }) {
  const words = label.split(' ');
  const article = words[0].toLowerCase() === 'a' || words[0].toLowerCase() === 'an' ? words.shift() : '';
  return (
    <div className={`c1-ing c1-ing-${side}`}>
      <div className="c1-ing-in">
        <span className="t-mono c1-ing-tag">Ingredient {side === 'a' ? 'A' : 'B'}</span>
        <span className="c1-ing-article">{article}</span>
        <span className="t-head c1-ing-name">{words.join(' ')}</span>
      </div>
    </div>
  );
}

export default function Challenge01({ beat, replayKey, next }) {
  const scope = useRef(null);
  const [pair, setPair] = useState(0);
  const [state, setState] = useState('idle'); // idle | running | paused | done
  const [left, setLeft] = useState(C.duration);
  const clock = useRef({ elapsed: 0, last: 0 });
  const bitRef = useRef(null);
  const fillRef = useRef(null);
  const raf = useRef(0);
  const stageRef = useRef(state);
  stageRef.current = state;

  const placeBit = (t) => {
    const p = qp(t);
    gsap.set(bitRef.current, { x: p.x, y: p.y - 26, rotation: t * 1400 });
    if (fillRef.current) fillRef.current.style.strokeDashoffset = 1000 - t * 1000;
  };

  const stop = () => cancelAnimationFrame(raf.current);

  const tick = useCallback((now) => {
    const c = clock.current;
    c.elapsed += (now - c.last) / 1000;
    c.last = now;
    const t = Math.min(1, c.elapsed / C.duration);
    placeBit(t);
    const l = Math.max(0, Math.ceil(C.duration - c.elapsed));
    setLeft((prev) => {
      if (prev !== l && l <= 5 && l > 0) pluck(note(7, 220), { vol: 0.12, decay: 0.3 });
      return l;
    });
    if (t >= 1) {
      setState('done');
      chord([0, 4, 7, 9, 12], 220, { vol: 0.16, spread: 0.08, decay: 2 });
      thump({ freq: 120, vol: 0.3 });
      gsap.fromTo(scope.current.querySelectorAll('.c1-ing-in'), { scale: 1.12 }, { scale: 1, duration: 1.2, ease: 'elastic.out(1, 0.4)' });
      gsap.fromTo(scope.current.querySelector('.c1-done'), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' });
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    const s = stageRef.current;
    if (s === 'running') {
      stop();
      setState('paused');
      return;
    }
    if (s === 'done') return;
    clock.current.last = performance.now();
    setState('running');
    pluck(note(5, 220), { vol: 0.2 });
    raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const reset = useCallback(() => {
    stop();
    clock.current.elapsed = 0;
    setLeft(C.duration);
    setState('idle');
    placeBit(0);
    gsap.set(scope.current.querySelector('.c1-done'), { opacity: 0 });
    thump({ freq: 90, vol: 0.2 });
  }, []);

  const shuffle = useCallback(() => {
    const ings = scope.current.querySelectorAll('.c1-ing-in');
    whoosh({ dur: 0.5, from: 600, to: 2600, vol: 0.12 });
    gsap
      .timeline()
      .to(ings, { rotationY: 90, duration: 0.22, ease: 'power2.in', stagger: 0.08 })
      .call(() => setPair((p) => (p + 1) % C.pairs.length))
      .to(ings, { rotationY: 0, duration: 0.7, ease: 'elastic.out(1, 0.5)', stagger: 0.08 });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 't') start();
      else if (k === 's') shuffle();
      else if (k === 'x') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stop();
    };
  }, [start, shuffle, reset]);

  useEffect(() => placeBit(0), []);

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: 1.6 });
      gsap.to(q('.c1-ing-a .c1-float'), { y: -12, duration: 2.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      gsap.to(q('.c1-ing-b .c1-float'), { y: -12, duration: 3.1, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: -1.2 });
    },
    init: (q) => {
      gsap.set(q('.c1-kicker, .c1-title, .c1-inst, .c1-controls'), { opacity: 0, y: 24 });
      gsap.set(q('.c1-ing'), { scale: 0 });
      gsap.set(q('.c1-thread, .c1-fill'), { opacity: 0 });
      gsap.set(q('.c1-prompt'), { opacity: 0, y: 30 });
      gsap.set(q('.c1-count'), { opacity: 0, scale: 0.6 });
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.plant'), { scale: 1, duration: 1, ease: 'back.out(1.5)', stagger: 0.06 }, 0)
          .to(q('.c1-kicker'), { opacity: 1, y: 0, duration: 0.7 }, 0.1)
          .to(q('.c1-title'), { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, 0.2)
          .to(q('.c1-ing'), { scale: 1, duration: 1, ease: 'elastic.out(1, 0.55)', stagger: 0.15 }, 0.35)
          .to(q('.c1-thread'), { opacity: 1, duration: 0.6 }, 0.9)
          .to(q('.c1-fill'), { opacity: 1, duration: 0.3 }, 0.9)
          .to(q('.c1-count'), { opacity: 1, scale: 1, duration: 0.8, ease: 'back.out(2)' }, 1.0)
          .to(q('.c1-inst'), { opacity: 1, y: 0, duration: 0.7 }, 1.1)
          .to(q('.c1-prompt'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12 }, 1.3)
          .to(q('.c1-controls'), { opacity: 1, y: 0, duration: 0.7 }, 1.7),
    ],
  });

  const [a, b] = C.pairs[pair];
  const elapsed = C.duration - left;
  const active = state === 'idle' ? -1 : Math.min(2, Math.floor(elapsed / (C.duration / 3)));

  return (
    <div ref={scope} className={`scene c1 is-${state}`}>
      <div className="layer c1-bg" />
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="c1" />
        <Plants list={EDGE} p="c1" />
      </svg>

      <div className="c1-kicker t-mono">
        <span className="idx">{C.kicker}</span> · {C.duration} seconds
      </div>
      <h2 className="t-display c1-title">{C.title}</h2>

      <div className="c1-float-wrap" style={{ left: A.x, top: A.y }}>
        <div className="c1-float">
          <Ingredient side="a" label={a} />
        </div>
      </div>
      <div className="c1-float-wrap" style={{ left: B.x, top: B.y }}>
        <div className="c1-float">
          <Ingredient side="b" label={b} />
        </div>
      </div>

      <svg className="fill" viewBox="0 0 1920 1080" style={{ zIndex: 6 }}>
        <path className="c1-thread" d={THREAD_D} fill="none" stroke="#f5ead3" strokeOpacity="0.28" strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" />
        <path ref={fillRef} className="c1-fill" d={THREAD_D} fill="none" stroke="#ffc94a" strokeWidth="5" strokeLinecap="round" pathLength="1000" strokeDasharray="1000" strokeDashoffset="1000" />
      </svg>
      <div ref={bitRef} className="bit c1-bit" style={{ width: 44, height: 44, margin: '-22px 0 0 -22px' }} />

      <div className="c1-count" style={{ left: (T0.x + T1.x) / 2 }}>
        <span className="t-display">{left}</span>
        <span className="t-mono">{state === 'idle' ? 'Seconds' : state === 'paused' ? 'Paused' : state === 'done' ? 'Time' : 'Left'}</span>
      </div>

      <p className="c1-inst">{C.instruction}</p>

      <div className="c1-prompts">
        {C.prompts.map((p, i) => (
          <div key={p.n} className={`c1-prompt ${i === active ? 'on' : ''}`}>
            <span className="t-mono n">{p.n}</span>
            <span className="q">{p.q}</span>
          </div>
        ))}
      </div>

      <div className="c1-done t-head">{C.done}</div>

      <div className="c1-controls">
        <button className="ctrl solid" onClick={(e) => (e.currentTarget.blur(), start())} disabled={state === 'done'}>
          {state === 'running' ? C.controls.pause : C.controls.start} <span className="key">T</span>
        </button>
        <button className="ctrl" onClick={(e) => (e.currentTarget.blur(), shuffle())}>
          {C.controls.shuffle} <span className="key">S</span>
        </button>
        <button className="ctrl" onClick={(e) => (e.currentTarget.blur(), reset())}>
          {C.controls.reset} <span className="key">X</span>
        </button>
        <button className="ctrl ghost" onClick={(e) => (e.currentTarget.blur(), next())}>
          {C.controls.skip} <span className="key">→</span>
        </button>
      </div>
      <Vignette strength={0.45} />
    </div>
  );
}
