// Route pilots shared by the headless tests and the browser tools: what a
// player would do on each line through the slice. pilot(route)(cat, hazards,
// TUNING) -> { steer, pace, jump }.
function routes() {
  const toward = (c, x) => Math.max(-1, Math.min(1, (x - c.pos[0]) * 2.5));
  // a player times a vent: hold back while it hisses or bursts; go only when it
  // will stay idle for the whole crossing at the cat's real acceleration
  const steam = (c, hz, T) => {
    for (const v of hz.vents) {
      const d = c.pos[2] - v.z - 0.7; if (d < 0 || d > 2.4) continue;
      const a = T.cat.accel * (1 + T.cat.startBoost), dist = d + 1.4, v0 = c.fwd, cross = (-v0 + Math.sqrt(v0 * v0 + 2 * a * dist)) / a + 0.2;
      for (let t = 0; t <= cross; t += 0.05) if (hz.ventAt(v, hz.time + t).state !== 'idle') return -1;
    }
    return 0;
  };
  const act1 = z => z > -9 ? 0 : z > -19 ? 0.2 : z > -21.6 ? -0.45 : z > -23 ? -0.75 : 0.2;
  const tail = z => z > -61 ? -0.15 : z > -78.5 ? -0.15 : 0;
  const LINES = {
    high: z => z > -33.2 ? act1(z) : z > -46.6 ? -1.1 : z > -55.2 ? -1.25 : tail(z),
    centre: z => z > -33.2 ? act1(z) : z > -55 ? 0.2 : tail(z),
    low: z => z > -33.2 ? act1(z) : z > -55 ? 1.9 : tail(z)
  };
  const JUMPS = {
    common: [[-12.85, -13.25], [-25.55, -25.95], [-63.95, -64.35], [-73.9, -74.2], [-83.4, -83.9]],
    high: [[-53.3, -53.65]],
    low: [[-43.9, -44.3]]
  };
  return route => (c, hz, T) => {
    const z = c.pos[2];
    const jumps = JUMPS.common.concat(JUMPS[route] || []);
    return { steer: toward(c, LINES[route](z)), jump: jumps.some(([a, b]) => z < a && z > b), pace: route === 'centre' ? steam(c, hz, T) : 0 };
  };
}
if (typeof module !== 'undefined') module.exports = { routes, source: '(' + routes.toString() + ')' };
