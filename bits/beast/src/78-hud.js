// ---- Interface: restrained, inked onto the scene -----------------------------
// Top left: height (the score) and the Dream Seed count with a small pod.
// Under them, only while it matters, the Quiet Streak as three leaves.
// Top right: the Creature's Memory (a small pressed-seed journal mark).
// Text is lavender ink with a soft cream halo, so it holds against both sky
// and fur. Discoveries are a single fading line; nothing pauses the climb.

class Hud {
  constructor() {
    this.seedBump = 0;
    this.lastSeeds = 0;
    this.toasts = [];
    this.journalGlow = 0;
    this.time = 0;
    this.blooms = []; // "+n" drifting up from a quiet bloom
  }

  update(dt, seeds) {
    this.time += dt;
    if (seeds.count !== this.lastSeeds) {
      this.seedBump = 1;
      this.lastSeeds = seeds.count;
    }
    this.seedBump = Math.max(0, this.seedBump - dt * 3);
    this.journalGlow = Math.max(0, this.journalGlow - dt * 0.4);
    // At most two discovery lines at once; later ones wait their turn.
    this.toasts.forEach((t, i) => { if (i < 2) t.age += dt; });
    this.toasts = this.toasts.filter((t) => t.age < 4);
    for (const b of this.blooms) b.age += dt;
    this.blooms = this.blooms.filter((b) => b.age < 1.6);
  }

  remember(entry) {
    this.toasts.push({ text: entry.name, age: this.toasts.length ? -0.3 : 0 });
    this.journalGlow = 1;
  }

  // Layout in CSS px.
  layout(ctx) {
    const s = ctx.safeArea || { top: 0, right: 0, left: 0, bottom: 0 };
    return { left: s.left + 16, top: s.top + 14, journal: { x: ctx.width - s.right - 30, y: s.top + 32, r: 22 } };
  }

  hitJournal(ctx, x, y) {
    const j = this.layout(ctx).journal;
    return Math.hypot(x - j.x, y - j.y) < j.r + 6;
  }

  draw(g, ctx, pr, height, seeds, quiet, alpha) {
    const L = this.layout(ctx);
    const x = L.left * pr, y = L.top * pr;
    g.save();
    g.globalAlpha = alpha;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    const hw = inkText(g, `${Math.max(0, Math.round(height))}`, x, y + 24 * pr, `${Math.round(26 * pr)}px ${SERIF}`, 0.95, pr);
    inkText(g, "m", x + hw + 4 * pr, y + 24 * pr, `italic ${Math.round(14 * pr)}px ${SERIF}`, 0.8, pr);
    // Seed count with a small glowing pod.
    const sy = y + 48 * pr;
    const bump = 1 + this.seedBump * 0.35;
    const pod = iconSprite(`pod${pr}`, 40 * pr, (t, S) => drawPod(t, S / 2, S / 2, 4.2 * pr, 6 * pr, SEED_LOOK.common, 1, 1, "cup"));
    const ps = 40 * pr * bump;
    g.drawImage(pod, x + 7 * pr - ps / 2, sy - 5 * pr - ps / 2, ps, ps);
    const cw = inkText(g, `${seeds.count}`, x + 18 * pr, sy, `${Math.round(17 * pr)}px ${SERIF}`, 0.92, pr);
    for (const b of this.blooms) {
      const a = Math.min(1, b.age * 6) * (1 - b.age / 1.6);
      inkText(g, `+${b.n}`, x + 18 * pr + cw + 8 * pr, sy - b.age * 10 * pr, `italic ${Math.round(13 * pr)}px ${SERIF}`, 0.85 * a, pr);
    }
    this.drawQuiet(g, x, sy + 20 * pr, pr, quiet);
    this.drawJournalMark(g, L.journal, pr);
    // Discovery lines under the journal mark, right-aligned.
    let ty = (L.journal.y + L.journal.r + 22) * pr;
    for (const t of this.toasts) {
      if (t.age < 0) continue;
      const a = Math.min(1, t.age * 3) * (1 - smoothstep(3, 4, t.age));
      g.textAlign = "right";
      inkText(g, "remembered", (L.journal.x + L.journal.r) * pr, ty, `italic ${Math.round(10.5 * pr)}px ${SERIF}`, 0.7 * a, pr);
      inkText(g, t.text, (L.journal.x + L.journal.r) * pr, ty + 17 * pr, `italic ${Math.round(15 * pr)}px ${SERIF}`, 0.95 * a, pr);
      ty += 40 * pr;
    }
    g.restore();
  }

