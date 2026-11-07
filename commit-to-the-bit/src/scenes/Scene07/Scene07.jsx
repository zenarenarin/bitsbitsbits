import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { scene07 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { pluck, note, thump, miss, whoosh } from '../../systems/audio/sound.js';
import { createRunner } from './runner.js';
import './scene07.css';

/* One corridor, one action. Each presenter beat moves the same game to its
   next stage: the walls close in, the floor speeds up, obstacles start to
   combine and move. The words do what they say. */

export default function Scene07({ beat, replayKey }) {
  const scope = useRef(null);
  const canvas = useRef(null);
  const run = useRef(null);
  const human = useRef(0);

  useEffect(() => {
    const R = createRunner();
    run.current = R;
    const cv = canvas.current;
    const k = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 1920 * k;
    cv.height = 600 * k;
    const ctx = cv.getContext('2d');
    let raf;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      R.step(dt);
      R.draw(ctx, k);
      R.s.events.splice(0).forEach((e) => {
        if (e.type === 'hit') miss();
        else if (e.type === 'land') thump({ freq: 140, vol: 0.08 });
        else if (e.type === 'bonk') thump({ freq: 220, vol: 0.06 });
        else if (e.type === 'jump' && R.s.t - R.s.lastHuman < 0.1) pluck(note(4, 330), { vol: 0.06, decay: 0.15 });
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // each beat is a stage of the same game
  useEffect(() => {
    if (!run.current) return;
    const n = Math.min(2, beat);
    if (run.current.s.stage !== n) {
      run.current.setStage(n);
      whoosh({ dur: 0.7, from: 300, to: 2400, vol: 0.12 });
    }
  }, [beat]);

  const setStage = (n) => {
    run.current.setStage(n);
    whoosh({ dur: 0.7, from: 300, to: 2400, vol: 0.12 });
    scope.current.querySelectorAll('.s7-stage').forEach((el, i) => el.classList.toggle('on', i === n));
  };

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'arrowup') {
        e.preventDefault();
        run.current.jump(true);
      } else if (['1', '2', '3'].includes(k)) setStage(+k - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useBeats(scope, beat, replayKey, {
    init: (q) => {
      gsap.set(q('.s7-head .split-line'), { yPercent: 110, opacity: 0 });
      gsap.set(q('.s7-course'), { clipPath: 'inset(50% 0 50% 0)' });
      gsap.set(q('.s7-word'), { opacity: 0 });
      gsap.set(q('.s7-stages'), { opacity: 0, y: 20 });
      q('.s7-stage').forEach((el, i) => el.classList.toggle('on', i === Math.min(2, beat)));
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.s7-course'), { clipPath: 'inset(0% 0 0% 0)', duration: 1.1, ease: 'expo.inOut' }, 0)
          .to(q('.s7-head .split-line'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.12 }, 0.3)
          .to(q('.s7-stages'), { opacity: 1, y: 0, duration: 0.6 }, 0.9)
          .set(q('.s7-w0'), { opacity: 1 }, 0.8)
          .fromTo(q('.s7-w0 .ch'), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.04 }, 0.8),
      (tl, q) => {
        tl.to(q('.s7-w0'), { opacity: 0, y: -20, duration: 0.4 }, 0)
          .set(q('.s7-w1'), { opacity: 1 }, 0.2)
          // FASTER. arrives at speed and overshoots
          .fromTo(q('.s7-w1 .faster .ch'), { x: 520, skewX: -30, opacity: 0 }, { x: 0, skewX: 0, opacity: 1, duration: 0.55, ease: 'power4.out', stagger: 0.03 }, 0.25)
          // TIGHTER. closes its own letter-spacing
          .fromTo(q('.s7-w1 .tighter'), { letterSpacing: '0.5em', opacity: 0 }, { letterSpacing: '-0.02em', opacity: 1, duration: 1.1, ease: 'expo.inOut' }, 0.7);
      },
      (tl, q) => {
        tl.to(q('.s7-w1'), { opacity: 0, y: -20, duration: 0.4 }, 0).set(q('.s7-w2'), { opacity: 1 }, 0.2);
        // SMARTER. letters arrive shuffled and sort themselves out
        const chars = q('.s7-w2 .ch');
        const order = [4, 0, 6, 2, 7, 1, 5, 3];
        chars.forEach((c, i) => {
          const from = order[i % order.length];
          tl.fromTo(c, { x: (from - i) * 70, y: (i % 2 ? -1 : 1) * 60, rotation: (i % 2 ? 1 : -1) * 25, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.9, ease: 'back.out(1.6)' }, 0.25 + i * 0.05);
        });
      },
    ],
  });

  const chars = (t) =>
    t.split('').map((c, i) => (
      <span key={i} className="ch">
        {c === ' ' ? ' ' : c}
      </span>
    ));
  const [faster, tighter] = C.stages[1].word.split(' ');

  return (
    <div ref={scope} className="scene s7">
      <h2 className="s7-head t-display">
        <span className="mask-line"><span className="split-line">{C.headline[0]}</span></span>
        <span className="mask-line"><span className="split-line accent">{C.headline[1]}</span></span>
      </h2>

      <div className="s7-words t-display">
        <div className="s7-word s7-w0">{chars(C.stages[0].word)}</div>
        <div className="s7-word s7-w1">
          <span className="faster">{chars(faster)}</span>
          <span className="tighter">{tighter}</span>
        </div>
        <div className="s7-word s7-w2">{chars(C.stages[2].word)}</div>
      </div>

      <canvas
        ref={canvas}
        className="s7-course"
        onPointerDown={() => {
          human.current++;
          run.current.jump(true);
        }}
      />

      <div className="s7-stages">
        {C.stages.map((st, i) => (
          <button key={st.n} className="s7-stage" onClick={(e) => (e.currentTarget.blur(), setStage(i))}>
            <span className="t-mono">Stage</span>
            <span className="t-display n">{st.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
