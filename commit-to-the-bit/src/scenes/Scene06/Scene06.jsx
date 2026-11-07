import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { scene06 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { pluck, note, thump, miss, chord } from '../../systems/audio/sound.js';
import { createWorld } from './world.js';
import './scene06.css';

/* An open world, seen from high above. The Bit roams wherever it likes —
   possibility. Then the presenter adds limits, one at a time, and each one
   physically reshapes the world until it becomes a game. */

export default function Scene06({ beat, replayKey }) {
  const scope = useRef(null);
  const host = useRef(null);
  const world = useRef(null);
  const [on, setOn] = useState({});
  const hud = useRef(null);
  const fog = useRef(null);
  const beatRef = useRef(beat);
  beatRef.current = beat;

  useEffect(() => {
    const W = createWorld(host.current, {
      onEvent: (e) => {
        if (e.type === 'goal') chord([4, 7, 9], 262, { vol: 0.12, spread: 0.05 });
        else if (e.type === 'hit') miss();
        else if (e.type === 'fuel') pluck(note(8, 220), { vol: 0.12 });
        else if (e.type === 'timeup') thump({ freq: 80, vol: 0.3 });
      },
    });
    world.current = W;
    let raf;
    const tick = () => {
      // a quiet HUD only for the limits that are actually on
      const S = W.state;
      const parts = [];
      if (W.on.time) parts.push(`<span class="${S.clock < 5 ? 'warn' : ''}">0:${String(Math.ceil(S.clock)).padStart(2, '0')}</span>`);
      if (W.on.goal) parts.push(`<span>◆ ${S.score}</span>`);
      if (W.on.lives) parts.push(`<span class="hearts">${'●'.repeat(S.hearts)}<i>${'●'.repeat(3 - S.hearts)}</i></span>`);
      if (W.on.resources) parts.push(`<span class="${S.energy < 0.3 ? 'warn' : ''}">⚡ ${Math.round(S.energy * 100)}%</span>`);
      const html = parts.join('');
      if (fog.current) {
        const p = W.screen();
        fog.current.style.setProperty('--fx', `${p.x}px`);
        fog.current.style.setProperty('--fy', `${p.y}px`);
      }
      if (hud.current && hud.current.innerHTML !== html) hud.current.innerHTML = html;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      W.dispose();
    };
  }, []);

  const toggle = (key) => {
    if (beatRef.current < 1) return;
    const v = !world.current.on[key];
    world.current.set(key, v);
    pluck(note(v ? 6 : 2, 220), { vol: 0.14, decay: 0.5 });
    setOn((o) => ({ ...o, [key]: v }));
  };
  const clear = () => {
    world.current.clear();
    setOn({});
    thump({ freq: 90, vol: 0.2 });
  };

  useEffect(() => {
    const onKey = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= C.constraints.length) toggle(C.constraints[n - 1].key);
      else if (e.key === '0' || e.key.toLowerCase() === 'x') clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // going back to the open world clears every limit
  useEffect(() => {
    if (beat === 0 && world.current) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat]);

  useBeats(scope, beat, replayKey, {
    init: (q) => {
      gsap.set(q('.s6-open .split-unit .split-unit'), { yPercent: 110 });
      gsap.set(q('.s6-head .split-line'), { yPercent: 110, opacity: 0 });
      gsap.set(q('.s6-support, .s6-chip, .s6-clear'), { opacity: 0, y: 20 });
      gsap.set(q('.s6-shade'), { opacity: 0 });
    },
    beats: [
      (tl, q) => tl.to(q('.s6-open .split-unit .split-unit'), { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.04 }, 0.4),
      (tl, q) =>
        tl
          .to(q('.s6-open .split-unit .split-unit'), { yPercent: -110, duration: 0.5, ease: 'power3.in', stagger: 0.02 }, 0)
          .to(q('.s6-open'), { opacity: 0, duration: 0.3 }, 0.4)
          .to(q('.s6-shade'), { opacity: 1, duration: 0.8 }, 0)
          .to(q('.s6-head .split-line'), { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.12 }, 0.35)
          .to(q('.s6-support'), { opacity: 1, y: 0, duration: 0.8 }, 0.8)
          .to(q('.s6-chip, .s6-clear'), { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(2)', stagger: 0.04 }, 1.0),
    ],
  });

  return (
    <div ref={scope} className="scene s6">
      <div ref={host} className="layer s6-world" />
      <div ref={fog} className={`layer s6-fog ${on.info ? 'on' : ''}`} />
      <div className="layer s6-shade" />

      <h2 className="t-display s6-open">
        {C.open.split('').map((ch, i) => (
          <span key={i} className="mask-word split-unit">
            <span className="split-unit">{ch}</span>
          </span>
        ))}
      </h2>

      <h2 className="s6-head t-display">
        <span className="mask-line"><span className="split-line">{C.headline[0]}</span></span>
        <span className="mask-line"><span className="split-line accent">{C.headline[1]}</span></span>
      </h2>
      <p className="s6-support">{C.support}</p>

      <div className="s6-hud t-mono" ref={hud} />

      <div className="s6-chips">
        {C.constraints.map((c, i) => (
          <button key={c.key} className={`s6-chip ${on[c.key] ? 'on' : ''}`} onClick={(e) => (e.currentTarget.blur(), toggle(c.key))}>
            <span className="k">{i + 1}</span>
            {c.label}
          </button>
        ))}
        <button className="s6-clear" onClick={(e) => (e.currentTarget.blur(), clear())}>
          {C.clear} <span className="k">0</span>
        </button>
      </div>
    </div>
  );
}
