import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * Drives a scene's staged animation beats.
 *
 *   useBeats(scopeRef, beat, replayKey, {
 *     init(q)        — set the hidden/initial state of every beat element
 *     beats: [ (tl, q) => { ...tweens for beat 0 }, (tl, q) => {...}, ... ]
 *     ambient(q)     — optional looping motion that runs for the whole scene
 *   })
 *
 * On every beat change the context is reverted, earlier beats are jumped to
 * their resting state, and only the current beat animates. That makes
 * Left-arrow, R (replay) and jumping around always land on a clean composition.
 */
export function useBeats(scopeRef, beat, replayKey, spec, deps = []) {
  const ambientCtx = useRef(null);

  useLayoutEffect(() => {
    if (!spec.ambient) return;
    ambientCtx.current = gsap.context(() => spec.ambient(q(scopeRef)), scopeRef);
    return () => ambientCtx.current && ambientCtx.current.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const sel = q(scopeRef);
      spec.init && spec.init(sel);
      const n = Math.min(beat, spec.beats.length - 1);
      for (let i = 0; i < n; i++) {
        const tl = gsap.timeline();
        spec.beats[i](tl, sel, { instant: true });
        tl.progress(1, true);
      }
      const tl = gsap.timeline({ delay: spec.delay ?? 0.05 });
      spec.beats[n](tl, sel, { instant: false });
    }, scopeRef);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, replayKey, ...deps]);
}

const q = (scopeRef) => (s) => gsap.utils.toArray(scopeRef.current.querySelectorAll(s));
