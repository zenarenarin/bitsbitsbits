import { useRef } from 'react';
import gsap from 'gsap';
import { scene08 as C } from '../../content/deck.js';
import { useBeats } from '../../systems/navigation/useBeats.js';
import { VideoSlot } from '../../systems/video/VideoSlot.jsx';
import { pluck, note, whoosh } from '../../systems/audio/sound.js';
import './scene08.css';

/* Four games, one at a time. The overview lays the four windows out like
   specimens; each beat pulls one forward into its own colour world while its
   recipe is read out ingredient by ingredient, colour-coded with the grammar
   from slide 05. Only the game in focus plays. */

const CAT = { action: '#ff6a55', world: '#34d6c2', limit: '#ffc94a', goal: '#a77cf2' };
const WASH = ['#0b3d48', '#3b2414', '#191552', '#4a1038'];

// overview: four specimen windows of different sizes on a shared baseline
const OVERVIEW = [
  { x: 110, h: 470 },
  { x: 400, h: 370 },
  { x: 645, h: 520 },
  { x: 1070, h: 420 },
].map((o, i) => ({ ...o, y: 990 - o.h, w: o.h * C.games[i].aspect }));

// focus: the video takes one side, alternating left and right
const focusBox = (i) => {
  const g = C.games[i];
  const h = 880;
  const w = h * g.aspect;
  const left = i % 2 === 0;
  return { x: left ? 150 : 1600 - w, y: 100, w, h, left };
};

export default function Scene08({ beat, replayKey }) {
  const scope = useRef(null);
  const focus = beat - 1; // -1 = overview

  useBeats(scope, beat, replayKey, {
    init: (q) => {
      q('.s8-win').forEach((w, i) => {
        const o = OVERVIEW[i];
        gsap.set(w, { left: o.x, top: o.y, width: o.w, height: o.h, opacity: 0, y: 60 });
      });
      gsap.set(q('.s8-head .split-line'), { yPercent: 110 });
      gsap.set(q('.s8-name'), { opacity: 0, y: 12 });
      gsap.set(q('.s8-legend li'), { opacity: 0, x: 30 });
      gsap.set(q('.s8-focus'), { autoAlpha: 0 });
      gsap.set(q('.s8-wash'), { backgroundColor: '#120c22' });
    },
    beats: [
      // overview
      (tl, q) =>
        tl
          .to(q('.s8-head .split-line'), { yPercent: 0, duration: 1, ease: 'expo.out', stagger: 0.12 }, 0)
          .to(q('.s8-win'), { opacity: 1, y: 0, duration: 0.9, ease: 'back.out(1.4)', stagger: 0.1 }, 0.3)
          .to(q('.s8-name'), { opacity: 1, y: 0, duration: 0.6, stagger: 0.1 }, 0.7)
          .to(q('.s8-legend li'), { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out', stagger: 0.08 }, 1.0),
      ...C.games.map((_, gi) => (tl, q, { instant }) => {
        const F = focusBox(gi);
        const wins = q('.s8-win');
        tl.to(q('.s8-head, .s8-legend, .s8-name'), { autoAlpha: 0, duration: 0.4 }, 0)
          .to(q('.s8-wash'), { backgroundColor: WASH[gi], duration: 0.9, ease: 'power2.inOut' }, 0)
          .to(q('.s8-focus'), { autoAlpha: 0, duration: 0.3 }, 0);
        wins.forEach((w, i) => {
          if (i === gi) tl.to(w, { left: F.x, top: F.y, width: F.w, height: F.h, opacity: 1, duration: 1, ease: 'expo.inOut' }, 0.1);
          else {
            // the others step back into a quiet strip at the far edge
            const slot = [0, 1, 2, 3].filter((k) => k !== gi).indexOf(i);
            const sh = 150;
            const sw = sh * C.games[i].aspect;
            const sx = 1810 - sw;
            tl.to(w, { left: sx, top: 120 + slot * (sh + 22), width: sw, height: sh, opacity: 0.35, duration: 0.9, ease: 'expo.inOut' }, 0.1);
          }
        });
        const panel = q(`.s8-focus-${gi}`);
        tl.set(panel, { autoAlpha: 1 }, 0.55)
          .fromTo(q(`.s8-focus-${gi} .s8-title .split-line`), { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: 'expo.out' }, 0.6);
        q(`.s8-focus-${gi} .s8-ing`).forEach((row, k) => {
          tl.fromTo(row, { opacity: 0, x: F.left ? 40 : -40 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' }, 1.1 + k * 0.45);
          if (!instant) tl.call(() => pluck(note(3 + k * 2, 220), { vol: 0.13, decay: 0.5 }), null, 1.1 + k * 0.45);
        });
        if (!instant) tl.call(() => whoosh({ dur: 0.8, from: 300, to: 1800, vol: 0.1 }), null, 0.1);
      }),
    ],
  });

  return (
    <div ref={scope} className="scene s8">
      <div className="layer s8-wash" />

      <h2 className="s8-head t-display">
        <span className="mask-line"><span className="split-line">{C.headline[0]}</span></span>
        <span className="mask-line"><span className="split-line accent">{C.headline[1]}</span></span>
      </h2>

      <ul className="s8-legend">
        {Object.entries(CAT).map(([k, c]) => (
          <li key={k}>
            <i style={{ background: c }} />
            <span className="t-display">{C.legend[k]}</span>
          </li>
        ))}
      </ul>

      {C.games.map((g, i) => (
        <div key={g.id} className={`s8-win ${focus >= 0 && focus !== i ? 'is-rail' : ''}`}>
          <VideoSlot name={g.id} playing={focus === i} label={C.placeholder} compact={focus !== i} />
          <span className="s8-name t-mono">{g.title}</span>
        </div>
      ))}

      {C.games.map((g, i) => {
        const F = focusBox(i);
        const textLeft = F.left ? F.x + F.w + 100 : 150;
        return (
          <div key={g.id} className={`s8-focus s8-focus-${i} ${F.left ? 'is-left' : 'is-right'}`} style={{ left: textLeft, width: F.left ? 1560 - textLeft : F.x - 250 }}>
            <h3 className="s8-title t-display">
              <span className="mask-line"><span className="split-line">{g.title}</span></span>
            </h3>
            <ol className="s8-recipe">
              {g.recipe.map(([word, cat], k) => (
                <li key={k} className="s8-ing">
                  <span className="t-display w" style={{ color: CAT[cat] }}>{word}</span>
                  <span className="t-mono c">{C.legend[cat]}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
