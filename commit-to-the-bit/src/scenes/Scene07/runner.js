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

    // deep forest behind: two parallax layers of trunks and hanging vines
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#071a2a');
    sky.addColorStop(0.5, '#0c3340');
    sky.addColorStop(1, '#06201f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const layer = (spd, gap, w, color, seed) => {
      ctx.fillStyle = color;
      const off = (s.camX * spd) % gap;
      for (let x = -off - gap, i = 0; x < W + gap; x += gap, i++) {
        const k = Math.abs(Math.floor((s.camX * spd) / gap) + i + seed);
        const ww = w * (0.6 + ((k * 37) % 10) / 12);
        ctx.fillRect(x + ((k * 53) % 60), 0, ww, H);
      }
    };
    layer(0.15, 260, 34, 'rgba(30,70,90,0.55)', 3);
    layer(0.4, 380, 52, 'rgba(10,40,48,0.9)', 7);

    // canopy ceiling: a leafy mass with a scalloped edge and hanging leaves
    const leafOff = s.camX % 46;
    ctx.fillStyle = '#082a26';
    ctx.fillRect(0, 0, W, cy - 6);
    ctx.fillStyle = '#0d3d33';
    for (let x = -leafOff - 46; x < W + 46; x += 46) {
      const k = Math.abs(Math.floor((s.camX + x) / 46));
      ctx.beginPath();
      ctx.arc(x, cy - 10, 22 + ((k * 7) % 9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#16614f';
    for (let x = -leafOff - 46; x < W + 46; x += 92) {
      const k = Math.abs(Math.floor((s.camX + x) / 46));
      const len = 16 + ((k * 13) % 22);
      ctx.beginPath();
      ctx.ellipse(x + 10, cy + len * 0.45, 7, len * 0.6, 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    // mossy floor with grass rushing by
    const soil = ctx.createLinearGradient(0, fy, 0, H);
    soil.addColorStop(0, '#0f4a3e');
    soil.addColorStop(1, '#041612');
    ctx.fillStyle = soil;
    ctx.fillRect(0, fy, W, H - fy);
    ctx.fillStyle = '#1d7a5e';
    ctx.fillRect(0, fy, W, 5);
    const gOff = s.camX % 30;
    ctx.fillStyle = '#2fa37e';
    for (let x = -gOff; x < W; x += 30) {
      const k = Math.abs(Math.floor((s.camX + x) / 30));
      const hh = 8 + ((k * 17) % 14);
      ctx.beginPath();
      ctx.moveTo(x, fy + 2);
      ctx.lineTo(x + 4 + ((k * 3) % 5), fy - hh);
      ctx.lineTo(x + 8, fy + 2);
      ctx.fill();
    }

    // obstacles grown by the forest
    s.obs.forEach((o) => {
      const r = obsRect(o);
      const x = r.x - s.camX;
      if (x > W + 60 || x + r.w < -60) return;
      if (o.top) {
        // a hanging thorn pod on a vine
        ctx.strokeStyle = '#0d3d33';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x + r.w / 2, r.y);
        ctx.lineTo(x + r.w / 2, r.y + r.h * 0.35);
        ctx.stroke();
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, '#c8341f');
        g.addColorStop(1, '#ff8a6a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x + r.w / 2, r.y + r.h * 0.62, r.w / 2, r.h * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7e2a10';
        for (let i = 0; i < 4; i++) {
          const yy = r.y + r.h * (0.4 + i * 0.13);
          ctx.beginPath();
          ctx.moveTo(x + 2, yy);
          ctx.lineTo(x - 8, yy + 6);
          ctx.lineTo(x + 4, yy + 10);
          ctx.moveTo(x + r.w - 2, yy);
          ctx.lineTo(x + r.w + 8, yy + 6);
          ctx.lineTo(x + r.w - 4, yy + 10);
          ctx.fill();
        }
      } else if (o.kind === 'piston') {
        // a violet capsule plant that swells and sinks
        const g = ctx.createLinearGradient(x, 0, x + r.w, 0);
        g.addColorStop(0, '#5a3aa8');
        g.addColorStop(1, '#a77cf2');
        ctx.fillStyle = g;
        roundRect(ctx, x + 6, r.y, r.w - 12, r.h, (r.w - 12) / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + r.w * 0.4, r.y + 14);
        ctx.lineTo(x + r.w * 0.4, r.y + r.h - 10);
        ctx.stroke();
      } else {
        // a mushroom stump: cream stem, ember cap
        const capH = Math.min(26, r.h * 0.4);
        ctx.fillStyle = '#e9dcbc';
        roundRect(ctx, x + r.w * 0.22, r.y + capH * 0.6, r.w * 0.56, r.h - capH * 0.6, 8);
        ctx.fill();
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + capH);
        g.addColorStop(0, '#ffb36a');
        g.addColorStop(1, '#e4702a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x + r.w / 2, r.y + capH * 0.7, r.w / 2 + 6, capH * 0.75, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,240,210,0.8)';
        ctx.beginPath();
        ctx.arc(x + r.w * 0.35, r.y + capH * 0.35, 3, 0, Math.PI * 2);
        ctx.arc(x + r.w * 0.62, r.y + capH * 0.22, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
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
