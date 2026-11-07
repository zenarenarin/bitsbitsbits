import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { scene09 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { toStage } from '../../systems/stage/Stage.jsx';
import { pluck, note, chord, miss } from '../../systems/audio/sound.js';
import { createValley } from './valley.js';
import './scene09.css';

/* A path through the valley. Challenge reshapes the world, skill reshapes
   the traveller. Too easy: a wide grey road with nothing on it. Too hard:
   brambles, wind and stalling. In balance: lanterns light up as the Bit
   weaves past them. Two sliders, one living world. */

const PRESETS = [
  { c: 0.12, s: 0.86 }, // boredom
  { c: 0.9, s: 0.18 }, // frustration
  { c: 0.55, s: 0.55 }, // flow
];
const WIDTH = 0.16;
const COLORS = { boredom: '#a9b4cc', flow: '#34d6c2', frustration: '#ff6a55' };
const stateOf = (c, s) => (c - s > WIDTH ? 'frustration' : s - c > WIDTH ? 'boredom' : 'flow');

function Slider({ label, k, onDrag }) {
  const track = useRef(null);
  const down = (e) => {
    const st = document.getElementById('stage').getBoundingClientRect();
    const r = track.current.getBoundingClientRect();
    const scale = st.width / 1920;
    const set = (ev) => {
      const p = toStage(ev);
      const left = (r.left - st.left) / scale;
      const w = r.width / scale;
      onDrag(k, Math.max(0, Math.min(1, (p.x - left) / w)));
    };
    set(e);
    const mv = (ev) => set(ev);
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="s9-slider" onPointerDown={down}>
      <span className="t-mono s9-sl-label">{label}</span>
      <div ref={track} className="s9-track">
        <div className={`s9-fill s9-fill-${k}`} />
        <div className={`s9-knob s9-knob-${k}`} />
      </div>
    </div>
  );
}

export default function Scene09({ beat, replayKey }) {
  const scope = useRef(null);
  const canvas = useRef(null);
  const valley = useRef(null);
  const vals = useRef({ ...PRESETS[0] });
  const [state, setState] = useState('boredom');
  const stateRef = useRef('boredom');

  const apply = () => {
    const { c, s } = vals.current;
    const root = scope.current;
    if (!root) return;
    root.querySelector('.s9-knob-c').style.left = `${c * 100}%`;
    root.querySelector('.s9-fill-c').style.width = `${c * 100}%`;
    root.querySelector('.s9-knob-s').style.left = `${s * 100}%`;
    root.querySelector('.s9-fill-s').style.width = `${s * 100}%`;
    if (valley.current) {
      valley.current.S.c = c;
      valley.current.S.s = s;
    }
    const st = stateOf(c, s);
    if (st !== stateRef.current) {
      stateRef.current = st;
      setState(st);
    }
  };

  useEffect(() => {
    const V = createValley();
    valley.current = V;
    apply();
    const cv = canvas.current;
    const k = Math.min(1.5, window.devicePixelRatio || 1);
    cv.width = 1920 * k;
    cv.height = 1080 * k;
    const ctx = cv.getContext('2d');
    let raf;
    let last = performance.now();
    let lastSound = 0;
    const frame = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      V.step(dt);
      V.draw(ctx, k);
      V.S.events.splice(0).forEach((e) => {
        if (now - lastSound < 160) return;
        lastSound = now;
        if (e.type === 'light') pluck(note(5 + Math.floor(Math.random() * 4), 262), { vol: 0.09, decay: 0.6 });
        else if (e.type === 'bump') miss();
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrag = (k, v) => {
    gsap.killTweensOf(vals.current);
    vals.current[k] = v;
    apply();
  };

  // each beat walks the world to a state; the sliders stay live throughout
  useEffect(() => {
    const target = PRESETS[Math.min(2, beat)];
    gsap.killTweensOf(vals.current);
    gsap.to(vals.current, { ...target, duration: 1.6, ease: 'power3.inOut', onUpdate: apply });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, replayKey]);

  useEffect(() => {
    const w = scope.current.querySelector('.s9-state');
    gsap.fromTo(w, { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'back.out(2)' });
    if (state === 'flow') chord([0, 4, 7], 262, { vol: 0.08, spread: 0.05 });
  }, [state]);

  useBeats(scope, beat, replayKey, {
    init: (q) => {
      gsap.set(q('.s9-head .split-line'), { yPercent: 110, opacity: 0 });
      gsap.set(q('.s9-world'), { opacity: 0, scale: 1.06, transformOrigin: '65% 45%' });
      gsap.set(q('.s9-slider, .s9-statewrap'), { opacity: 0, y: 16 });
      gsap.set(q('.s9-arcade'), { opacity: 0, y: 16 });
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.s9-world'), { opacity: 1, scale: 1, duration: 1.6, ease: 'power3.out' }, 0)
          .to(q('.s9-head .split-line'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.1 }, 0.3)
          .to(q('.s9-statewrap'), { opacity: 1, y: 0, duration: 0.7 }, 0.9)
          .to(q('.s9-slider'), { opacity: 1, y: 0, duration: 0.6, stagger: 0.1 }, 1.1),
      () => {},
      (tl, q) => tl.to(q('.s9-arcade'), { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 1.4),
    ],
  });

  return (
    <div ref={scope} className="scene s9">
      <canvas ref={canvas} className="s9-world" />
      <div className="layer s9-shade" />

      <h2 className="s9-head">
        <span className="mask-line"><span className="split-line t-display">{C.headline[0]}</span></span>
        <span className="mask-line"><span className="split-line t-sub">{C.headline[1]}</span></span>
        <span className="mask-line gap"><span className="split-line t-display">{C.headline[2]}</span></span>
        <span className="mask-line"><span className="split-line t-sub">{C.headline[3]}</span></span>
      </h2>

      <div className="s9-statewrap">
        <div className="s9-state t-display" style={{ color: COLORS[state] }}>
          {C.states[state]}
        </div>
      </div>

      <div className="s9-sliders">
        <Slider label={C.challenge} k="c" onDrag={onDrag} />
        <Slider label={C.skill} k="s" onDrag={onDrag} />
      </div>

      <p className="s9-arcade">{C.arcadeLine}</p>
    </div>
  );
}
