// Scripted solution runner: drives the real simulation with steering input.
module.exports = function runBot(api, def, steps, opts) {
  opts = opts || {};
  const W = api.createWorld(def, { checkpoint: opts.checkpoint || 0, mods: opts.mods });
  const log = [];
  let i = 0, stepT = 0, maxT = opts.maxT || 150;
  const cur = () => steps[i];
  while (W.t < maxT && W.status === 'play') {
    const s = cur();
    W.input.mx = 0; W.input.mz = 0;
    if (s) {
      stepT += api.SIM_DT;
      let done = false;
      if (s.go) {
        const p = W.player.pos, dx = s.go[0] - p[0], dz = s.go[1] - p[2], d = Math.hypot(dx, dz);
        const sp = s.speed || 1;
        if (d < (s.tol || 0.35)) done = true; else { W.input.mx = dx / d * sp; W.input.mz = dz / d * sp; }
        if (s.max && stepT > s.max) done = true;
      } else if (s.gaze !== undefined) { api.setGaze(W, s.gaze); done = true; }
      else if (s.wait !== undefined) { done = stepT >= s.wait; }
      else if (s.until) { done = s.until(W); if (!done && stepT > (s.max || 20)) { log.push('timeout at step ' + i + (s.label ? ' ' + s.label : '')); return { W, ok: false, log, step: i }; } }
      else if (s.do) { s.do(W); done = true; }
      else if (s.ctl) { const r = s.ctl(W, stepT); if (r === 'done') done = true; else if (r) { W.input.mx = r[0]; W.input.mz = r[1]; } if (!done && stepT > (s.max || 60)) { log.push('ctl timeout at step ' + i); return { W, ok: false, log, step: i }; } }
      if (s.hold && s.go === undefined) {}
      if (done) { if (opts.trace) log.push(`[${W.t.toFixed(2)}] step ${i} done ${JSON.stringify(s.go || s.gaze || s.wait || s.label || '')}`); i++; stepT = 0; }
    }
    api.stepWorld(W, api.SIM_DT);
    for (const e of W.events) if (opts.trace && e.type !== 'gaze') log.push(`[${W.t.toFixed(2)}] ${e.type} ${e.id || ''}${e.a ? e.a + '>' + e.b : ''}`);
    W.events.length = 0;
  }
  // let any final status settle
  return { W, ok: W.status === 'won', log, step: i };
};
