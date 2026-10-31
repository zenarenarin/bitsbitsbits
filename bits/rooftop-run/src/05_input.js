// =====================================================================
// Input: turns fingers and keys into { steer, jumpPressed, jumpHeld }.
// Knows nothing about the cat. Each pointer owns one role for its whole
// life, so steering and jumping work at the same time.
//
// Touch layout (both orientations): the left part of the screen is a
// floating stick (it appears where the thumb lands); the right part is
// the jump zone, with a visible button inside it. The zone, not the
// button, is the hit area, so a thumb never misses the jump.
// =====================================================================

function createInput(ctx, canvas, ui) {
  const I = TUNING.input;
  const state = { steer: 0, jumpHeld: false, presses: 0, stick: null, keys: new Set(), keySteer: 0, enabled: false, virtual: null };
  const roles = new Map();
  const rect = () => canvas.getBoundingClientRect();
  const jumpZoneX = () => ctx.width * (1 - I.jumpZone);
  const anyJumpPointer = () => { for (const r of roles.values()) if (r.role === 'jump') return true; return false; };

  function press() { state.presses++; state.jumpHeld = true; ui.jumpDown(true); }
  function releaseCheck() { state.jumpHeld = anyJumpPointer() || state.keys.has('Space') || state.keys.has('KeyW') || state.keys.has('ArrowUp'); if (!state.jumpHeld) ui.jumpDown(false); }

  function onDown(e) {
    if (!state.enabled) return;
    if (e.cancelable) e.preventDefault();
    const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x >= jumpZoneX() || (e.pointerType === 'mouse' && e.button === 2)) {
      roles.set(e.pointerId, { role: 'jump' }); press();
    } else if (!state.stick && y < ctx.height - ((ctx.safeArea && ctx.safeArea.bottom) || 0)) {
      roles.set(e.pointerId, { role: 'stick' });
      state.stick = { ox: x, oy: y, x, y, id: e.pointerId };
      ui.stickShow(x, y);
    } else roles.set(e.pointerId, { role: 'none' });
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
  }
  function onMove(e) {
    const R = roles.get(e.pointerId); if (!R || R.role !== 'stick' || !state.stick) return;
    const r = rect(), s = state.stick;
    s.x = e.clientX - r.left; s.y = e.clientY - r.top;
    // the stick's origin follows a thumb that overshoots, so reversing is instant
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), R0 = I.stickRadius;
    if (d > R0) { s.ox += dx / d * (d - R0); s.oy += dy / d * (d - R0); }
    ui.stickMove(s.ox, s.oy, s.x - s.ox, s.y - s.oy);
  }
  function onUp(e) {
    const R = roles.get(e.pointerId); if (!R) return;
    roles.delete(e.pointerId);
    if (R.role === 'stick') { state.stick = null; ui.stickHide(); }
    if (R.role === 'jump') releaseCheck();
  }
  ctx.listen(canvas, 'pointerdown', onDown);
  ctx.listen(canvas, 'pointermove', onMove);
  ctx.listen(canvas, 'pointerup', onUp);
  ctx.listen(canvas, 'pointercancel', onUp);
  ctx.listen(canvas, 'contextmenu', e => e.preventDefault());

  const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyW', 'Space']);
  ctx.listen(window, 'keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (KEYS.has(e.code)) e.preventDefault();
    if (e.repeat || !state.enabled) return;
    state.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') press();
  });
  ctx.listen(window, 'keyup', e => { state.keys.delete(e.code); releaseCheck(); });

  // read once per simulation step
  function sample(dt) {
    if (state.virtual) {
      const v = state.virtual; const p = v.jump && !v._was; v._was = !!v.jump;
      return { steer: v.steer || 0, jumpPressed: p, jumpHeld: !!v.jump };
    }
    const k = state.keys;
    const want = ((k.has('ArrowRight') || k.has('KeyD')) ? 1 : 0) - ((k.has('ArrowLeft') || k.has('KeyA')) ? 1 : 0);
    // keys are digital; give them a short ramp so they steer like a thumb, not a switch
    state.keySteer += clamp(want - state.keySteer, -dt * 9, dt * 9);
    let steer = state.keySteer;
    if (state.stick) {
      const s = state.stick, n = clamp((s.x - s.ox) / I.stickRadius, -1, 1), m = Math.abs(n);
      steer = m < I.stickDead ? 0 : sign(n) * Math.pow((m - I.stickDead) / (1 - I.stickDead), I.stickCurve);
    }
    state.steer = steer;
    const out = { steer, jumpPressed: state.presses > 0, jumpHeld: state.jumpHeld };
    state.presses = 0;
    return out;
  }
  function clear() { roles.clear(); state.stick = null; state.keys.clear(); state.jumpHeld = false; state.presses = 0; state.keySteer = 0; ui.stickHide(); ui.jumpDown(false); }

  return { state, sample, clear };
}
