import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { scene09 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { toStage } from '../../systems/stage/Stage.jsx';
import { pluck, note, chord, miss } from '../../systems/audio/sound.js';
import { createField } from './field.js';
import './scene09.css';

/* Two sliders, one field. Wherever challenge and skill put the Bit, the world
   around it answers: still and grey, hot and violent, or streaming. */

const SIZE = 860;
const FX = 960;
const FY = 110;
const WIDTH = 0.11;
const PRESETS = [
  { c: 0.2, s: 0.8 }, // boredom
  { c: 0.86, s: 0.26 }, // frustration
  { c: 0.62, s: 0.6 }, // flow
];
const COLORS = { boredom: '#8fa3c9', flow: '#34d6c2', frustration: '#ff6a55' };
const stateOf = (c, s) => (c - s > WIDTH ? 'frustration' : s - c > WIDTH ? 'boredom' : 'flow');

function Slider({ label, k, vals, onDrag }) {
  const track = useRef(null);
  const down = (e) => {
    const r = track.current.getBoundingClientRect();
    const st = document.getElementById('stage').getBoundingClientRect();
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
  const host = useRef(null);
  const field = useRef(null);
  const bit = useRef(null);
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
    field.current && field.current.point(s, c);
    const st = stateOf(c, s);
    if (st !== stateRef.current) {
      stateRef.current = st;
      setState(st);
      if (st === 'flow') chord([0, 4, 7], 262, { vol: 0.1, spread: 0.05 });
      else if (st === 'frustration') miss();
      else pluck(note(0, 165), { vol: 0.1, decay: 0.8 });
    }
  };

  useEffect(() => {
    field.current = createField(host.current, SIZE);
    apply();
    // the Bit lives in the field and behaves like its state
    let raf;
    const t0 = performance.now();
    let bx = FX + vals.current.s * SIZE;
    let by = FY + (1 - vals.current.c) * SIZE;
    const loop = (now) => {
      const t = (now - t0) / 1000;
      const { c, s } = vals.current;
      const tx = FX + s * SIZE;
      const ty = FY + (1 - c) * SIZE;
      bx += (tx - bx) * 0.12;
      by += (ty - by) * 0.12;
      const st = stateRef.current;
      let ox = 0;
      let oy = 0;
      let sc = 1;
      if (st === 'frustration') {
        ox = (Math.random() - 0.5) * 9;
        oy = (Math.random() - 0.5) * 9;
      } else if (st === 'boredom') {
        oy = Math.sin(t * 0.8) * 4;
        sc = 0.92;
      } else {
        ox = Math.cos(t * 2.4) * 6;
        oy = Math.sin(t * 2.4) * 6;
        sc = 1 + Math.sin(t * 4.8) * 0.08;
      }
      if (bit.current) gsap.set(bit.current, { x: bx + ox, y: by + oy, scale: sc });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      field.current.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrag = (k, v) => {
    gsap.killTweensOf(vals.current);
    vals.current[k] = v;
    apply();
  };

  // each beat walks the Bit to a state; the sliders stay live throughout
  useEffect(() => {
    const target = PRESETS[Math.min(2, beat)];
    gsap.killTweensOf(vals.current);
    gsap.to(vals.current, { ...target, duration: 1.4, ease: 'power3.inOut', onUpdate: apply });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, replayKey]);

  // the state word swaps physically
  useEffect(() => {
    const w = scope.current.querySelector('.s9-state');
    gsap.fromTo(w, { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'back.out(2)' });
  }, [state]);

  useBeats(scope, beat, replayKey, {
    init: (q) => {
      gsap.set(q('.s9-head .split-line'), { yPercent: 110 });
      gsap.set(q('.s9-field'), { clipPath: 'circle(0% at 50% 50%)' });
      gsap.set(q('.s9-slider, .s9-axis, .s9-region'), { opacity: 0, y: 16 });
      gsap.set(q('.s9-arcade li, .s9-note'), { opacity: 0, scale: 0.7 });
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.s9-field'), { clipPath: 'circle(75% at 50% 50%)', duration: 1.4, ease: 'expo.inOut' }, 0)
          .to(q('.s9-head .split-line'), { yPercent: 0, duration: 1, ease: 'expo.out', stagger: 0.1 }, 0.3)
          .to(q('.s9-axis, .s9-region'), { opacity: 1, y: 0, duration: 0.6, stagger: 0.06 }, 1.0)
          .to(q('.s9-slider'), { opacity: 1, y: 0, duration: 0.6, stagger: 0.1 }, 1.1),
      () => {},
      (tl, q) => tl.to(q('.s9-arcade li, .s9-note'), { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(2.5)', stagger: 0.18 }, 1.2),
    ],
  });

  const pts = [0.24, 0.42, 0.6, 0.78];
  return (
    <div ref={scope} className="scene s9">
      <h2 className="s9-head">
        <span className="mask-line"><span className="split-line t-display">{C.headline[0]}</span></span>
        <span className="mask-line"><span className="split-line t-quote">{C.headline[1]}</span></span>
        <span className="mask-line gap"><span className="split-line t-display">{C.headline[2]}</span></span>
        <span className="mask-line"><span className="split-line t-quote">{C.headline[3]}</span></span>
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

      <div className="s9-field" style={{ left: FX, top: FY, width: SIZE, height: SIZE }}>
        <div ref={host} className="s9-canvas" />
      </div>
      <span className="s9-axis s9-axis-y t-mono" style={{ left: FX - 46, top: FY + SIZE / 2 }}>
        {C.challenge} →
      </span>
      <span className="s9-axis s9-axis-x t-mono" style={{ left: FX + SIZE / 2, top: FY + SIZE + 18 }}>
        {C.skill} →
      </span>
      <span className="s9-region t-mono" style={{ left: FX + 34, top: FY + 30, color: COLORS.frustration }}>
        {C.states.frustration}
      </span>
      <span className="s9-region t-mono" style={{ left: FX + SIZE - 34, top: FY + SIZE - 56, color: '#b9c6e2', transform: 'translateX(-100%)' }}>
        {C.states.boredom}
      </span>

      <ul className="s9-arcade">
        {C.arcade.map((g, i) => (
          <li key={g} style={{ left: FX + pts[i] * SIZE, top: FY + (1 - pts[i]) * SIZE }}>
            <i />
            <span className="t-mono">{g}</span>
          </li>
        ))}
      </ul>
      <span className="s9-note t-quote" style={{ left: FX + SIZE - 40 - 500, top: FY + SIZE - 132 }}>
        {C.arcadeNote}
      </span>

      <div ref={bit} className="bit s9-bit" style={{ width: 52, height: 52, margin: '-26px 0 0 -26px' }} />
    </div>
  );
}
