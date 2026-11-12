import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { scene05 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { toStage } from '../../systems/stage/Stage.jsx';
import { pluck, note, thump, miss, chord } from '../../systems/audio/sound.js';
import { createGame } from './engine.js';
import { FoliageDefs, Plants } from '../../systems/environment/foliage.jsx';
import { swayAll, useParallax } from '../../systems/environment/atmosphere.jsx';

// specimens on the table: oversized, pressed-looking, at the edges only
const SPECIMENS = [
  { kind: 'frond', x: 1250, y: -40, s: 0.85, r: 192, h: 420, n: 13, leaf: 46, bend: 0.35, fill: 'moss', stem: '#0c3a2c' },
  { kind: 'twig', x: 1560, y: 1110, s: 1, r: -12, h: 300, bend: 0.4, buds: 6, fill: 'coral', stem: '#3a2a1a', seed: 6 },
  { kind: 'blade', x: 1890, y: 1110, r: -24, h: 460, w: 100, bend: -0.3, fill: 'forest' },
  { kind: 'paddle', x: 2010, y: 1140, s: 1, r: -52, h: 460, w: 200, stripes: 6, fill: 'forest', stripe: '#03201a' },
]
import './scene05.css';

/* A laboratory on paper. Three columns of words read as one sentence —
   "tap · bounce · avoid" — and the sentence is compiled, live, into the
   game spinning in the dish on the right. Change one word and the game
   changes underneath you. */

const SIZE = 680;
const CX = 1350;
const CY = 560;
const DEFAULT = { action: 'tap', world: 'bounce', goal: 'avoid' };

export default function Scene05({ beat, replayKey, lite }) {
  const scope = useRef(null);
  const canvas = useRef(null);
  const game = useRef(null);
  const scoreEl = useRef(null);
  const bestEl = useRef(null);
  const livesEl = useRef(null);
  const [combo, setCombo] = useState(DEFAULT);
  useParallax(scope, { enabled: !lite, strength: 10 });

  /* ---------- the game loop ---------- */
  useEffect(() => {
    const G = createGame({ size: SIZE });
    game.current = G;
    const cv = canvas.current;
    const k = Math.min(2, window.devicePixelRatio || 1) * 1.2;
    cv.width = SIZE * k;
    cv.height = SIZE * k;
    const ctx = cv.getContext('2d');
    let raf;
    let last = performance.now();
    let shown = { s: -1, b: -1, l: -1 };
    const frame = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      G.step(dt);
      G.draw(ctx, k);
      // feedback
      G.g.events.splice(0).forEach((e) => {
        if (e.type === 'collect') pluck(note(5 + (G.g.score % 5), 220), { vol: 0.14, decay: 0.4 });
        else if (e.type === 'merge') pluck(note(2, 330), { vol: 0.1, decay: 0.3 });
        else if (e.type === 'hit') {
          miss();
          gsap.fromTo(scope.current.querySelector('.s5-dish'), { scale: 0.97 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.3)' });
        } else if (e.type === 'act') pluck(note(1, 330), { vol: 0.06, decay: 0.15 });
        else if (e.type === 'wall' && e.v > 500) thump({ freq: 160, vol: 0.08 });
      });
      const { score, best, lives, combo: cb } = G.g;
      if (score !== shown.s) {
        scoreEl.current.textContent = score;
        if (score > shown.s && score > 0) gsap.fromTo(scoreEl.current, { scale: 1.25 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1.2, 0.4)' });
      }
      if (best !== shown.b) {
        bestEl.current.textContent = best;
        if (best > 0) gsap.fromTo(bestEl.current, { color: '#ff6a55' }, { color: '#1c1640', duration: 0.9 });
      }
      const l = cb.goal === 'survive' ? lives : -1;
      if (l !== shown.l) livesEl.current.textContent = l < 0 ? '' : '● '.repeat(l).trim();
      shown = { s: score, b: best, l };
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    game.current && game.current.setCombo(combo);
  }, [combo]);

  /* ---------- pointer inside the dish ---------- */
  const local = (e) => {
    const p = toStage(e);
    return { x: p.x - (CX - SIZE / 2), y: p.y - (CY - SIZE / 2) };
  };
  useEffect(() => {
    const move = (e) => {
      const p = local(e);
      game.current.move(p.x, p.y);
    };
    const up = () => game.current.release();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
  const down = (e) => {
    const p = local(e);
    game.current.press(p.x, p.y);
  };

  const choose = (key, value, i) => {
    if (combo[key] === value) return;
    setCombo((c) => ({ ...c, [key]: value }));
    pluck(note(3 + i * 2, 220), { vol: 0.16, decay: 0.6 });
    requestAnimationFrame(() => {
      const el = scope.current.querySelector(`.s5-word[data-k="${key}"][data-v="${value}"]`);
      el && gsap.fromTo(el, { scale: 0.6, rotation: -6 }, { scale: 1, rotation: 0, duration: 0.8, ease: 'elastic.out(1.1, 0.45)', transformOrigin: '0% 60%' });
      if (key === 'world') gsap.fromTo(scope.current.querySelector('.s5-dish'), { rotation: -4 }, { rotation: 0, duration: 1, ease: 'elastic.out(1, 0.3)' });
    });
  };
  const reset = () => {
    setCombo(DEFAULT);
    game.current.setCombo(DEFAULT);
    game.current.reset(true);
    thump({ freq: 90, vol: 0.2 });
  };
  useEffect(() => {
    const onKey = (e) => e.key.toLowerCase() === 'x' && reset();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useBeats(scope, beat, replayKey, {
    ambient: (q) => {
      swayAll(q('.sway'), { amp: lite ? 0.8 : 1.6 });
      gsap.to(q('.s5-ripple'), { scale: 1.06, opacity: 0.5, duration: 3.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    },
    init: (q) => {
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
      gsap.set(q('.s5-head .split-line'), { yPercent: 110, opacity: 0 });
      gsap.set(q('.s5-dish'), { scale: 0, transformOrigin: '50% 50%' });
      gsap.set(q('.s5-col'), { opacity: 0, y: 40 });
      gsap.set(q('.s5-plus'), { opacity: 0, scale: 0 });
      gsap.set(q('.s5-score, .s5-reset'), { opacity: 0, y: 20 });
      gsap.set(q('.s5-board'), { opacity: 0, y: 24 });
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.plant'), { scale: 1, duration: 1.1, ease: 'back.out(1.5)', stagger: 0.07 }, 0)
          .to(q('.s5-head .split-line'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.1 }, 0)
          .to(q('.s5-dish'), { scale: 1, duration: 1.2, ease: 'elastic.out(1, 0.6)' }, 0.25)
          .to(q('.s5-col'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12 }, 0.6)
          .to(q('.s5-plus'), { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(3)', stagger: 0.12 }, 0.9)
          .to(q('.s5-score, .s5-reset'), { opacity: 1, y: 0, duration: 0.7 }, 1.2),
      (tl, q, { instant }) => {
        tl.to(q('.s5-board'), { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 0)
          .fromTo(q('.s5-best'), { scale: 1 }, { scale: 1.15, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out', transformOrigin: '0% 50%' }, 0.3);
        if (!instant) tl.call(() => chord([4, 7, 9], 262, { vol: 0.1 }), null, 0.3);
      },
    ],
  });

  return (
    <div ref={scope} className="scene s5">
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="s5" />
        <g data-depth="0.8">
          <Plants list={SPECIMENS} p="s5" />
        </g>
      </svg>
      <h2 className="s5-head">
        <span className="mask-line"><span className="split-line t-display">{C.headline[0]}</span></span>
        <span className="mask-line"><span className="split-line t-quote">{C.headline[1]}</span></span>
      </h2>

      <div className="s5-sentence">
        {C.slots.map((slot, si) => (
          <div key={slot.key} className="s5-group">
            {si > 0 && <span className="s5-plus">+</span>}
            <div className={`s5-col s5-col-${slot.key}`}>
              <span className="t-mono s5-label">{slot.label}</span>
              {slot.options.map((o) =>
                slot.live.includes(o) ? (
                  <button
                    key={o}
                    className={`s5-word ${combo[slot.key] === o ? 'on' : ''}`}
                    data-k={slot.key}
                    data-v={o}
                    onClick={(e) => (e.currentTarget.blur(), choose(slot.key, o, si))}
                  >
                    {o}
                  </button>
                ) : (
                  <span key={o} className="s5-word ghost">
                    {o}
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="s5-dish" style={{ left: CX - SIZE / 2, top: CY - SIZE / 2, width: SIZE, height: SIZE }} onPointerDown={down}>
        <div className="s5-ripple" />
        <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
      </div>

      <div className="s5-score">
        <span className="t-mono s5-fb">{C.feedback}</span>
        <span className="t-mono">{C.score}</span>
        <span ref={scoreEl} className="t-display s5-num">0</span>
        <span className="t-mono s5-lives" ref={livesEl} />
        <span className="t-mono s5-best">
          {combo.goal === 'avoid' || combo.goal === 'survive' ? C.bestTime : C.best} <b ref={bestEl}>0</b>
        </span>
      </div>

      <p className="t-quote s5-board">{C.leaderboard}</p>
      <button className="ctrl s5-reset" onClick={(e) => (e.currentTarget.blur(), reset())}>
        {C.reset} <span className="key">X</span>
      </button>
    </div>
  );
}
