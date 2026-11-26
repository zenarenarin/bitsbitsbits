/*
 * timeline.js — one page, no transitions. Only the river moves.
 * The text, the architecture and the couple are still for the whole piece.
 */
window.TIMELINE = {
  fps: 30,
  duration: 36,
  still: 0,            // the moment used for the static version
  river: {
    current: [4, 18],   // drift of the surface, px/s, far → near
    ripple: [0.4, 5.5], // reflection displacement, px, at the far bank → near us
  },
  boat: { drift: 7, period: 36 }, // px either way over one loop
};