  // Three leaves: filled for each tier reached, the next one growing in.
  drawQuiet(g, x, y, pr, quiet) {
    const since = quiet.broken ? quiet.time - quiet.broken.t : 99;
    const show = quiet.metres >= 3 ? smoothstep(3, 5, quiet.metres) : since < 2.5 ? 1 - since / 2.5 : 0;
    if (show <= 0.01) return;
    const brokenFade = quiet.metres < 3 && since < 2.5;
    g.textAlign = "left";
    inkText(g, "quiet", x, y, `italic ${Math.round(12 * pr)}px ${SERIF}`, 0.8 * show, pr);
    const tiers = brokenFade ? quiet.broken.tier : quiet.tier;
    const lx = x + 40 * pr;
    for (let i = 0; i < 3; i++) {
      const cx = lx + i * 13 * pr, cy = y - 4 * pr;
      const full = i < Math.min(tiers, 3) ? 1 : i === Math.min(tiers, 3) && !brokenFade ? quiet.progress : 0;
      // Leaf outline, then the fill growing from its base.
      drawLock(g, cx - 4 * pr, cy + 3 * pr, 0.8, -0.6, 11 * pr, 5 * pr, 0.15, INK_SOFT, 0.35 * show);
      if (full > 0.02) drawLock(g, cx - 4 * pr, cy + 3 * pr, 0.8, -0.6, 11 * pr * full, 5 * pr * Math.sqrt(full), 0.15, mixRGB(SEED_LEAF, [255, 244, 228], 0.25), (brokenFade ? 0.5 : 0.95) * show);
    }
  }

  drawJournalMark(g, j, pr) {
    const x = j.x * pr, y = j.y * pr, r = j.r * pr;
    const glow = this.journalGlow * (0.6 + 0.4 * Math.sin(this.time * 4));
    if (glow > 0.01) {
      g.save();
      g.globalCompositeOperation = "screen";
      dab(g, x, y, r * 1.5, r * 1.5, 0, SEED_LOOK.common.glow, 0.4 * glow);
      g.restore();
    }
    const S = r * 2.4;
    g.drawImage(iconSprite(`journal${pr}`, S, (t) => paintJournalMark(t, S / 2, S / 2, r)), x - S / 2, y - S / 2);
  }
}

// A small closed book with a Dream Seed pressed on its cover, on a soft
// paper disc so it reads over any background.
function paintJournalMark(g, x, y, r) {
  dab(g, x, y, r, r, 0, PAPER, 0.6);
  g.save();
  g.translate(x, y);
  g.rotate(-0.08);
  const bw = r * 0.55, bh = r * 0.7;
  g.beginPath();
  g.moveTo(-bw, -bh);
  g.quadraticCurveTo(0, -bh * 1.08, bw, -bh);
  g.lineTo(bw, bh);
  g.quadraticCurveTo(0, bh * 1.08, -bw, bh);
  g.closePath();
  g.fillStyle = css(mixRGB(INK, PAL.fur[1], 0.35), 0.9);
  g.fill();
  streak(g, -bw * 0.62, -bh * 0.92, 0, 1, bh * 1.84, Math.max(1, r * 0.05), PAL.fur[3], 0.5);
  g.restore();
  drawPod(g, x + r * 0.08, y + r * 0.02, r * 0.17, r * 0.24, SEED_LOOK.common, 1, 1, "cup");
}

// Ink text with a soft cream halo for contrast over sky and fur. Each
// distinct string is rendered once into a small sprite (text is costly to
// rasterise every frame on phones) and blitted with the alpha it needs.
const TEXT_SPRITES = new Map();
let textMeasure = null;
function inkText(g, text, x, y, font, alpha, pr) {
  if (alpha <= 0.01) return;
  const key = `${font}|${text}`;
  let sp = TEXT_SPRITES.get(key);
  if (!sp) {
    if (TEXT_SPRITES.size > 96) {
      for (const old of TEXT_SPRITES.values()) {
        if (typeof old.c.close === "function") old.c.close();
        else discardCanvas(old.c);
      }
      TEXT_SPRITES.clear();
    }
    if (!textMeasure) textMeasure = makeCanvas(4, 4).getContext("2d");
    textMeasure.font = font;
    const size = Number((/(\d+)px/.exec(font) || [0, 16])[1]);
    const pad = Math.ceil(4 * pr);
    const w = Math.ceil(textMeasure.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.45) + pad * 2;
    const c = makeCanvas(w, h);
    const t = c.getContext("2d");
    t.font = font;
    t.textAlign = "left";
    t.textBaseline = "alphabetic";
    t.lineJoin = "round";
    const base = pad + Math.round(size * 1.08);
    t.lineWidth = 4 * pr;
    t.strokeStyle = css([255, 244, 228], 0.4);
    t.strokeText(text, pad, base);
    t.lineWidth = 2 * pr;
    t.strokeStyle = css([255, 244, 228], 0.45);
    t.strokeText(text, pad, base);
    t.fillStyle = css(INK, 1);
    t.fillText(text, pad, base);
    sp = { c: toDrawable(c), w, h, pad, base, tw: w - pad * 2 };
    TEXT_SPRITES.set(key, sp);
  }
  const ax = g.textAlign === "center" ? sp.tw / 2 : g.textAlign === "right" || g.textAlign === "end" ? sp.tw : 0;
  const prev = g.globalAlpha;
  g.globalAlpha = prev * clamp(alpha, 0, 1);
  g.drawImage(sp.c, Math.round(x - ax - sp.pad), Math.round(y - sp.base));
  g.globalAlpha = prev;
  return sp.tw;
}

