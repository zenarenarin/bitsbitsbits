// ---- The Creature's Memory ---------------------------------------------------
// A persistent field journal of what the climbs have found: twelve
// illustrated fragments of the beast and the life on it. Each is remembered
// the first time it happens and stays remembered; the journal also keeps the
// best height and every seed ever gathered. Stored with ctx.storage (viewer
// local); where storage is unavailable it lasts for the session.

const MEMORY_ENTRIES = [
  { id: "seed", name: "Dream Seed", note: "A pod of warm light, rooted in the fur." },
  { id: "lantern", name: "Lantern Seed", note: "Three lights, hung where only a jump will reach." },
  { id: "frond", name: "Ancient Frond", note: "Seven beads on one curl, older than any climb." },
  { id: "breath", name: "Its Breath", note: "Stand still, and the whole hill rises and falls." },
  { id: "caps", name: "Cap Gardens", note: "Mushrooms root in its fur. They spring, and do not tell." },
  { id: "moss", name: "Hush Moss", note: "Moss swallows a footstep whole." },
  { id: "spires", name: "The Spires", note: "Rose-stone spines along its back, warm to the touch." },
  { id: "shoulder", name: "The Shoulder", note: "The back steepens here, and the wind finds you." },
  { id: "eye", name: "The Closed Eye", note: "A lid the size of a valley. Something moves beneath." },
  { id: "quiet", name: "Quiet Ways", note: "Eighty metres without a sound. It never knew you." },
  { id: "settle", name: "A Lighter Sleep", note: "It stirred. You waited. It slept again." },
  { id: "waking", name: "The Waking", note: "It is not a hill. It never was." }
];
const MEMORY_KEY = "creature-memory";

function makeStore(ctx) {
  const mem = {};
  const s = ctx.storage;
  return {
    get(key) {
      try {
        if (s && typeof s.get === "function") {
          const v = s.get(key);
          if (v !== undefined && v !== null) return v;
        }
      } catch (err) { /* storage unavailable: keep the session copy */ }
      return mem[key] === undefined ? null : mem[key];
    },
    set(key, v) {
      mem[key] = v;
      try {
        if (s && typeof s.set === "function") s.set(key, v);
      } catch (err) { /* storage unavailable: keep the session copy */ }
    }
  };
}

class Memory {
  constructor(store, world) {
    this.store = store;
    this.world = world;
    const saved = store.get(MEMORY_KEY);
    const ok = saved && typeof saved === "object" && saved.v === 1;
    this.data = ok ? saved : { v: 1, found: {}, bestHeight: 0, bestSeeds: 0, seeds: 0, runs: 0 };
    if (!this.data.found || typeof this.data.found !== "object") this.data.found = {};
    this.newly = []; // discovered this run, in order
    this.queue = []; // waiting to be announced
    this.dirty = false;
    this.saveT = 0;
    this.startRun();
  }

  startRun() {
    this.newly = [];
    this.seq = 0;
    this.mossSteps = 0;
    this.sawStir = false;
  }

  has(id) {
    return !!this.data.found[id];
  }

  get count() {
    return MEMORY_ENTRIES.filter((e) => this.has(e.id)).length;
  }

  discover(id) {
    if (this.has(id)) return;
    this.data.found[id] = Date.now();
    const entry = MEMORY_ENTRIES.find((e) => e.id === id);
    this.newly.push(entry);
    this.queue.push(entry);
    this.dirty = true;
  }

  // Watches the run for first discoveries. Cheap: a few comparisons a frame.
  observe(dt, ex, alert, seeds, quiet) {
    for (const s of seeds.collected) this.discover(s.kind === "rare" ? "lantern" : s.kind === "ancient" ? "frond" : "seed");
    seeds.collected.length = 0;
    for (const p of alert.pulses) {
      if (p.seq <= this.seq) continue;
      this.seq = p.seq;
      if (p.kind === "step" && p.surface === "moss" && ++this.mossSteps >= 10) this.discover("moss");
    }
    if (ex.onCap) this.discover("caps");
    if (alert.state === "sleep" && alert.still > 8) this.discover("breath");
    if (ex.y >= 150) this.discover("spires");
    if (ex.y >= 200) this.discover("shoulder");
    const h = this.world.focus.head;
    if (Math.hypot(ex.x - h.x, ex.y - h.y) < 24) this.discover("eye");
    if (quiet.tier >= 3) this.discover("quiet");
    if (alert.state === "stirring") this.sawStir = true;
    if (this.sawStir && alert.state === "sleep") this.discover("settle");
    if (alert.state === "awake") this.discover("waking");
    // Writes are batched: at most every two seconds, never per frame.
    this.saveT -= dt;
    if (this.dirty && this.saveT <= 0) this.save();
  }

