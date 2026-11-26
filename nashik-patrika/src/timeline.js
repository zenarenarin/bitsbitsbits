/*
 * timeline.js — all timing in one place (seconds).
 *
 * The text never animates. Page 1 is readable from the first frame; page 2
 * is revealed only by the pier passing in front of it.
 */
window.TIMELINE = {
  fps: 30,
  duration: 40,
  // the morning haze over the river lifts; nothing else enters
  mist: { from: 0, to: 3.4, amount: 0.42 },
  // the walk along the ghat: 1.3 m in 7 s, minimum-jerk profile
  move: { from: 15.0, to: 22.0 },
  // light on stone and water warms very slightly over the whole piece
  warm: { from: 0, to: 40, amount: 0.07 },
  // stills: the moments used for the static versions
  stills: { page1: 11, page2: 34 },
};

(function () {
  const T = window.TIMELINE;
  // minimum-jerk: zero velocity and acceleration at both ends, no overshoot
  const mj = (x) => x * x * x * (10 - 15 * x + 6 * x * x);
  T.progress = function (t) {
    const m = T.move;
    const x = Math.max(0, Math.min(1, (t - m.from) / (m.to - m.from)));
    return mj(x);
  };
  // derivative of progress with respect to time (per second)
  T.velocity = function (t) {
    const m = T.move, d = m.to - m.from;
    const x = (t - m.from) / d;
    if (x <= 0 || x >= 1) return 0;
    return (30 * x * x * (1 - x) * (1 - x)) / d;
  };
  T.mistAlpha = function (t) {
    const m = T.mist;
    const x = Math.max(0, Math.min(1, (t - m.from) / (m.to - m.from)));
    return m.amount * (1 - x * x * (3 - 2 * x));
  };
})();