// Small interface icons, painted once and blitted.
const ICON_SPRITES = new Map();
function iconSprite(key, size, paint) {
  let c = ICON_SPRITES.get(key);
  if (!c) {
    const raw = makeCanvas(Math.ceil(size), Math.ceil(size));
    paint(raw.getContext("2d"), size);
    c = toDrawable(raw); // a GPU-friendly bitmap: blitting it never stalls the frame
    ICON_SPRITES.set(key, c);
  }
  return c;
}

// Results after the beast wakes: height, seeds, best and new discoveries,
// on the settling mist, with an immediate retry (tap anywhere).
function drawResults(g, W, H, pr, safe, res, appear) {
  const a = smoothstep(0, 1, appear);
  if (a <= 0.01) return;
  g.save();
  g.globalAlpha = a;
  // The mist settles: cool below, warm above, with a few soft banks.
  const mist = g.createLinearGradient(0, 0, 0, H);
  mist.addColorStop(0, css(PAL.mistWarm, 0));
  mist.addColorStop(0.55, css(PAL.cloudMid, 0.35));
  mist.addColorStop(1, css(PAL.mistCool, 0.75));
  g.fillStyle = mist;
  g.fillRect(0, 0, W, H);
  const r = rngFrom(911);
  for (let i = 0; i < 14; i++) {
    const bx = r() * W, by = H * (0.55 + r() * 0.5), drift = Math.sin(appear * 0.15 + i) * 12 * pr;
    dab(g, bx + drift, by, (80 + r() * 140) * pr, (18 + r() * 30) * pr, 0, mixRGB(PAL.cloudLit, PAL.cloudShade, r() * 0.6), 0.16);
  }
  const cx = W / 2;
  let y = H * 0.3;
  g.textAlign = "center";
  inkText(g, "It woke.", cx, y, `italic ${Math.round(30 * pr)}px ${SERIF}`, 0.95, pr);
  y += 48 * pr;
  const row = (label, value, note) => {
    inkText(g, label, cx, y, `italic ${Math.round(12 * pr)}px ${SERIF}`, 0.7, pr);
    inkText(g, value, cx, y + 28 * pr, `${Math.round(26 * pr)}px ${SERIF}`, 0.95, pr);
    if (note) inkText(g, note, cx, y + 46 * pr, `italic ${Math.round(11 * pr)}px ${SERIF}`, 0.75, pr);
    y += (note ? 72 : 62) * pr;
  };
  row("height reached", `${Math.round(res.height)} m`, res.newBest ? "a new best" : `best ${Math.round(res.best)} m`);
  row("dream seeds", `${res.seeds}`);
  if (res.newly.length) {
    inkText(g, "remembered", cx, y, `italic ${Math.round(12 * pr)}px ${SERIF}`, 0.7, pr);
    y += 22 * pr;
    for (const e of res.newly.slice(0, 4)) {
      inkText(g, e.name, cx, y, `italic ${Math.round(15 * pr)}px ${SERIF}`, 0.92, pr);
      y += 20 * pr;
    }
    if (res.newly.length > 4) inkText(g, `and ${res.newly.length - 4} more`, cx, y, `italic ${Math.round(11 * pr)}px ${SERIF}`, 0.7, pr);
  }
  const pulse = 0.75 + 0.25 * Math.sin(appear * 3);
  inkText(g, "tap to climb again", cx, H - (safe.bottom + 70) * pr, `italic ${Math.round(15 * pr)}px ${SERIF}`, 0.9 * pulse, pr);
  g.restore();
}
