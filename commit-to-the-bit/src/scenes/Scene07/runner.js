// One game, three stages. The only action is a jump and the rules never
// change; what changes is the space, the speed and what the course asks of
// you. The corridor physically narrows, the floor rushes faster, obstacles
// start to combine and move.

export const STAGES = [
  { speed: 380, gap: 440, spacing: [820, 1000], ceil: 0, moving: 0 },
  { speed: 560, gap: 300, spacing: [470, 620], ceil: 0.35, moving: 0 },
  { speed: 720, gap: 250, spacing: [360, 470], ceil: 0.45, moving: 0.45 },
];

const W = 1920;
const H = 600;
const CY = 300; // corridor centre (canvas space)
const BIT_X = 520;
const R = 22;
const G = 3000;
const JUMP = 980;

export function createRunner() {
  const s = {
    stage: 0,
    cur: { ...STAGES[0] },
    camX: 0,
    x: 0,
    y: CY + STAGES[0].gap / 2 - R,
    vy: 0,
    grounded: true,
    squash: 0,
    hurt: 0,
    slow: 1,
    obs: [],
    nextAt: 900,
    lastHuman: -10,
    t: 0,
    events: [],
    flash: 0,
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const floorY = () => CY + s.cur.gap / 2;
  const ceilY = () => CY - s.cur.gap / 2;

  function spawn(atX) {
    const st = STAGES[s.stage];
    const r = Math.random();
    if (r < st.ceil) {
      // a hanger with a low block underneath: jump timing matters
      s.obs.push({ x: atX, w: rand(70, 110), h: rand(0.42, 0.5), top: true, kind: 'hang' });
      if (s.stage >= 1 && Math.random() < 0.5) s.obs.push({ x: atX + rand(240, 300), w: 60, h: 46, top: false, kind: 'block' });
    } else if (Math.random() < st.moving) {
      s.obs.push({ x: atX, w: 70, h: 90, top: false, kind: 'piston', ph: rand(0, 6.28) });
    } else {
      s.obs.push({ x: atX, w: rand(56, 84), h: rand(56, 96), top: false, kind: 'block' });
    }
  }

  function setStage(n) {
    s.stage = n;
    s.events.push({ type: 'stage', n });
    // clear what's ahead so the new stage starts cleanly, without a jump-cut
    s.obs = s.obs.filter((o) => o.x < s.x + 900);
    s.nextAt = Math.max(s.nextAt, s.x + 900);
  }

  function jump(human = true) {
    if (human) s.lastHuman = s.t;
    if (!s.grounded) return;
    s.vy = -JUMP;
    s.grounded = false;
    s.squash = -1;
    s.events.push({ type: 'jump' });
  }

  function obsRect(o) {
    const fy = floorY();
    const cy = ceilY();
    if (o.top) return { x: o.x, y: cy, w: o.w, h: s.cur.gap * o.h };
    let h = o.h;
    if (o.kind === 'piston') h = 30 + (Math.sin(s.t * 3.2 + o.ph) * 0.5 + 0.5) * 120;
    h = Math.min(h, s.cur.gap - 70);
    return { x: o.x, y: fy - h, w: o.w, h };
  }

  function bot() {
    // look ahead for the first obstacle we haven't passed
    const ahead = s.obs
      .filter((o) => o.x + o.w > s.x - R)
      .sort((a, b) => a.x - b.x);
    const o = ahead.find((k) => !k.top);
    if (!o) return;
    const d = o.x - (s.x + R);
    const lead = s.cur.speed * 0.16 + 30;
    const hang = ahead.find((k) => k.top && k.x - s.x < d + o.w + 120 && k.x + k.w > s.x);
    if (d < lead && d > 0) {
      // a hanger directly overhead means wait, unless the block forces us
      if (!hang || hang.x > s.x + 140 || d < lead * 0.5) jump(false);
    }
  }

  function step(dt) {
    s.t += dt;
    const T = STAGES[s.stage];
    // the world eases between stages; it never snaps
    s.cur.speed += (T.speed - s.cur.speed) * Math.min(1, dt * 1.6);
    s.cur.gap += (T.gap - s.cur.gap) * Math.min(1, dt * 2.2);
    s.slow += (1 - s.slow) * Math.min(1, dt * 1.5);
    const v = s.cur.speed * s.slow;
    s.x += v * dt;
    s.camX = s.x - BIT_X;

    if (s.t - s.lastHuman > 3) bot();

    s.vy += G * dt;
    s.y += s.vy * dt;
    const fy = floorY();
    const cy = ceilY();
    if (s.y + R >= fy) {
      if (!s.grounded && s.vy > 400) {
        s.squash = Math.min(1, s.vy / 1600);
        s.events.push({ type: 'land' });
      }
      s.y = fy - R;
      s.vy = 0;
      s.grounded = true;
    }
    if (s.y - R <= cy) {
      // the same jump, in a tighter corridor, bonks the ceiling
      s.y = cy + R;
      s.vy = Math.abs(s.vy) * 0.3;
      s.squash = 0.8;
      s.events.push({ type: 'bonk' });
    }
    s.squash += (0 - s.squash) * Math.min(1, dt * 8);
    s.hurt = Math.max(0, s.hurt - dt);
    s.flash = Math.max(0, s.flash - dt * 2);

    // course
    while (s.nextAt < s.x + W) {
      spawn(s.nextAt);
      s.nextAt += rand(T.spacing[0], T.spacing[1]);
    }
    s.obs = s.obs.filter((o) => o.x + o.w > s.camX - 100);

    // contact: a knock, a tumble, keep running
    if (s.hurt <= 0)
      for (const o of s.obs) {
        const r = obsRect(o);
        const cx = Math.max(r.x, Math.min(s.x, r.x + r.w));
        const cyy = Math.max(r.y, Math.min(s.y, r.y + r.h));
        if (Math.hypot(s.x - cx, s.y - cyy) < R - 2) {
          s.hurt = 0.9;
          s.slow = 0.35;
          s.flash = 1;
          s.squash = 1;
          s.vy = -500;
          s.grounded = false;
          s.events.push({ type: 'hit' });
          break;
        }
      }
  }

  function draw(ctx, k) {
    ctx.save();
    ctx.scale(k, k);
    ctx.clearRect(0, 0, W, H);
    const fy = floorY();
    const cy = ceilY();
    const v = s.cur.speed * s.slow;

    // far columns: parallax shows speed without a number
    ctx.fillStyle = 'rgba(167,124,242,0.10)';
    const colGap = 220;
    const off = (s.camX * 0.35) % colGap;
    for (let x = -off; x < W; x += colGap) ctx.fillRect(x, cy, 14, fy - cy);

    // corridor
    ctx.fillStyle = '#121a4a';
    ctx.fillRect(0, cy, W, fy - cy);
    ctx.fillStyle = '#05092a';
    ctx.fillRect(0, 0, W, cy);
    ctx.fillRect(0, fy, W, H - fy);
    ctx.fillStyle = '#ffc94a';
    ctx.fillRect(0, fy, W, 3);
    ctx.fillRect(0, cy - 3, W, 3);
    // floor ticks rushing by
    ctx.fillStyle = 'rgba(255,201,74,0.35)';
    const tick = 120;
    const toff = s.camX % tick;
    for (let x = -toff; x < W; x += tick) ctx.fillRect(x, fy + 14, 40, 3);

    // obstacles
    s.obs.forEach((o) => {
      const r = obsRect(o);
      const x = r.x - s.camX;
      if (x > W + 50 || x + r.w < -50) return;
      ctx.fillStyle = o.top ? '#ff6a55' : o.kind === 'piston' ? '#a77cf2' : '#f5ead3';
      roundRect(ctx, x, r.y, r.w, r.h, 10);
      ctx.fill();
    });

    // speed lines behind the Bit
    const bx = BIT_X;
    const lines = Math.max(0, (v - 300) / 60);
    ctx.strokeStyle = 'rgba(255,154,114,0.5)';
    ctx.lineWidth = 3;
    for (let i = 0; i < lines; i++) {
      const yy = s.y - R + 8 + ((i * 13) % (R * 2 - 10));
      const len = 30 + ((i * 37 + Math.floor(s.t * 30)) % 50);
      ctx.beginPath();
      ctx.moveTo(bx - R - 10 - len, yy);
      ctx.lineTo(bx - R - 10, yy);
      ctx.stroke();
    }

    // the Bit
    ctx.save();
    ctx.translate(bx, s.y);
    const sq = s.squash;
    const sx = sq > 0 ? 1 + sq * 0.35 : 1 + sq * 0.18;
    const sy = sq > 0 ? 1 - sq * 0.3 : 1 - sq * 0.25;
    ctx.translate(0, R * (1 - sy));
    ctx.scale(sx, sy);
    if (s.hurt > 0) ctx.rotate(s.hurt * 8);
    const grd = ctx.createRadialGradient(-7, -7, 2, 0, 0, R);
    grd.addColorStop(0, '#ffe0cc');
    grd.addColorStop(0.4, '#ff8466');
    grd.addColorStop(1, '#d9432f');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (s.flash > 0) {
      ctx.fillStyle = `rgba(255,106,85,${s.flash * 0.18})`;
      ctx.fillRect(0, cy, W, fy - cy);
    }
    ctx.restore();
  }

  return { s, step, draw, jump, setStage };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
