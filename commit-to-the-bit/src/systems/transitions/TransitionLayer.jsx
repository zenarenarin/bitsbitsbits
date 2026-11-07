import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { FoliageDefs, Plant } from '../environment/foliage.jsx';
import { whoosh } from '../audio/sound.js';

/**
 * Transition vocabulary. Each transition covers the stage, the host swaps
 * scenes under cover (onCovered), then the cover reveals the new scene.
 *
 *   iris    — a shape/light point opens into the next world (optional zoom-through)
 *   foliage — layered leaves sweep across like walking through undergrowth
 *   slit    — a line draws across, the frame closes on it and reopens
 */
const R_MAX = 2300;

export const TransitionLayer = forwardRef(function TransitionLayer(_, ref) {
  const root = useRef(null);
  const iris = useRef(null);
  const irisRing = useRef(null);
  const hole = useRef(null);
  const leaves = useRef(null);
  const slit = useRef(null);

  // park the leaf bands off-stage so they never sit over another transition
  useLayoutEffect(() => {
    gsap.set(leaves.current.querySelectorAll('.ft-band'), { x: -3200 });
  }, []);

  useImperativeHandle(ref, () => ({
    run({ type = 'iris', dir = 1, origin = [960, 540], color = '#061d26', accent = '#ff6a55', onCovered }) {
      return new Promise((resolve) => {
        const tl = gsap.timeline({ onComplete: resolve });
        root.current.style.visibility = 'visible';
        if (type === 'iris') {
          const [ox, oy] = origin;
          const c = iris.current;
          gsap.set(c, { attr: { cx: ox, cy: oy, r: 0 }, fill: color });
          gsap.set(irisRing.current, { attr: { cx: ox, cy: oy, r: 0 }, stroke: accent, opacity: 1 });
          whoosh({ dur: 0.9, from: 200, to: 1800 });
          tl.to(irisRing.current, { attr: { r: R_MAX }, duration: 0.85, ease: 'power3.in' }, 0)
            .to(c, { attr: { r: R_MAX }, duration: 0.8, ease: 'power3.in' }, 0.08)
            .add(() => onCovered && onCovered())
            .set(c, { attr: { r: 0 } })
            .set(irisRing.current, { opacity: 0 })
            .set(hole.current, { fill: color, attr: { d: holePath(ox, oy, 0) } })
            .to(hole.current, { duration: 0.9, ease: 'power3.out', onUpdate() {
              hole.current.setAttribute('d', holePath(ox, oy, this.progress() * R_MAX));
            } }, '+=0.06')
            .set(hole.current, { attr: { d: '' } });
        } else if (type === 'foliage') {
          const bands = leaves.current.querySelectorAll('.ft-band');
          gsap.set(leaves.current, { scaleX: dir, transformOrigin: '960px 540px' });
          gsap.set(bands, { x: -3200 });
          whoosh({ dur: 1.4, from: 400, to: 3200, vol: 0.22 });
          tl.to(bands, { x: -240, duration: 0.7, ease: 'power3.in', stagger: 0.09 })
            .add(() => onCovered && onCovered())
            .to(bands, { x: 2700, duration: 0.95, ease: 'power3.out', stagger: 0.1 }, '+=0.08')
            .set(bands, { x: -3200 });
        } else if (type === 'slit') {
          const [top, bot, line] = slit.current.children;
          gsap.set([top, bot], { fill: color });
          gsap.set(top, { attr: { y: -560 } });
          gsap.set(bot, { attr: { y: 1080 } });
          gsap.set(line, { stroke: accent, attr: { x1: 960, x2: 960 }, opacity: 1 });
          whoosh({ dur: 0.9, from: 600, to: 2600, vol: 0.14 });
          tl.to(line, { attr: { x1: -20, x2: 1940 }, duration: 0.45, ease: 'power2.inOut' })
            .to(top, { attr: { y: -20 }, duration: 0.5, ease: 'power3.in' }, 0.2)
            .to(bot, { attr: { y: 540 }, duration: 0.5, ease: 'power3.in' }, 0.2)
            .add(() => onCovered && onCovered())
            .to(top, { attr: { y: -560 }, duration: 0.8, ease: 'expo.out' }, '+=0.08')
            .to(bot, { attr: { y: 1080 }, duration: 0.8, ease: 'expo.out' }, '<')
            .to(line, { attr: { x1: 960, x2: 960 }, opacity: 0, duration: 0.6, ease: 'power2.in' }, '<0.15');
        } else {
          onCovered && onCovered();
          tl.to({}, { duration: 0.01 });
        }
        tl.add(() => (root.current.style.visibility = 'hidden'));
      });
    },
  }));

  return (
    <div ref={root} className="layer" style={{ zIndex: 70, visibility: 'hidden' }}>
      <svg className="fill" viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <FoliageDefs prefix="tr" />
        <circle ref={irisRing} r="0" fill="none" strokeWidth="10" />
        <circle ref={iris} r="0" />
        <path ref={hole} fillRule="evenodd" d="" />
        <g ref={slit}>
          <rect x="-20" y="-560" width="1960" height="560" />
          <rect x="-20" y="1080" width="1960" height="560" />
          <line x1="960" x2="960" y1="540" y2="540" strokeWidth="6" strokeLinecap="round" opacity="0" />
        </g>
        <g ref={leaves}>
          <LeafBand fill="#0a3a3a" lead="teal" seed={1} />
          <LeafBand fill="#07302a" lead="jade" seed={2} />
          <LeafBand fill="#041a1c" lead="forest" seed={3} />
        </g>
      </svg>
    </div>
  );
});

function holePath(x, y, r) {
  return `M-10,-10H1930V1090H-10Z M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0Z`;
}

// A 2400px-wide band whose leading and trailing edges are made of leaves.
function LeafBand({ fill, lead, seed }) {
  const edge = [];
  for (let i = 0; i < 9; i++) {
    const y = -60 + i * 150 + ((seed * 37 + i * 53) % 60);
    const kind = (i + seed) % 3 === 0 ? 'paddle' : (i + seed) % 3 === 1 ? 'blade' : 'frond';
    const len = 380 + ((i * 71 + seed * 13) % 220);
    edge.push(
      <Plant key={'l' + i} p="tr" kind={kind} x={2380} y={y} r={90 + ((i * 29) % 40) - 20} h={len} w={kind === 'paddle' ? 170 : 110} n={10} leaf={58} stripes={kind === 'paddle' ? 5 : 0} fill={lead} rib={false} />,
      <Plant key={'t' + i} p="tr" kind={kind === 'frond' ? 'blade' : kind} x={20} y={y + 70} r={-90 + ((i * 31) % 40) - 20} h={len * 0.8} w={120} fill={fill} rib={false} />,
    );
  }
  return (
    <g className="ft-band">
      <rect x="0" y="-200" width="2400" height="1480" fill={fill} />
      {edge}
    </g>
  );
}
