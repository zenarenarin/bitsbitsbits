import { useRef } from 'react';
import gsap from 'gsap';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { FoliageDefs, Plants } from '../../systems/environment/foliage.jsx';
import { Vignette } from '../../systems/environment/atmosphere.jsx';

/* Chapter card for screens still in production. Lets the full running order
   be rehearsed while Phases 3–5 are built. Clearly labelled, never mistaken
   for a finished slide. */
const EDGE = [
  { kind: 'blade', x: 60, y: 1100, r: 20, h: 700, w: 110, bend: 0.3, fill: 'deep' },
  { kind: 'paddle', x: 200, y: 1120, s: 1.2, r: 30, h: 460, w: 180, stripes: 6, fill: 'forest', stripe: '#03201a' },
  { kind: 'blade', x: 1880, y: 1100, r: -20, h: 700, w: 110, bend: -0.3, fill: 'deep' },
  { kind: 'paddle', x: 1720, y: 1120, s: 1.2, r: -30, h: 460, w: 180, stripes: 6, fill: 'forest', stripe: '#03201a', flip: true },
];

export default function Stub({ beat, replayKey, index, title, phase }) {
  const scope = useRef(null);
  useBeats(scope, beat, replayKey, {
    init: (q) => {
      gsap.set(q('.stub-i, .stub-t, .stub-p'), { opacity: 0, y: 30 });
      gsap.set(q('.plant'), { scale: 0, transformOrigin: '50% 100%' });
    },
    beats: [
      (tl, q) =>
        tl
          .to(q('.plant'), { scale: 1, duration: 1, ease: 'back.out(1.5)', stagger: 0.06 }, 0)
          .to(q('.stub-i, .stub-t, .stub-p'), { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.1 }, 0.1),
    ],
  });
  return (
    <div ref={scope} className="scene" style={{ background: 'radial-gradient(ellipse at 50% 40%, #0c3a44, #041820 70%)' }}>
      <svg className="fill" viewBox="0 0 1920 1080">
        <FoliageDefs prefix="st" />
        <Plants list={EDGE} p="st" />
      </svg>
      <div style={{ position: 'absolute', left: 300, right: 300, top: 360, textAlign: 'center' }}>
        <div className="t-mono stub-i" style={{ color: '#ffc94a', fontSize: 22 }}>{index}</div>
        <h2 className="t-head stub-t" style={{ fontSize: 150, margin: '26px 0 34px', color: '#f5ead3' }}>{title}</h2>
        <div className="t-mono stub-p" style={{ color: 'rgba(245,234,211,.55)' }}>In production · {phase}</div>
      </div>
      <Vignette />
    </div>
  );
}
