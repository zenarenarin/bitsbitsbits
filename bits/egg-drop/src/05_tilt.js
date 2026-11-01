// Phone tilt input. Produces one number: how far the phone is tilted to the
// right (degrees, relative to a calibrated neutral), turned into a carriage
// target by the game through the same servo the finger uses.
//
// Two sources:
//  - 'plethora': the host's ctx.motion (native sensor bridge in the app).
//  - 'browser':  DeviceOrientationEvent, with iOS's requestPermission() when
//                the browser has it, and only in a secure context.
//
// Status is reported in separate stages so the UI (and anyone testing on a
// device) can tell them apart: implemented -> permission -> receiving -> moving.

const TILT_DEFAULTS = { fullDeg: 20, deadDeg: 1.2, expo: 1.5, tauS: 0.06 };

// Right-tilt angle from W3C deviceorientation beta/gamma, for the given screen
// rotation. The "up" vector in device coordinates is
// (-sin g cos b, sin b, cos g cos b); tilting right lowers the screen's right
// edge, i.e. up . screenRight goes negative.
function lateralFromOrientation(betaDeg, gammaDeg, screenAngleDeg) {
  const b = betaDeg * Math.PI / 180, gm = gammaDeg * Math.PI / 180, sa = (screenAngleDeg || 0) * Math.PI / 180;
  const ux = -Math.sin(gm) * Math.cos(b), uy = Math.sin(b);
  const rx = Math.cos(sa), ry = -Math.sin(sa);    // screen-right in device x/y
  const d = Math.max(-1, Math.min(1, -(ux * rx + uy * ry)));
  return Math.asin(d) * 180 / Math.PI;
}

// Map a calibrated tilt (degrees) to -1..1: dead zone, sensitivity, expo curve.
function tiltCurve(deg, sens, o) {
  o = o || TILT_DEFAULTS;
  const a = Math.abs(deg) - o.deadDeg;
  if (a <= 0) return 0;
  const u = Math.min(1, a / (o.fullDeg / sens));
  return Math.sign(deg) * Math.pow(u, o.expo);
}

function createTilt(ctx) {
  const T = {
    implemented: true,
    source: null,              // 'plethora' | 'browser' | null
    permission: 'unknown',     // unknown | requesting | granted | denied | not-required | unavailable | insecure
    error: '',
    samples: 0, lastSampleAt: 0,
    rawDeg: 0,                 // current lateral tilt, uncalibrated
    neutral: null,             // calibrated zero, degrees
    sensitivity: 1,
    value: 0                   // smoothed, curved output -1..1
  };
  let listening = false, unsubs = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const screenAngle = () => {
    try { if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle; } catch (e) { }
    return typeof window.orientation === 'number' ? window.orientation : 0;
  };
  const sample = (deg) => {
    if (!isFinite(deg)) return;
    T.rawDeg = deg; T.samples++; T.lastSampleAt = now();
  };
  const hostMotion = () => !!(ctx.motion && ctx.capabilities && ctx.capabilities.motion);
  const browserMotion = () => typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';

  T.available = () => hostMotion() || browserMotion();

  // Must be called directly from a tap handler: iOS only allows the
  // permission prompt inside a user gesture.
  T.enable = async function () {
    T.error = '';
    if (listening) return true;
    if (hostMotion()) {
      T.permission = 'requesting';
      try {
        await ctx.motion.start({ smoothing: 0, deadzone: 0 });
        T.source = 'plethora'; T.permission = 'granted';
        const off = ctx.motion.onChange((snap) => {
          // control.x is the host's degree-based left/right steering value
          const c = snap && snap.control;
          if (c && isFinite(c.x)) sample(c.x);
        }, { throttleHz: 60 });
        if (typeof off === 'function') unsubs.push(off);
        listening = true;
        return true;
      } catch (e) {
        T.error = String(e && e.message || e);
        T.permission = /denied|NotAllowed/i.test(T.error) ? 'denied' : 'unavailable';
        if (!browserMotion()) return false;
        // fall through to the browser path (it may need a second tap on iOS)
      }
    }
    if (!browserMotion()) { T.permission = 'unavailable'; return false; }
    if (window.isSecureContext === false) { T.permission = 'insecure'; return false; }
    const DOE = window.DeviceOrientationEvent;
    // Listen first: the answer below is not the whole story. iOS Safari sends
    // nothing until requestPermission() says 'granted', but newer Chrome also
    // has requestPermission() and can answer 'denied' while events still flow.
    // Live data therefore upgrades a refusal.
    T.source = 'browser';
    unsubs.push(ctx.listen(window, 'deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      sample(lateralFromOrientation(e.beta, e.gamma, screenAngle()));
      if (T.permission === 'denied' || T.permission === 'requesting') T.permission = 'granted';
    }));
    if (typeof DOE.requestPermission === 'function') {
      T.permission = 'requesting';
      try {
        const r = await DOE.requestPermission();
        if (T.permission === 'requesting') T.permission = r === 'granted' ? 'granted' : 'denied';
      } catch (e) {
        // thrown when not called from a gesture, or blocked
        T.error = String(e && e.message || e);
        if (T.permission === 'requesting') T.permission = 'denied';
      }
    } else T.permission = 'not-required';
    // a rotated screen changes which way is "right": ask for a new zero
    unsubs.push(ctx.listen(window, 'orientationchange', () => { T.neutral = null; }));
    listening = true;
    return T.permission !== 'denied';
  };

  T.receiving = () => T.samples > 0 && now() - T.lastSampleAt < 1500;
  T.calibrate = () => {
    if (!T.receiving()) return false;
    T.neutral = T.rawDeg; T.value = 0;
    if (T.source === 'plethora') { try { ctx.motion.calibrate(); } catch (e) { } }
    return true;
  };
  T.calibratedDeg = () => (T.neutral == null ? 0 : T.rawDeg - T.neutral);
  // advance the smoothing; returns -1..1
  T.update = (dt) => {
    const target = T.neutral == null || !T.receiving() ? 0 : tiltCurve(T.calibratedDeg(), T.sensitivity);
    const k = 1 - Math.exp(-Math.max(0, dt) / TILT_DEFAULTS.tauS);
    T.value += (target - T.value) * k;
    if (Math.abs(T.value) < 1e-4 && target === 0) T.value = 0;
    return T.value;
  };
  T.reset = () => { T.value = 0; };
  T.statusText = () => {
    const p = { unknown: 'Not started', requesting: 'Asking permission…', granted: 'Permission granted', 'not-required': 'No permission needed', denied: 'Permission denied', unavailable: 'Motion sensor unavailable', insecure: 'Needs a secure (https) page' }[T.permission] || T.permission;
    if (T.permission !== 'granted' && T.permission !== 'not-required') return p;
    if (!T.receiving()) return p + ' · waiting for sensor data';
    return p + ' · sensor live · ' + (T.neutral == null ? 'not calibrated' : (T.calibratedDeg() >= 0 ? '+' : '') + T.calibratedDeg().toFixed(1) + '°');
  };
  T.stop = () => {
    for (const u of unsubs) { try { u(); } catch (e) { } }
    unsubs = []; listening = false;
    if (T.source === 'plethora') { try { ctx.motion.stop(); } catch (e) { } }
    T.source = null; T.samples = 0; T.value = 0;
    if (T.permission === 'granted' || T.permission === 'not-required') T.permission = 'unknown';
  };
  return T;
}