  // End of a run: fold it into the records. Returns what the results show.
  endRun(height, seedCount) {
    const d = this.data;
    const prevBest = d.bestHeight;
    d.runs++;
    d.seeds += seedCount;
    d.bestHeight = Math.max(d.bestHeight, height);
    d.bestSeeds = Math.max(d.bestSeeds, seedCount);
    this.dirty = true;
    this.save();
    return { height, seeds: seedCount, best: d.bestHeight, newBest: height > prevBest && d.runs > 1, newly: this.newly.slice() };
  }

  save() {
    this.store.set(MEMORY_KEY, this.data);
    this.dirty = false;
    this.saveT = 2;
  }
}

// ---- The journal page -------------------------------------------------------
// A field journal laid over the paused climb: warm paper, lavender ink, and
// a grid of fragments painted with the game's own brushes. Fragments not
// yet found are an empty inked ring.

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const INK = hex("#4a3d68"), INK_SOFT = hex("#8a7aa8"), PAPER = hex("#f7ecdd"), PAPER_EDGE = hex("#e9cdb8");
const SERIF = "Georgia, 'Times New Roman', serif";

function drawJournal(g, W, H, pr, safe, memory, appear, time) {
  const a = smoothstep(0, 1, appear);
  g.save();
  g.globalAlpha = a;
  // Paper with a warm painted edge.
  g.fillStyle = css(PAPER, 1);
  g.fillRect(0, 0, W, H);
  const v = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  v.addColorStop(0, css(PAPER_EDGE, 0));
  v.addColorStop(1, css(PAPER_EDGE, 0.75));
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  const r = rngFrom(4127);
  for (let i = 0; i < 70; i++) {
    dab(g, r() * W, r() * H, (20 + r() * 60) * pr, (6 + r() * 16) * pr, r() * 3, mixRGB(PAPER, PAPER_EDGE, r()), 0.18);
  }

  const top = (safe.top + 18) * pr, side = Math.max(16 * pr, W * 0.05);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = css(INK, 0.95);
  g.font = `italic ${Math.round(22 * pr)}px ${SERIF}`;
  g.fillText("The Creature’s Memory", W / 2, top + 22 * pr);
  g.font = `${Math.round(11.5 * pr)}px ${SERIF}`;
  g.fillStyle = css(INK_SOFT, 0.95);
  const d = memory.data;
  g.fillText(`${memory.count} of ${MEMORY_ENTRIES.length} remembered  ·  best ${Math.round(d.bestHeight)} m  ·  ${d.seeds} seeds gathered`, W / 2, top + 42 * pr);
  // A hand-ruled line under the title.
  streak(g, W / 2 - 90 * pr, top + 52 * pr, 1, 0.01, 180 * pr, 1 * pr, INK_SOFT, 0.5);

  const cols = 3, rows = 4;
  const gx0 = side, gx1 = W - side;
  const gy0 = top + 66 * pr, gy1 = H - (safe.bottom + 40) * pr;
  const cw = (gx1 - gx0) / cols, ch = (gy1 - gy0) / rows;
  MEMORY_ENTRIES.forEach((e, i) => {
    const cx = gx0 + cw * (i % cols + 0.5), cy = gy0 + ch * (Math.floor(i / cols) + 0.5);
    const rad = Math.min(cw * 0.36, ch * 0.3);
    const icy = cy - ch * 0.12;
    const found = memory.has(e.id);
    if (found) {
      // Watercolour wash behind the fragment.
      const w = g.createRadialGradient(cx, icy, 0, cx, icy, rad * 1.15);
      w.addColorStop(0, css(hex("#fbe3cf"), 0.95));
      w.addColorStop(0.7, css(hex("#f1cdc0"), 0.55));
      w.addColorStop(1, css(hex("#e9c3c6"), 0));
      g.fillStyle = w;
      g.fillRect(cx - rad * 1.2, icy - rad * 1.2, rad * 2.4, rad * 2.4);
      g.save();
      g.beginPath();
      g.arc(cx, icy, rad * 1.05, 0, Math.PI * 2);
      g.clip();
      drawFragment(g, e.id, cx, icy, rad, time);
      g.restore();
      g.beginPath();
      g.arc(cx, icy, rad * 1.05, 0, Math.PI * 2);
      g.lineWidth = 1 * pr;
      g.strokeStyle = css(INK_SOFT, 0.45);
      g.stroke();
    } else {
      g.save();
      g.setLineDash([2 * pr, 5 * pr]);
      g.beginPath();
      g.arc(cx, icy, rad * 0.8, 0, Math.PI * 2);
      g.lineWidth = 1.1 * pr;
      g.strokeStyle = css(INK_SOFT, 0.5);
      g.stroke();
      g.restore();
    }
    const fresh = memory.newly.includes(e);
    g.textAlign = "center";
    if (!found) {
      // An unfound fragment is just its numbered ring.
      g.font = `italic ${Math.round(13 * pr)}px ${SERIF}`;
      g.fillStyle = css(INK_SOFT, 0.5);
      g.fillText(ROMAN[i], cx, icy + 5 * pr);
      return;
    }
    g.font = `italic ${Math.round(12.5 * pr)}px ${SERIF}`;
    g.fillStyle = css(INK, 0.95);
    g.fillText(e.name, cx, icy + rad * 1.05 + 16 * pr);
    g.font = `${Math.round(9.5 * pr)}px ${SERIF}`;
    g.fillStyle = css(INK_SOFT, 0.95);
    wrapText(g, e.note, cx, icy + rad * 1.05 + 30 * pr, cw * 0.92, 11.5 * pr, 2);
    if (fresh) {
      g.font = `italic ${Math.round(9 * pr)}px ${SERIF}`;
      g.fillStyle = css(hex("#b0705a"), 0.9);
      g.fillText("new", cx + rad * 0.95, icy - rad * 0.85);
    }
  });
  g.textAlign = "center";
  g.font = `italic ${Math.round(11 * pr)}px ${SERIF}`;
  g.fillStyle = css(INK_SOFT, 0.85);
  g.fillText("tap to return to the climb", W / 2, H - (safe.bottom + 16) * pr);
  g.restore();
}

