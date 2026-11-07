import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { toStage } from '../stage/Stage.jsx';

/* ---------- Paint grain: one generated texture, reused everywhere ---------- */
let grainURL = null;
function makeGrain() {
  if (grainURL) return grainURL;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const img = x.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    // clustered noise reads as pigment rather than digital static
    const v = 128 + (Math.random() - 0.5) * 120 + (Math.random() < 0.02 ? 60 : 0);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  grainURL = c.toDataURL();
  return grainURL;
}

export function Grain({ opacity }) {
  return <div className="grain" style={{ backgroundImage: `url(${makeGrain()})`, opacity }} />;
}

export function Vignette({ strength = 0.55 }) {
  return (
    <div
      className="vignette"
      style={{ background: `radial-gradient(ellipse 78% 72% at 50% 48%, transparent 52%, rgba(2,8,12,${strength}) 100%)` }}
    />
  );
}

/* ---------- Ambient sway for every .sway inside a scope ---------- */
export function swayAll(nodes, { amp = 2.2, dur = 4.5 } = {}) {
  nodes.forEach((el, i) => {
    const a = amp * (0.6 + ((i * 37) % 10) / 12);
    gsap.fromTo(
      el,
      { rotation: -a * 0.5 },
      {
        rotation: a * 0.5,
        duration: dur * (0.75 + ((i * 53) % 10) / 18),
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        transformOrigin: '50% 100%',
        delay: -((i * 0.7) % dur),
      },
    );
  });
}

/* ---------- Pointer parallax: any [data-depth] element drifts ---------- */
export function useParallax(scopeRef, { strength = 26, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return;
    const els = [...scopeRef.current.querySelectorAll('[data-depth]')];
    const setters = els.map((el) => ({
      d: parseFloat(el.dataset.depth),
      x: gsap.quickTo(el, 'x', { duration: 1.6, ease: 'power3.out' }),
      y: gsap.quickTo(el, 'y', { duration: 1.6, ease: 'power3.out' }),
    }));
    const onMove = (e) => {
      const p = toStage(e);
      const nx = p.x / 1920 - 0.5;
      const ny = p.y / 1080 - 0.5;
      setters.forEach((s) => {
        s.x(-nx * strength * s.d);
        s.y(-ny * strength * 0.6 * s.d);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [scopeRef, strength, enabled]);
}
