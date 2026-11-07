// A tiny game assembled from three words: an action, a world behaviour and
// an objective. Everything lives inside a circular arena (centre c, radius R).
// When nobody touches it for a moment, an autopilot plays so the combination
// is always visible.

const TAU = Math.PI * 2;

const FREE = ['bounce', 'collide', 'teleport', 'merge'];

export function createGame({ size = 680 }) {
  const c = size / 2;
  const R = size / 2 - 12;
  const g = {
    combo: { action: 'tap', world: 'bounce', goal: 'avoid' },
    p: { x: c, y: c, vx: 0, vy: 0, r: 20, squash: 0 },
    items: [],
    fx: [],
    score: 0,
    best: 0,
    lives: 3,
    t: 0,
    spawnT: 0,
    lastHuman: -10,
    pointer: { x: c, y: c, down: false },
    bot: { t: 0, down: false, aimT: 0 },
    shake: 0,
    events: [],
  };

  const emit = (e) => g.events.push(e);
  const rand = (a, b) => a + Math.random() * (b - a);

  function inside(x, y, m = 0) {
    return Math.hypot(x - c, y - c) < R - m;
  }

  function newItem() {
    const w = g.combo.world;
    const goal = g.combo.goal;
    const kind = goal === 'collect' ? 'gem' : goal === 'match' ? 'orb' : 'hazard';
    const it = { kind, r: kind === 'gem' ? 15 : 17, life: 0, max: Infinity, grow: 1, spin: rand(0, TAU), passed: false, color: Math.random() < 0.5 ? '#34d6c2' : '#ffc94a', jump: rand(0.8, 1.8) };
    if (FREE.includes(w)) {
      const a = rand(0, TAU);
      const d = rand(0, R * 0.6);
      Object.assign(it, { x: c + Math.cos(a) * d, y: c - 120 + Math.sin(a) * d * 0.5, vx: rand(-220, 220), vy: rand(-220, 220) });
    } else if (w === 'fall') {
      Object.assign(it, { x: c + rand(-R * 0.7, R * 0.7), y: c - R + 30, vx: 0, vy: rand(40, 120) });
    } else if (w === 'move') {
      const y = c + rand(-R * 0.6, R * 0.6);
      const half = Math.sqrt(Math.max(0, R * R - (y - c) ** 2));
      Object.assign(it, { x: c - half + 10, y, vx: rand(180, 280), vy: 0 });
    } else {
      // spawn: appears in place, grows in, then vanishes
      let x;
      let y;
      do {
        x = c + rand(-R, R);
        y = c + rand(-R, R);
      } while (!inside(x, y, 50) || Math.hypot(x - g.p.x, y - g.p.y) < 90);
      Object.assign(it, { x, y, vx: 0, vy: 0, grow: 0, max: 2.6 });
    }
    return it;
  }

  function reset(full = true) {
    g.items = [];
    g.fx = [];
    g.score = 0;
    g.lives = 3;
    g.spawnT = 0;
    Object.assign(g.p, { x: c, y: c - 40, vx: 0, vy: 0 });
    if (full) g.best = 0;
    if (FREE.includes(g.combo.world)) for (let i = 0; i < 4; i++) g.items.push(newItem());
  }

  function setCombo(combo) {
    const prev = g.combo;
    g.combo = { ...combo };
    if (prev.world !== combo.world || prev.goal !== combo.goal) {
      // items burst and the new world fills in
      g.items.forEach((it) => burst(it.x, it.y, it.kind === 'gem' ? '#ffc94a' : '#a77cf2', 6));
      g.items = [];
      g.score = 0;
      g.lives = 3;
      if (FREE.includes(combo.world)) for (let i = 0; i < 4; i++) g.items.push(newItem());
    }
    if (prev.action !== combo.action) {
      g.p.vy = -420;
      g.p.squash = 1;
    }
  }

  function burst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.2, 0.2);
      const s = rand(120, 280);
      g.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(0.4, 0.8), color, r: rand(2, 5) });
    }
  }

  function addScore(n) {
    g.score += n;
    if (g.score > g.best) g.best = g.score;
    emit({ type: 'score' });
  }

  /* ---------- input (human or bot) ---------- */
  function press(x, y, human = true) {
    if (human) g.lastHuman = g.t;
    g.pointer = { x, y, down: true };
    const a = g.combo.action;
    const p = g.p;
    g.swipe = { x, y };
    if (a === 'tap') {
      p.vy = -540;
      p.vx = Math.max(-260, Math.min(260, p.vx + (x - p.x) * 0.9));
      p.squash = 1;
      emit({ type: 'act' });
    } else if (a === 'aim') {
      const d = Math.hypot(x - p.x, y - p.y) || 1;
      const s = 760;
      p.vx = ((x - p.x) / d) * s;
      p.vy = ((y - p.y) / d) * s;
      p.squash = 1;
      emit({ type: 'act' });
    }
  }
  function move(x, y, human = true) {
    if (human && g.pointer.down) g.lastHuman = g.t;
    g.pointer.x = x;
    g.pointer.y = y;
  }
  function release(human = true) {
    if (human) g.lastHuman = g.t;
    if (g.combo.action === 'swipe' && g.swipe) {
      // a swipe flings the player in the direction of the gesture
      let dx = g.pointer.x - g.swipe.x;
      let dy = g.pointer.y - g.swipe.y;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        const s = Math.min(950, 260 + d * 5);
        g.p.vx = (dx / d) * s;
        g.p.vy = (dy / d) * s;
        g.p.squash = 1;
        emit({ type: 'act' });
      }
    }
    g.swipe = null;
    g.pointer.down = false;
  }

  /* ---------- autopilot ---------- */
  function botTarget() {
    const p = g.p;
    if (g.combo.goal === 'collect' || g.combo.goal === 'match') {
      let best = null;
      let bd = Infinity;
      g.items.forEach((it) => {
        if (it.kind === 'orb' && it.color !== g.p.color) return;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < bd) {
          bd = d;
          best = it;
        }
      });
      return best ? { x: best.x, y: best.y } : { x: c, y: c };
    }
    // avoid / survive: head for the open point furthest from the nearest hazard
    let tx = c;
    let ty = c - 40;
    g.items.forEach((it) => {
      const dx = p.x - it.x;
      const dy = p.y - it.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 220) {
        tx += (dx / d) * (220 - d) * 1.4;
        ty += (dy / d) * (220 - d) * 1.4;
      }
    });
    const dd = Math.hypot(tx - c, ty - c);
    if (dd > R * 0.6) {
      tx = c + ((tx - c) / dd) * R * 0.6;
      ty = c + ((ty - c) / dd) * R * 0.6;
    }
    return { x: tx, y: ty };
  }

  function bot(dt) {
    const B = g.bot;
    const a = g.combo.action;
    const T = botTarget();
    const p = g.p;
    B.t += dt;
    if (a === 'tap') {
      if (p.y > T.y + 30 && p.vy > -60 && B.t > 0.22) {
        press(T.x, T.y, false);
        g.pointer.down = false;
        B.t = 0;
      }
    } else if (a === 'drag') {
      g.pointer = { x: T.x, y: T.y, down: true };
    } else if (a === 'hold') {
      g.pointer = { x: T.x, y: T.y, down: p.y > T.y };
    } else if (a === 'swipe') {
      if (B.t > 0.9) {
        g.swipe = { x: p.x, y: p.y };
        g.pointer = { x: T.x, y: T.y, down: true };
        release(false);
        B.t = 0;
      }
    } else if (a === 'aim') {
      if (B.t > 1.1) {
        press(T.x, T.y, false);
        g.pointer.down = false;
        B.t = 0;
      }
    }
  }

  /* ---------- step ---------- */
  function step(dt) {
    g.t += dt;
    const { action, world, goal } = g.combo;
    const p = g.p;
    if (goal === 'match') {
      const c = Math.floor(g.t / 4) % 2 ? '#ffc94a' : '#34d6c2';
      if (c !== p.color) {
        p.color = c;
        p.squash = 0.6;
      }
    } else p.color = null;
    if (g.t - g.lastHuman > 2.5) bot(dt);

    const grav = FREE.includes(world) ? 820 : world === 'move' ? 900 : 1000;
    const rest = FREE.includes(world) ? 0.92 : world === 'fall' ? 0.25 : 0.5;

    // action-specific control forces
    if (action === 'drag' && g.pointer.down) {
      p.vx += ((g.pointer.x - p.x) * 14 - p.vx) * Math.min(1, dt * 8);
      p.vy += ((g.pointer.y - p.y) * 14 - p.vy) * Math.min(1, dt * 8);
    } else {
      p.vy += grav * dt;
      if (action === 'hold' && g.pointer.down) {
        p.vy -= 2100 * dt;
        p.vx += (g.pointer.x - p.x) * 2.2 * dt;
      }
    }
    p.vx *= 1 - 0.25 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.squash = Math.max(0, p.squash - dt * 4);

    // circular wall
    const dx = p.x - c;
    const dy = p.y - c;
    const d = Math.hypot(dx, dy);
    if (d > R - p.r) {
      const nx = dx / d;
      const ny = dy / d;
      p.x = c + nx * (R - p.r);
      p.y = c + ny * (R - p.r);
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) {
        p.vx -= (1 + rest) * vn * nx;
        p.vy -= (1 + rest) * vn * ny;
        if (vn > 260) {
          p.squash = Math.min(1, vn / 900);
          emit({ type: 'wall', v: vn });
        }
      }
    }

    // spawning
    g.spawnT += dt;
    const every = world === 'fall' ? 0.6 : world === 'move' ? 0.75 : world === 'spawn' ? 0.55 : world === 'merge' ? 1.1 : Infinity;
    const cap = goal === 'survive' ? 10 : 7;
    if ((!FREE.includes(world) || world === 'merge') && g.spawnT > every && g.items.length < cap) {
      g.spawnT = 0;
      g.items.push(newItem());
    }
    if (FREE.includes(world) && world !== 'merge' && goal === 'survive' && g.spawnT > 4 && g.items.length < 8) {
      g.spawnT = 0;
      g.items.push(newItem());
    }

    // items
    for (let i = g.items.length - 1; i >= 0; i--) {
      const it = g.items[i];
      it.life += dt;
      it.spin += dt * 2;
      if (world === 'fall') it.vy += 380 * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      if (world === 'spawn') it.grow = Math.min(1, it.life * 5) * Math.min(1, (it.max - it.life) * 4);
      if (world === 'teleport') {
        it.jump -= dt;
        if (it.jump <= 0) {
          // vanish here, appear somewhere else
          burst(it.x, it.y, 'rgba(143,247,220,0.9)', 6);
          let nx;
          let ny;
          do {
            nx = c + rand(-R, R);
            ny = c + rand(-R, R);
          } while (!inside(nx, ny, 50) || Math.hypot(nx - p.x, ny - p.y) < 90);
          it.x = nx;
          it.y = ny;
          it.jump = rand(1.1, 1.9);
          it.grow = 0;
        }
        it.grow = Math.min(1, it.grow + dt * 5);
        it.vx *= 0.97;
        it.vy *= 0.97;
      }
      if (FREE.includes(world)) {
        const ex = it.x - c;
        const ey = it.y - c;
        const ed = Math.hypot(ex, ey);
        if (ed > R - it.r) {
          const nx = ex / ed;
          const ny = ey / ed;
          it.x = c + nx * (R - it.r);
          it.y = c + ny * (R - it.r);
          const vn = it.vx * nx + it.vy * ny;
          it.vx -= 2 * vn * nx;
          it.vy -= 2 * vn * ny;
        }
      }
      const gone = it.life > it.max || (!FREE.includes(world) && !inside(it.x, it.y, -it.r));
      // contact
      const hit = Math.hypot(it.x - p.x, it.y - p.y) < (it.r * it.grow + p.r) * 0.9 && it.grow > 0.6;
      if (hit) {
        g.items.splice(i, 1);
        if (it.kind === 'gem' || (it.kind === 'orb' && it.color === p.color)) {
          burst(it.x, it.y, it.kind === 'orb' ? it.color : '#ffc94a', 12);
          addScore(1);
          emit({ type: 'collect' });
        } else if (it.kind === 'orb') {
          burst(it.x, it.y, '#ff6a55', 14);
          g.shake = 1;
          g.score = 0;
          emit({ type: 'hit' });
        } else {
          burst(it.x, it.y, '#ff6a55', 14);
          g.shake = 1;
          if (goal === 'survive') {
            g.lives -= 1;
            emit({ type: 'hit' });
            if (g.lives <= 0) {
              emit({ type: 'over' });
              g.lives = 3;
              g.score = 0;
              g.items = [];
            }
          } else {
            g.score = 0;
            emit({ type: 'hit' });
          }
        }
        if (FREE.includes(world) && world !== 'merge' && goal !== 'survive') g.items.push(newItem());
        continue;
      }
      if (gone) {
        g.items.splice(i, 1);
      }
    }
    if (world === 'collide' || world === 'merge') {
      for (let i = 0; i < g.items.length; i++)
        for (let j = i + 1; j < g.items.length; j++) {
          const a = g.items[i];
          const b = g.items[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < a.r + b.r) {
            if (world === 'merge' && a.kind === b.kind && a.color === b.color && a.r < 34) {
              // two become one, bigger
              a.r = Math.min(36, Math.sqrt(a.r * a.r + b.r * b.r));
              a.vx = (a.vx + b.vx) / 2;
              a.vy = (a.vy + b.vy) / 2;
              burst(b.x, b.y, a.kind === 'gem' ? '#ffc94a' : '#a77cf2', 8);
              g.items.splice(j, 1);
              emit({ type: 'merge' });
              j--;
              continue;
            }
            const nx = dx / d;
            const ny = dy / d;
            const push = (a.r + b.r - d) / 2;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              a.vx += rv * nx;
              a.vy += rv * ny;
              b.vx -= rv * nx;
              b.vy -= rv * ny;
            }
          }
        }
    }
    if (goal === 'survive' || goal === 'avoid') {
      // avoid: an unbroken streak; survive: seconds alive across three lives
      const before = Math.floor(g.t - dt);
      if (Math.floor(g.t) !== before) addScore(1);
    }

    // fx
    for (let i = g.fx.length - 1; i >= 0; i--) {
      const f = g.fx[i];
      f.life += dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= 1 - 3 * dt;
      f.vy *= 1 - 3 * dt;
      if (f.life > f.max) g.fx.splice(i, 1);
    }
    g.shake = Math.max(0, g.shake - dt * 3);
  }

  /* ---------- draw ---------- */
  function draw(ctx, k) {
    ctx.save();
    ctx.scale(k, k);
    ctx.clearRect(0, 0, size, size);
    if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * g.shake, (Math.random() - 0.5) * 10 * g.shake);
    // pointer guide for aim
    if (g.combo.action === 'aim') {
      ctx.strokeStyle = 'rgba(245,234,211,0.25)';
      ctx.setLineDash([2, 10]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(g.p.x, g.p.y);
      ctx.lineTo(g.pointer.x, g.pointer.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if ((g.combo.action === 'drag' || g.combo.action === 'hold') && g.pointer.down) {
      ctx.strokeStyle = 'rgba(245,234,211,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.pointer.x, g.pointer.y, 16, 0, TAU);
      ctx.stroke();
    }
    g.items.forEach((it) => {
      const r = it.r * it.grow;
      if (r <= 0.5) return;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.spin);
      if (it.kind === 'orb') {
        ctx.fillStyle = it.color;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, TAU);
        ctx.fill();
      } else if (it.kind === 'gem') {
        // a golden berry on a leaf
        ctx.fillStyle = '#46b083';
        ctx.beginPath();
        ctx.ellipse(r * 0.55, -r * 0.75, r * 0.55, r * 0.22, -0.6, 0, TAU);
        ctx.fill();
        const bg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
        bg.addColorStop(0, '#fff3c4');
        bg.addColorStop(1, '#e8a21a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.85, 0, TAU);
        ctx.fill();
      } else {
        // a thorn pod
        ctx.fillStyle = '#7a45d6';
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const rr = i % 2 ? r * 0.55 : r * 1.15;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
    g.fx.forEach((f) => {
      ctx.globalAlpha = 1 - f.life / f.max;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // the player — the Bit, squashing on impact
    const p = g.p;
    const sp = Math.hypot(p.vx, p.vy);
    const ang = Math.atan2(p.vy, p.vx);
    const sq = p.squash * 0.35;
    const st = Math.min(0.25, sp / 3000);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.scale(1 + st - sq * 0.3, 1 - st * 0.6 + sq * 0.15);
    const grd = ctx.createRadialGradient(-6, -6, 2, 0, 0, p.r);
    grd.addColorStop(0, '#ffe0cc');
    grd.addColorStop(0.35, '#ff8466');
    grd.addColorStop(1, '#d9432f');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, TAU);
    ctx.fill();
    if (p.color) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 7, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  reset();
  return { g, step, draw, press, move, release, setCombo, reset };
}
