// The autopilot used by the browser scripts: the same route and steam timing
// as dev/test_move.js, installed into the page as window.__pilot(cat, hazards).
module.exports = `(() => {
  const toward = (c, x) => Math.max(-1, Math.min(1, (x - c.pos[0]) * 2.5));
  const steam = (c, hz) => {
    for (const v of hz.vents) {
      const d = c.pos[2] - v.z - 0.7; if (d < 0 || d > 2.4) continue;
      const a = TUNING_A(), dist = d + 1.4, v0 = c.fwd, cross = (-v0 + Math.sqrt(v0 * v0 + 2 * a * dist)) / a + 0.2;
      for (let t = 0; t <= cross; t += 0.05) if (hz.ventAt(v, hz.time + t).state !== 'idle') return -1;
    }
    return 0;
  };
  const TUNING_A = () => { const T = window.__rr.TUNING.cat; return T.accel * (1 + T.startBoost); };
  window.__pilot = (c, hz) => {
    const z = c.pos[2];
    const x = z > -9 ? 0 : z > -13.5 ? 0.2 : z > -19 ? 0.2 : z > -21.6 ? -0.45 : z > -23 ? -0.75 : z > -32.4 ? 0.2 : z > -46.3 ? -1.2 : z > -63 ? -0.15 : 0;
    const jump = (z < -12.85 && z > -13.25) || (z < -25.55 && z > -25.95) || (z < -58.6 && z > -58.9) || (z < -67.4 && z > -67.9);
    return { steer: toward(c, x), jump, pace: steam(c, hz) };
  };
})();`;
