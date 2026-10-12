// ---- Controls --------------------------------------------------------------
// Touch: hold the left or right half of the screen to move; slide that finger
// further outward to move faster. Swipe up (any finger) to jump; a finger
// that swiped up stops steering, so a second thumb can keep moving for a
// running jump. Lift every finger to stand still - stillness is a choice.
// Keyboard (testing): A/D or arrows to move, Shift to move faster,
// Space/W/Up to jump.

const SWIPE_UP_PX = 34;
const SWIPE_MS = 320;
const RUN_DRAG_PX = 46;

class Controls {
  constructor(ctx, target, onFirstGesture) {
    this.ctx = ctx;
    this.pointers = new Map();
    this.keys = new Set();
    this.jumpPressed = false;
    this.speedScale = 1;
    this.jumpScale = 1;
    this.first = onFirstGesture;
    this.intercept = null; // (x, y) -> true when an interface tap takes the touch
    const L = (t, ev, fn, o) => ctx.listen(t, ev, fn, o);
    L(target, "pointerdown", (e) => this.down(e));
    L(target, "pointermove", (e) => this.move(e));
    L(target, "pointerup", (e) => this.up(e));
    L(target, "pointercancel", (e) => this.up(e));
    L(window, "keydown", (e) => this.key(e, true));
    L(window, "keyup", (e) => this.key(e, false));
    L(window, "blur", () => { this.keys.clear(); this.pointers.clear(); });
    this.target = target;
  }

  gesture() {
    if (this.first) { this.first(); this.first = null; }
  }

  down(e) {
    this.gesture();
    const r = this.target.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (this.intercept && this.intercept(x, e.clientY - r.top)) return;
    this.pointers.set(e.pointerId, {
      x, y: e.clientY - r.top, sx: x, sy: e.clientY - r.top, t0: performance.now(),
      side: x < r.width / 2 ? -1 : 1, swiped: false, order: performance.now()
    });
    if (this.target.setPointerCapture) {
      try { this.target.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const r = this.target.getBoundingClientRect();
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    if (!p.swiped && p.sy - p.y > SWIPE_UP_PX && performance.now() - p.t0 < SWIPE_MS && Math.abs(p.x - p.sx) < (p.sy - p.y) * 1.2) {
      p.swiped = true;
      this.jumpPressed = true;
    }
    if (p.swiped && Math.abs(p.x - p.sx) > 30) p.swiped = false; // dragged sideways: steer again
  }

  up(e) {
    this.pointers.delete(e.pointerId);
  }

  key(e, isDown) {
    const k = e.key.toLowerCase();
    const known = ["arrowleft", "arrowright", "arrowup", "a", "d", "w", " ", "shift", "enter", "m", "escape"];
    if (!known.includes(k)) return;
    if (e.preventDefault) e.preventDefault();
    // Keyboard stand-ins for the interface taps: Enter (retry/close), M (memory).
    if (isDown && this.intercept && (k === "enter" || k === "m" || k === "escape") && this.intercept(null, null, k)) return;
    if (isDown) {
      this.gesture();
      if ((k === " " || k === "w" || k === "arrowup") && !e.repeat) this.jumpPressed = true;
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
  }

  // Current steering: the most recent active finger wins, else the keyboard.
  get dir() {
    let best = null;
    for (const p of this.pointers.values()) {
      if (p.swiped) continue;
      if (performance.now() - p.t0 < 70 && Math.abs(p.x - p.sx) < 12) continue; // could still become a swipe
      if (!best || p.order > best.order) best = p;
    }
    if (best) return best.side;
    const l = this.keys.has("arrowleft") || this.keys.has("a");
    const r = this.keys.has("arrowright") || this.keys.has("d");
    return l === r ? 0 : l ? -1 : 1;
  }

  get run() {
    for (const p of this.pointers.values()) {
      if (!p.swiped && (p.x - p.sx) * p.side > RUN_DRAG_PX) return true;
    }
    return this.keys.has("shift");
  }

  consume() {
    this.jumpPressed = false;
  }

  // Lift every finger and key (e.g. when an overlay opens).
  release() {
    this.pointers.clear();
    this.keys.clear();
    this.jumpPressed = false;
  }

  // Active touches (for the faint on-screen touch marks).
  touches() {
    return [...this.pointers.values()];
  }
}