function wrapText(g, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(" ");
  let line = "", n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y + n * lineH);
      line = words[i];
      if (++n >= maxLines) return;
    } else line = test;
  }
  if (line) g.fillText(line, x, y + n * lineH);
}

// One illustrated fragment, centred at (cx, cy), fitting radius rad.
function drawFragment(g, id, cx, cy, rad, time) {
  const k = rad / 1.1; // px per metre inside the vignette
  const mound = (y, w, h) => {
    dab(g, cx, cy + y * k, w * k, h * k, 0, PAL.fur[2], 0.9);
    dab(g, cx + 0.1 * k, cy + (y - h * 0.25) * k, w * 0.85 * k, h * 0.7 * k, 0, PAL.fur[3], 0.9);
    const r = rngFrom(id.length * 31 + 7);
    for (let i = 0; i < 14; i++) {
      const u = r() * 2 - 1;
      drawLock(g, cx + u * w * 0.85 * k, cy + (y - h * 0.55 * (1 - u * u)) * k, 0.3 * u, -1, (0.12 + r() * 0.1) * k, 0.06 * k, u * 0.2, ramp(PAL.fur, 0.55 + r() * 0.4), 0.85);
    }
  };
  const P = (X, Y) => [cx + X * k, cy - Y * k];
  const seedOf = (kind, scale) => {
    mound(0.75, 1.3, 0.45);
    drawSeedPlant(g, cx, cy + 0.55 * k, k * scale, { kind, phase: 1, lean: 0 }, 1, time, 0);
  };
  switch (id) {
    case "seed": seedOf("common", 1.5); break;
    case "lantern": seedOf("rare", 1.25); break;
    case "frond": seedOf("ancient", 1.1); break;
    case "breath": {
      mound(0.5, 1.4, 0.6);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        const y = cy - (0.25 + i * 0.28 + Math.sin(time * 0.8) * 0.04) * k;
        g.moveTo(cx - 0.8 * k, y + 0.12 * k);
        g.quadraticCurveTo(cx, y - 0.12 * k, cx + 0.8 * k, y + 0.12 * k);
        g.lineWidth = Math.max(1, 0.035 * k);
        g.strokeStyle = css(INK_SOFT, 0.55 - i * 0.12);
        g.stroke();
      }
      break;
    }
    case "caps": {
      mound(0.8, 1.3, 0.4);
      const m = { root: { x: -0.1, y: -0.55 }, top: { x: 0.05, y: 0.5 }, capR: 0.75 };
      drawMushroom(g, P, k, m, {}, 3);
      drawMushroom(g, P, k, { root: { x: 0.55, y: -0.6 }, top: { x: 0.7, y: -0.1 }, capR: 0.38 }, {}, 5);
      break;
    }
    case "moss": {
      mound(0.6, 1.3, 0.55);
      const r = rngFrom(99);
      for (let i = 0; i < 46; i++) {
        const u = r() * 2 - 1;
        dab(g, cx + u * 0.9 * k, cy + (0.15 - (1 - u * u) * 0.25 - r() * 0.12) * k, (0.05 + r() * 0.07) * k, (0.04 + r() * 0.05) * k, 0, ramp(PAL.moss, 0.25 + r() * 0.6), 0.9);
      }
      break;
    }
    case "spires": {
      mound(0.85, 1.4, 0.4);
      for (const [x, h, w] of [[-0.45, 1.3, 0.16], [0.1, 1.7, 0.2], [0.55, 1.0, 0.13]]) {
        drawLock(g, cx + x * k, cy + 0.55 * k, 0.04, -1, h * k, w * 2 * k, 0.04, PAL.spire[1], 1);
        drawLock(g, cx + (x + 0.03) * k, cy + 0.5 * k, 0.04, -1, h * 0.95 * k, w * 1.1 * k, 0.04, PAL.spire[3], 0.8);
      }
      break;
    }
    case "shoulder": {
      g.beginPath();
      g.moveTo(cx - 1.2 * k, cy + 1.1 * k);
      g.quadraticCurveTo(cx - 0.4 * k, cy - 0.6 * k, cx + 1.2 * k, cy - 0.2 * k);
      g.lineTo(cx + 1.2 * k, cy + 1.2 * k);
      g.closePath();
      g.fillStyle = css(PAL.fur[2], 0.9);
      g.fill();
      for (let i = 0; i < 4; i++) streak(g, cx - (0.9 - i * 0.15) * k, cy - (0.55 + i * 0.16) * k, 1, -0.12, (0.9 + i * 0.1) * k, Math.max(1, 0.03 * k), INK_SOFT, 0.45);
      drawExplorer(g, cx - 0.2 * k, cy + 0.02 * k, 0.5 * k, -1, { time });
      break;
    }
    case "eye": {
      dab(g, cx, cy + 0.2 * k, 1.3 * k, 1 * k, 0, PAL.fur[2], 0.95);
      dab(g, cx + 0.15 * k, cy, 1.1 * k, 0.8 * k, 0, PAL.fur[3], 0.9);
      drawClosedEye(g, P, k, { x: 0, y: 0, w: 1.7, tilt: 0.1, outer: 1 }, {}, 11);
      break;
    }
    case "quiet": {
      g.beginPath();
      g.moveTo(cx - 1.2 * k, cy + 1.2 * k);
      g.lineTo(cx + 1.2 * k, cy - 0.4 * k);
      g.lineTo(cx + 1.2 * k, cy + 1.2 * k);
      g.closePath();
      g.fillStyle = css(PAL.fur[3], 0.9);
      g.fill();
      for (let i = 0; i < 6; i++) {
        const u = i / 6;
        dab(g, cx + lerp(-1, 0.6, u) * k, cy + lerp(0.95, -0.12, u) * k - (i % 2) * 0.05 * k, 0.05 * k, 0.025 * k, -0.6, INK_SOFT, 0.6);
      }
      drawExplorer(g, cx + 0.75 * k, cy - 0.2 * k, 0.55 * k, 1, { time });
      break;
    }
    case "settle": {
      mound(0.5, 1.4, 0.6);
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const y = cy - 0.55 * k + Math.sin(u * 18) * (1 - u) * 0.18 * k;
        if (i) g.lineTo(cx + lerp(-1, 1, u) * k, y); else g.moveTo(cx - k, y);
      }
      g.lineWidth = Math.max(1, 0.035 * k);
      g.strokeStyle = css(INK_SOFT, 0.6);
      g.stroke();
      break;
    }
    case "waking": {
      dab(g, cx, cy + 0.2 * k, 1.3 * k, 1 * k, 0, PAL.fur[1], 0.95);
      dab(g, cx + 0.15 * k, cy, 1.1 * k, 0.8 * k, 0, PAL.fur[2], 0.9);
      g.save();
      g.beginPath();
      g.ellipse(cx, cy, 0.85 * k, 0.32 * k, 0.08, 0, Math.PI * 2);
      g.clip();
      dab(g, cx, cy, 0.9 * k, 0.4 * k, 0, hex("#f3e3c8"), 1);
      dab(g, cx + 0.05 * k, cy, 0.34 * k, 0.34 * k, 0, hex("#d99a4a"), 1);
      dab(g, cx + 0.05 * k, cy, 0.22 * k, 0.22 * k, 0, hex("#b06a3a"), 1);
      dab(g, cx + 0.05 * k, cy, 0.05 * k, 0.26 * k, 0, PAL.lash, 1);
      dab(g, cx - 0.04 * k, cy - 0.1 * k, 0.06 * k, 0.04 * k, 0, [255, 250, 240], 0.9);
      g.restore();
      g.beginPath();
      g.ellipse(cx, cy, 0.85 * k, 0.32 * k, 0.08, Math.PI * 1.02, Math.PI * 1.98);
      g.lineWidth = Math.max(1.2, 0.05 * k);
      g.strokeStyle = css(PAL.lash, 0.9);
      g.stroke();
      break;
    }
  }
}
