import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Stage } from './systems/stage/Stage.jsx';
import { TransitionLayer } from './systems/transitions/TransitionLayer.jsx';
import { Grain } from './systems/environment/atmosphere.jsx';
import { Progress, Toast, Help } from './components/Chrome.jsx';
import { SCENES } from './scenes/index.js';
import { setMuted, isMuted, unlockAudio, pluck, note } from './systems/audio/sound.js';
import { detectLite } from './systems/stage/perf.js';

const initialFromHash = () => {
  const id = decodeURIComponent(location.hash.replace('#', '').split('.')[0] || '');
  const i = SCENES.findIndex((s) => s.id === id);
  const b = parseInt(location.hash.split('.')[1] || '0', 10) || 0;
  return i >= 0 ? { i, b: Math.min(b, SCENES[i].beats - 1) } : { i: 0, b: 0 };
};

export default function App() {
  const start = useRef(initialFromHash()).current;
  const [index, setIndex] = useState(start.i);
  const [beat, setBeat] = useState(start.b);
  const [replayKey, setReplayKey] = useState(0);
  const [dir, setDir] = useState(1);
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  const [lite, setLite] = useState(() => detectLite());
  const [muted, setMutedState] = useState(isMuted());

  const busy = useRef(false);
  const tr = useRef(null);
  const host = useRef(null);
  const state = useRef({ index, beat });
  state.current = { index, beat };

  useEffect(() => {
    history.replaceState(null, '', `#${SCENES[index].id}.${beat}`);
  }, [index, beat]);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(flash.t);
    flash.t = setTimeout(() => setToast(''), 1400);
  }, []);

  const goScene = useCallback(async (target, direction, landBeat = 0) => {
    if (busy.current || target < 0 || target >= SCENES.length) return;
    busy.current = true;
    const from = SCENES[state.current.index];
    const to = SCENES[target];
    // forward: use the destination's entrance; backward: replay the one we came through, mirrored
    const t = (direction > 0 ? to.enter : from.enter) || { type: 'iris' };
    const color = to.bg;
    if (t.zoom && direction > 0) {
      gsap.to(host.current, { scale: 2.6, transformOrigin: `${(t.origin || [960, 600]).join('px ')}px`, duration: 0.95, ease: 'power3.in' });
    }
    await tr.current.run({
      ...t,
      dir: direction,
      color,
      origin: t.origin || (t.zoom ? [960, 600] : [960, 540]),
      onCovered: () => {
        gsap.set(host.current, { clearProps: 'transform' });
        setDir(direction);
        setIndex(target);
        setBeat(landBeat);
      },
    });
    busy.current = false;
  }, []);

  const next = useCallback(() => {
    const { index: i, beat: b } = state.current;
    if (busy.current) return;
    if (b < SCENES[i].beats - 1) {
      setDir(1);
      setBeat(b + 1);
    } else goScene(i + 1, 1, 0);
  }, [goScene]);

  const prev = useCallback(() => {
    const { index: i, beat: b } = state.current;
    if (busy.current) return;
    if (b > 0) {
      setDir(-1);
      setBeat(b - 1);
    } else if (i > 0) goScene(i - 1, -1, SCENES[i - 1].beats - 1);
  }, [goScene]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      unlockAudio();
      const k = e.key;
      if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') {
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        next();
      } else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') {
        e.preventDefault();
        prev();
      } else if (k === 'r' || k === 'R') {
        setReplayKey((x) => x + 1);
        flash('Replay');
      } else if (k === 'f' || k === 'F') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      } else if (k === 'm' || k === 'M') {
        const m = !isMuted();
        setMuted(m);
        setMutedState(m);
        flash(m ? 'Sound off' : 'Sound on');
      } else if (k === 'Home') {
        e.preventDefault();
        goScene(0, -1, 0);
      } else if (k === 'l' || k === 'L') {
        setLite((v) => {
          flash(!v ? 'Lite mode on' : 'Full quality');
          return !v;
        });
      } else if (k === '?' || k === 'h' || k === 'H') {
        setHelp((v) => !v);
      } else if (k === 'Escape') {
        setHelp(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const onDown = () => unlockAudio();
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [next, prev, goScene, flash]);

  // Hide the cursor when the presenter isn't using it.
  useEffect(() => {
    let t;
    const wake = () => {
      document.body.classList.remove('hide-cursor');
      clearTimeout(t);
      t = setTimeout(() => document.body.classList.add('hide-cursor'), 2600);
    };
    window.addEventListener('pointermove', wake);
    wake();
    return () => window.removeEventListener('pointermove', wake);
  }, []);

  const S = SCENES[index];
  const { Component } = S;

  return (
    <Stage className={lite ? 'lite' : ''}>
      <div ref={host} className="scene-host">
        <Component
          key={S.id}
          beat={beat}
          replayKey={replayKey}
          dir={dir}
          lite={lite}
          next={next}
          onChime={() => pluck(note(7, 220))}
          {...(S.props || {})}
        />
      </div>
      <Grain />
      <TransitionLayer ref={tr} />
      <Progress scenes={SCENES} index={index} beat={beat} light={S.light} />
      <Toast msg={toast} />
      {help && <Help onClose={() => setHelp(false)} muted={muted} lite={lite} />}
    </Stage>
  );
}
