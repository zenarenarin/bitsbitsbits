// The flow valley: one continuous path through a fantasy landscape, seen in
// perspective. Challenge shapes the world (how winding and narrow the path
// is, how much grows across it); skill shapes the traveller (how far ahead it
// looks, how nimbly it steers). The state is never drawn as a chart — it is
// what happens on the path.

const W = 1920;
const H = 1080;
const HZ = 470; // horizon
const VX = 1260; // vanishing point x
const NEAR = 1180;

const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerpC = (a, b, t) => {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
};
const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createValley() {
  const S = {
    c: 0.2,
    s: 0.8,
    travel: 0,
    bx: 0,
    stall: 0,
    shake: 0,
    flash: 0,
    lit: new Map(), // obstacle index → time lit
    bumps: 0,
    t: 0,
    events: [],
    wind: [],
  };
  for (let i = 0; i < 70; i++) S.wind.push({ x: Math.random() * W, y: Math.random() * H, l: 40 + Math.random() * 90, v: 900 + Math.random() * 700 });

  // the world in z (0 = at your feet, 1 = horizon)
  const persp = (z) => 1 / (1 + 6.5 * z);
  const P0 = persp(1);
  const yAt = (z) => HZ + (NEAR - HZ) * ((persp(z) - P0) / (1 - P0));
  const tension = () => Math.max(-1, Math.min(1, (S.c - S.s) / 0.32));
  const spacing = () => mix(1.1, 0.16, S.c);
  const amp = () => 0.08 + S.c * 0.42;
  const halfW = () => 0.95 - S.c * 0.55;
  const centre = (zw) => amp() * Math.sin(zw * 2.2) + 0.12 * amp() * Math.sin(zw * 5.3);
  const sx = (zw, z, lateral) => VX + (centre(zw) + lateral * halfW()) * 760 * persp(z) - 330 * persp(z);

  function obstacle(i) {
    const zw = (i + 0.5) * spacing();
    const kind = S.c < 0.33 ? 'stone' : S.c < 0.66 ? 'lantern' : 'bramble';
    const w = kind === 'stone' ? 0.16 : kind === 'lantern' ? 0.3 + S.c * 0.3 : 0.45 + S.c * 0.45;
    const l = (hash(i) * 2 - 1) * (1 - w / 2) * 0.85;
    return { i, zw, l, w, kind };
  }

  function step(dt) {
    S.t += dt;
    const speed = (0.09 + S.s * 0.2) * (S.stall > 0 ? 0 : 1);
    S.stall = Math.max(0, S.stall - dt);
    S.travel += speed * dt;
    S.shake = Math.max(0, S.shake - dt * 3);
    S.flash = Math.max(0, S.flash - dt * 2);
    const bz = S.travel + 0.07;
    // look ahead as far as skill allows, then steer around what's coming
    const look = 0.04 + S.s * 0.5;
    const sp = spacing();
    const first = Math.floor(bz / sp - 0.5);
    let next = null;
    for (let i = first; i < first + 40; i++) {
      const o = obstacle(i);
      if (o.zw >= bz - 0.005) {
        next = o;
        break;
      }
    }
    let target = 0;
    if (next && next.zw - bz < look) {
      const gl = next.l - next.w / 2 + 1;
      const gr = 1 - (next.l + next.w / 2);
      target = gl > gr ? (-1 + next.l - next.w / 2) / 2 : (1 + next.l + next.w / 2) / 2;
    }
    const agility = 0.6 + S.s * 5;
    S.bx += Math.max(-1, Math.min(1, target - S.bx)) * Math.min(1, agility * dt);
    S.bx = Math.max(-0.9, Math.min(0.9, S.bx));

    // passing or hitting
    for (let i = first; i < first + 4; i++) {
      const o = obstacle(i);
      if (Math.abs(o.zw - bz) < 0.012) {
        if (Math.abs(S.bx - o.l) < o.w / 2 + 0.07) {
          if (S.stall <= 0 && !o.hitAt) {
            S.stall = 0.55;
            S.shake = 1;
            S.flash = 1;
            S.bx += (S.bx > o.l ? 1 : -1) * 0.25;
            S.travel += 0.03; // shoved through, eventually
            S.events.push({ type: 'bump' });
          }
        } else if (o.kind === 'lantern' && !S.lit.has(o.i)) {
          S.lit.set(o.i, S.t);
          S.events.push({ type: 'light' });
        }
      }
    }
    // forget lanterns far behind
    if (S.lit.size > 60) [...S.lit.keys()].slice(0, 20).forEach((k) => S.lit.delete(k));
    for (const w of S.wind) {
      w.x -= w.v * dt;
      w.y += w.v * 0.22 * dt;
      if (w.x < -100 || w.y > H + 50) {
        w.x = W + Math.random() * 200;
        w.y = Math.random() * H * 0.9;
      }
    }
  }

  function draw(ctx, k) {
    const T = tension();
    const wb = Math.max(0, -T); // toward boredom
    const wf = Math.max(0, T); // toward frustration
    // palettes: [boredom, flow, frustration]
    const pal = (bored, flow, frust) => (wf > 0 ? lerpC(flow, frust, wf) : lerpC(flow, bored, wb));
    ctx.save();
    ctx.scale(k, k);
    if (S.shake > 0) ctx.translate((Math.random() - 0.5) * 12 * S.shake, (Math.random() - 0.5) * 8 * S.shake);

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, HZ + 40);
    sky.addColorStop(0, pal('#151b2b', '#07142e', '#1a0718'));
    sky.addColorStop(0.7, pal('#3b465c', '#1c4a66', '#4a1430'));
    sky.addColorStop(1, pal('#6b7488', '#5fb8a4', '#a8364a'));
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, HZ + 60);

    // a glow where the path meets the horizon — warm in flow
    const g = ctx.createRadialGradient(VX - 330 * P0, HZ, 10, VX - 330 * P0, HZ, 520);
    g.addColorStop(0, pal('#b4bed2', '#ffd27a', '#ff6a55'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55 - wb * 0.35;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HZ + 200);
    ctx.globalAlpha = 1;

    // distant ridges, two layers
    const ridge = (amp1, base, color, seed, par) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-20, H);
      for (let x = -20; x <= W + 20; x += 20) {
        const xx = x + S.travel * par;
        const y = base - (Math.sin(xx * 0.004 + seed) * 0.5 + 0.5) * amp1 - (Math.sin(xx * 0.011 + seed * 2) * 0.5 + 0.5) * amp1 * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 20, H);
      ctx.fill();
    };
    ridge(70, HZ + 6, pal('#3a4458', '#174a55', '#3a0f22'), 1, 30);
    ridge(46, HZ + 22, pal('#2c3446', '#0f3a3c', '#2c0a18'), 4, 70);

    // ground
    const gr = ctx.createLinearGradient(0, HZ, 0, H);
    gr.addColorStop(0, pal('#2a3142', '#0f3d36', '#26101a'));
    gr.addColorStop(1, pal('#1b202c', '#061f1b', '#12060c'));
    ctx.fillStyle = gr;
    ctx.fillRect(0, HZ + 10, W, H - HZ);

    // the path, far to near
    const steps = 70;
    const pathCol = pal('#5d667c', '#2a8a74', '#4a1e2a');
    const edgeCol = pal('#7c8598', '#8ff7dc', '#c8341f');
    let prev = null;
    for (let j = steps; j >= 0; j--) {
      const z = j / steps;
      const zw = S.travel + z;
      const y = yAt(z);
      const xl = sx(zw, z, -1);
      const xr = sx(zw, z, 1);
      if (prev) {
        ctx.fillStyle = pathCol;
        ctx.beginPath();
        ctx.moveTo(prev.xl, prev.y);
        ctx.lineTo(prev.xr, prev.y);
        ctx.lineTo(xr, y + 1);
        ctx.lineTo(xl, y + 1);
        ctx.fill();
        ctx.strokeStyle = edgeCol;
        ctx.globalAlpha = 0.55 * (1 - z * 0.6);
        ctx.lineWidth = Math.max(1, 3 * persp(z));
        ctx.beginPath();
        ctx.moveTo(prev.xl, prev.y);
        ctx.lineTo(xl, y);
        ctx.moveTo(prev.xr, prev.y);
        ctx.lineTo(xr, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      prev = { xl, xr, y };
    }

    // obstacles, far to near
    const sp = spacing();
    const first = Math.floor(S.travel / sp - 1);
    const last = Math.ceil((S.travel + 1) / sp);
    const bz = S.travel + 0.07;
    const items = [];
    for (let i = last; i >= first; i--) {
      const o = obstacle(i);
      const z = o.zw - S.travel;
      if (z < -0.05 || z > 1) continue;
      items.push({ o, z });
    }
    // draw everything behind the traveller, then the traveller, then what's in front
    const drawObs = ({ o, z }) => {
      const p = persp(Math.max(0, z));
      const y = yAt(Math.max(0, z));
      const x = sx(o.zw, Math.max(0, z), o.l);
      const ww = o.w * halfW() * 760 * p;
      if (o.kind === 'stone') {
        ctx.fillStyle = pal('#8a93a6', '#6a8f86', '#6a3040');
        ctx.beginPath();
        ctx.ellipse(x, y - 8 * p, ww * 0.5, 14 * p, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.kind === 'lantern') {
        // a mushroom-lantern plant: lights up when passed cleanly
        const lit = S.lit.has(o.i);
        const h = 150 * p;
        ctx.fillStyle = pal('#3a4458', '#16614f', '#3a1426');
        ctx.fillRect(x - 5 * p, y - h, 10 * p, h);
        ctx.fillStyle = pal('#556080', '#1fa596', '#5a1a30');
        ctx.beginPath();
        ctx.ellipse(x, y - h, ww * 0.5, 18 * p, 0, Math.PI, 0);
        ctx.fill();
        const bulb = lit ? '#ffd27a' : pal('#7c8598', '#4f8f88', '#6a2a3a');
        if (lit) {
          const gg = ctx.createRadialGradient(x, y - h + 26 * p, 1, x, y - h + 26 * p, 70 * p);
          gg.addColorStop(0, 'rgba(255,210,122,0.75)');
          gg.addColorStop(1, 'rgba(255,210,122,0)');
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(x, y - h + 26 * p, 70 * p, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = bulb;
        ctx.beginPath();
        ctx.ellipse(x, y - h + 26 * p, 11 * p, 15 * p, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // a thorn bramble growing across the path
        ctx.strokeStyle = pal('#4a3040', '#3a2030', '#7e1f2c');
        ctx.lineWidth = Math.max(2, 7 * p);
        ctx.lineCap = 'round';
        const n = 7;
        for (let j = 0; j < n; j++) {
          const a0 = x - ww / 2 + (ww * j) / (n - 1);
          const hh = (60 + hash(o.i * 9 + j) * 90) * p;
          const bend = (hash(o.i * 3 + j) - 0.5) * 80 * p;
          ctx.beginPath();
          ctx.moveTo(a0, y);
          ctx.quadraticCurveTo(a0 + bend, y - hh * 0.6, a0 + bend * 1.6, y - hh);
          ctx.stroke();
          ctx.fillStyle = '#ff6a55';
          ctx.beginPath();
          ctx.arc(a0 + bend * 1.6, y - hh, 4 * p, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = pal('#3a2a36', '#2a1420', '#5a1424');
        ctx.beginPath();
        ctx.ellipse(x, y - 4 * p, ww * 0.55, 22 * p, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    items.filter((it) => it.o.zw > bz).forEach(drawObs);

    // the traveller
    const bp = persp(0.07);
    const by = yAt(0.07);
    const bxs = sx(bz, 0.07, S.bx);
    const bob = Math.abs(Math.sin(S.t * (4 + S.s * 6))) * 10 * (S.stall > 0 ? 0 : 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(bxs, by, 34 * bp, 9 * bp, 0, 0, Math.PI * 2);
    ctx.fill();
    const r = 30 * bp;
    const bg = ctx.createRadialGradient(bxs - r * 0.35, by - r - bob - r * 0.4, 2, bxs, by - r - bob, r);
    bg.addColorStop(0, '#ffe0cc');
    bg.addColorStop(0.4, '#ff8466');
    bg.addColorStop(1, '#d9432f');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bxs, by - r - bob, r, 0, Math.PI * 2);
    ctx.fill();

    items.filter((it) => it.o.zw <= bz).forEach(drawObs);

    // frustration brings a wind that cuts across everything
    if (wf > 0.05) {
      ctx.strokeStyle = `rgba(255,170,150,${0.28 * wf})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const w of S.wind) {
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(w.x + w.l, w.y - w.l * 0.22);
      }
      ctx.stroke();
    }
    // boredom: everything greys out
    if (wb > 0.05) {
      ctx.fillStyle = `rgba(120,128,150,${0.12 * wb})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(255,80,60,${0.16 * S.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  return { S, step, draw };
}
