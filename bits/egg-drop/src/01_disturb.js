// External disturbance: a smoothly varying torque on the platform (the room
// breathing on it), small irregular nudges, and from the later phases on,
// stronger gusts announced a moment ahead. All of it is torque in N·m fed
// into the simulation; nothing here touches an angle.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// piecewise curve through (t, v) keys with smoothstep between them
function keyCurve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0), e = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}

const PHASES = [
  { at: 0, name: 'Learning' },
  { at: 10, name: 'Instability' },
  { at: 25, name: 'Pressure' },
  { at: 45, name: 'Survival' }
];

function phaseAt(t) {
  let p = 0;
  for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i].at) p = i;
  return p;
}

function createDisturbance(seed, strength) {
  const rnd = mulberry32(seed);
  const k = strength == null ? 1 : strength;
  // drift: three incommensurate slow waves with per-run phases, plus a
  // band-limited random walk that changes the drift's character over time
  const waves = [0, 1, 2].map(i => ({ f: [0.071, 0.113, 0.187][i] * (0.85 + rnd() * 0.3), ph: rnd() * Math.PI * 2, w: [1, 0.55, 0.3][i] }));
  let walk = 0, walkV = 0, phaseClock = 0;
  const nudges = [];   // { t0, dur, amp }
  let nextNudge = 3 + rnd() * 2;
  let gust = null;     // { warnAt, t0, dur, amp, dir }
  let nextGust = 34 + rnd() * 6;
  let gustCount = 0;
  const d = {
    torque: 0, drift: 0, nudge: 0, gustTorque: 0,
    warning: 0, warningDir: 0, gustActive: false, gustJustEnded: false, gustAmp: 0,
    phase: 0, events: []
  };

  // eggSide: -1/0/1, the side the egg currently endangers (|x| near an end).
  // Fairness: a nudge or gust never starts towards an egg already in danger.
  d.update = function (t, h, eggSide) {
    d.events.length = 0;
    d.gustJustEnded = false;
    d.phase = phaseAt(t);
    const ampDrift = keyCurve([[0, 0.28], [10, 0.8], [25, 1.7], [45, 2.5], [90, 3.0], [180, 3.4]], t) * k;
    const speed = keyCurve([[0, 0.55], [10, 0.8], [25, 1.15], [45, 1.45], [120, 1.7]], t);
    phaseClock += h * speed;
    let w = 0;
    for (const q of waves) w += q.w * Math.sin(phaseClock * q.f * Math.PI * 2 + q.ph);
    // random walk with a restoring pull, filtered so it can't jerk
    walkV += ((rnd() - 0.5) * 1.6 - walk * 0.35 - walkV * 0.9) * h * speed;
    walk += walkV * h * speed;
    const mixWalk = keyCurve([[0, 0.1], [25, 0.35], [45, 0.6]], t);
    d.drift = ampDrift * (w / 1.85 * (1 - mixWalk) + Math.max(-1.4, Math.min(1.4, walk)) * mixWalk);

    // irregular nudges: short raised-cosine pulses
    const nudgeRate = keyCurve([[0, 0], [10, 0], [12, 0.16], [25, 0.3], [45, 0.42], [120, 0.55]], t);
    const nudgeAmp = keyCurve([[10, 0.9], [25, 1.5], [45, 2.2], [120, 2.8]], t) * k;
    if (t >= nextNudge) {
      if (nudgeRate > 0) {
        let dir = rnd() < 0.5 ? -1 : 1;
        if (eggSide && dir === eggSide) dir = -dir;
        nudges.push({ t0: t, dur: 0.35 + rnd() * 0.45, amp: dir * nudgeAmp * (0.6 + rnd() * 0.5) });
        d.events.push('nudge');
        nextNudge = t + (0.6 + rnd() * 1.4) / Math.max(0.05, nudgeRate);
      } else nextNudge = t + 1;
    }
    d.nudge = 0;
    for (let i = nudges.length - 1; i >= 0; i--) {
      const n = nudges[i], u = (t - n.t0) / n.dur;
      if (u >= 1) { nudges.splice(i, 1); continue; }
      d.nudge += n.amp * 0.5 * (1 - Math.cos(u * Math.PI * 2));
    }

    // gusts: one taste in the pressure phase, then a regular part of survival
    d.warning = 0;
    if (!gust && t >= nextGust) {
      let dir = rnd() < 0.5 ? -1 : 1;
      if (eggSide && dir === eggSide) dir = -dir;
      const amp = (gustCount === 0 ? 3.6 : keyCurve([[45, 4.6], [90, 5.6], [180, 6.4]], t)) * k;
      gust = { warnAt: t, t0: t + 1.1, dur: 0.9 + rnd() * 0.5, amp, dir, armed: false };
      gustCount++;
      nextGust = t + (gustCount === 1 ? Math.max(12, 47 - t + rnd() * 3) : keyCurve([[45, 10], [90, 8], [180, 6.5]], t) + rnd() * 3);
      d.events.push('gustWarn');
    }
    d.gustTorque = 0;
    d.gustActive = false;
    if (gust) {
      if (t < gust.t0) {
        d.warning = (t - gust.warnAt) / (gust.t0 - gust.warnAt);
        d.warningDir = gust.dir;
      } else {
        if (!gust.armed) {
          gust.armed = true;
          // the cue already promised a direction; if the egg has since got
          // into trouble on that side, the gust lands softer instead
          if (eggSide && gust.dir === eggSide) gust.amp *= 0.5;
          d.events.push('gust');
        }
        const u = (t - gust.t0) / gust.dur;
        if (u >= 1) { gust = null; d.gustJustEnded = true; }
        else {
          // quick swell, longer release
          const env = u < 0.3 ? Math.sin((u / 0.3) * Math.PI / 2) : 0.5 * (1 + Math.cos(((u - 0.3) / 0.7) * Math.PI));
          d.gustTorque = gust.dir * gust.amp * env;
          d.gustActive = true;
          d.gustAmp = env;
          d.warningDir = gust.dir;
        }
      }
    }
    // soft ceiling: stacked drift, nudge and gust never exceed what the
    // carriage can answer with the egg still near the middle
    const raw = d.drift + d.nudge + d.gustTorque;
    d.torque = 7.5 * Math.tanh(raw / 7.5);
    return d.torque;
  };
  return d;
}
