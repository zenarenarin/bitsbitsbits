// The game: layout, input, rules, scoring, rendering and the Plethora lifecycle.

const SAFE_DEFAULT = 17;   // degrees: beyond this for too long and the table is lost
const GRACE = 1.0;         // seconds the table may spend past the safe angle
const BAL = 3.5 * DEG;     // "balanced" zone of the gauge
const TRAY_CAP = 3;

window.plethoraBit = {
  meta: {
    title: 'The Unstable Table',
    runtime: 'plethora-bit@2',
    tags: ['physics', 'balance', 'casual', 'art'],
    permissions: ['audio', 'backgroundMusic', 'haptics', 'storage']
  },

  async init(ctx) {
    const DEV = !!window.__UT_DEV;
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    const canvas = ctx.createCanvas2D({ coordinateSpace: 'css', maxDpr: 2, alpha: false, layer: 'content', touchAction: 'none' });
    const g = canvas.getContext('2d');
    hiddenCanvasFactory = () => {
      const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' });
      c.style.display = 'none';
      return c;
    };
    let W = ctx.width, H = ctx.height;
    const dprOf = () => Math.min(2, ctx.dpr || 1);

    // ---- tuning (creator knobs; defaults when unavailable) ----
    const tune = ctx.tune;
    const tn = (id, d) => { try { const v = tune && tune.number(id); return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    const tms = (id, d) => { try { const v = tune && tune.durationMs(id); return typeof v === 'number' && isFinite(v) ? v : d; } catch (e) { return d; } };
    const SAFE = tn('safe_angle', SAFE_DEFAULT) * DEG;
    const CRIT = SAFE * 0.66;
    const simOpts = { ballastMass: tn('ballast_mass', PHYS.ballastMass), angDamp: tn('table_damping', PHYS.angDamp) };
    const ARRIVE_START = tms('arrival_start', 9000) / 1000, ARRIVE_MIN = tms('arrival_min', 3200) / 1000;

    // ---- first frame while the physics library loads ----
    g.fillStyle = PAL.burgundy; g.fillRect(0, 0, W, H);
    g.fillStyle = rgba(PAL.cream, 0.7); g.font = 'italic 18px Georgia, serif'; g.textAlign = 'center';
    g.fillText('laying the table…', W / 2, H / 2);

    const fontLoads = Promise.all([
      ctx.loadFont('UT Serif', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }),
      ctx.loadFont('UT Serif', 'dm-serif-display', '1.0.0', { weight: '400', style: 'italic' })
    ]).then(() => { fontsReady = true; }).catch(e => { if (DEV) console.warn('font', e); });
    let fontsReady = false;
    const F = (size, italic) => `${italic ? 'italic ' : ''}${size}px ${fontsReady ? '"UT Serif", ' : ''}Georgia, "Times New Roman", serif`;

    let planck;
    try {
      await ctx.loadScript('planck', '1.5.0');
      planck = window.planck;
      if (!planck || !planck.World) throw new Error('planck global missing after load');
    } catch (err) {
      ctx.platform.error({ stage: 'dependency', message: String(err && err.message || err) });
      g.fillStyle = PAL.burgundy; g.fillRect(0, 0, W, H);
      g.fillStyle = PAL.cream; g.font = 'italic 17px Georgia, serif';
      g.fillText('The physics engine could not be loaded.', W / 2, H / 2 - 10);
      g.fillText('Please reopen the Bit.', W / 2, H / 2 + 16);
      ctx.markVisualReady('dependency-error');
      ctx.platform.ready();
      return;
    }
    if (destroyed) return;

    // ---- persistent bits ----
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    const load = (k, d) => { if (!canStore) return d; try { const v = ctx.storage.get(k); return v == null ? d : v; } catch (e) { return d; } };
    const save = (k, v) => { if (!canStore) return; try { ctx.storage.set(k, v); } catch (e) {} };
    let best = load('best', { score: 0, placed: 0, streak: 0 });
    let seenHint = !!load('seenHint', false);

    // ---- audio ----
    const audio = createAudio();
    audio.setMuted(!!load('muted', false));
    ctx.onDestroy(() => audio.dispose());
    let music = null;
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic && ctx.music);
    const musicVol = tn('music_volume', 0.32);
    function startMusic() {
      if (!canMusic || music || audio.muted) return;
      try {
        ctx.music.unlock && ctx.music.unlock().catch(() => {});
        music = ctx.music.play({ preset: 'ambient', volume: musicVol, tempo: 66, scale: 'dorian', intensity: 0.25, fadeInMs: 2400 });
      } catch (e) { music = null; }
    }
    function musicIntensity(v) { try { music && music.setIntensity(v, { fadeMs: 900 }); } catch (e) {} }
    function sting(name) { try { if (music && !audio.muted) ctx.music.sting(name).catch(() => {}); } catch (e) {} }
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    const haptic = k => { if (canHaptic) try { ctx.platform.haptic(k); } catch (e) {} };

    const scoreTrack = ctx.game.score();

    // ---- layout ----
    const L = {};
    function layout() {
      W = ctx.width; H = ctx.height;
      const a = ctx.contentSafeArea || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      L.top = a.top + 10; L.left = Math.max(16, a.left + 12); L.right = W - Math.max(16, a.right + 12);
      L.bottom = H - Math.max(a.bottom, 16) - 6;
      L.hudH = 112; L.hudBottom = L.top + L.hudH;
      L.trayH = clamp(H * 0.15, 104, 130);
      L.trayTop = L.bottom - L.trayH;
      L.s0 = Math.min((W - 28) / (PHYS.halfLen * 2 + 0.45), (L.trayTop - L.hudBottom) / (-PHYS.floorY + 0.3 + 2.5));
      L.pivotX = W / 2;
      L.pivotY = L.trayTop - 0.3 * L.s0 + PHYS.floorY * L.s0; // a strip of stage floor shows above the tray
      if (!cam.s) cam.s = L.s0;
      L.gauge = { x: W / 2, y: L.top + 52, r: clamp(W * 0.105, 34, 46) };
      L.mute = { x: L.right - 16, y: L.top + 84, r: 15 };
    }
    const cam = { s: 0 };
    const W2S = (x, y) => [L.pivotX + x * cam.s, L.pivotY - y * cam.s];
    const S2W = (x, y) => [(x - L.pivotX) / cam.s, (L.pivotY - y) / cam.s];

    // ---- painted assets ----
    let A = null, assetsR = 0;
    function buildAssets() {
      const dpr = dprOf();
      const R = Math.round(clamp(L.s0 * dpr * 1.1, 110, 280));
      if (!A || Math.abs(R - assetsR) / assetsR > 0.2) {
        assetsR = R;
        const objs = {};
        for (const o of OBJECTS) { const spr = paintObjectSprite(o, R); objs[o.id] = { spr, halo: silhouetteSprite(spr, PAL.cream), shadow: silhouetteSprite(spr, PAL.ink) }; }
        A = Object.assign(A || {}, { objs, table: paintTable(R), ballast: paintBallast(R), stand: paintStand(R), floor: paintFloor(Math.round(R * 0.5)) });
        A.grain = A.grain || paintPaperGrain(256, 4242);
      }
      A.backdrop = paintBackdrop(W, H, dpr, L.pivotY, 1717);
      A.tray = paintTray(W, H - L.trayTop + 8, dpr, 919);
      A.grainPat = g.createPattern(A.grain, 'repeat');
      try { A.grainPat.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) {}
    }

    // ---- run state ----
    let sim = null, run = null, attempt = 0, started = false;
    const popups = [], puffs = [], flashes = [];

    function newRun() {
      attempt++;
      sim = createSim(planck, Object.assign({ wallX: clamp(W / 2 / L.s0, 2.0, 3.5) }, simOpts));
      sim.world.on('post-solve', onPostSolve);
      const seed = DEV && window.__UT_SEED != null ? window.__UT_SEED + attempt : ((Date.now() ^ (attempt * 2654435761)) >>> 0);
      run = {
        state: 'playing', t: 0, seed, rnd: mulberry(seed),
        recs: [], tray: [], held: null, recent: [],
        placed: 0, points: 0, shown: 0, bump: 0, mult: 1, streak: 0, bestStreak: 0, multPop: 0,
        pending: [], log: [], prevBest: best.score || 0, recordAt: -1,
        perfectToken: false, armed: false, unstableT: 0, perfectT: 0,
        arriveT: 0, emptyT: 0, overT: 0, critAt: -1, inCrit: false, zone: 0,
        cause: '', collapseT: 0, result: null, pulsed: false, newBest: false, recoveries: 0
      };
      popups.length = 0; puffs.length = 0; flashes.length = 0; notice = null;
      cam.s = L.s0;
      scoreTrack.reset();
      prevTable = 0;
      arrive(); // the first object is waiting
    }

    // ---- choosing objects: controlled randomness ----
    function tableKeff() {
      // Restoring stiffness left once the load's height is accounted for.
      const P = sim.P;
      let k = P.ballastMass * P.g * P.ballastL - P.tableMass * P.g * (P.topY - P.thick / 2);
      for (const r of run.recs) if (r.body.isActive()) k -= r.body.getMass() * P.g * Math.max(0, r.body.getWorldCenter().y);
      return k;
    }
    function canHost(def) {
      const P = sim.P;
      const k = tableKeff() - def.mass * P.g * (P.topY + (def.com ? def.com[1] : 0.25));
      if (k <= 0) return true; // the endgame: anything is risky now
      const tq = Math.abs(sim.loadTorque().torque);
      return Math.max(0, tq - def.mass * P.g * 0.45) <= k * Math.sin(CRIT) * 0.8;
    }
    function pickDef() {
      const n = run.placed + run.tray.length;
      const tiers = n < 3 ? [1] : n < 8 ? [1, 2] : [1, 2, 3];
      const wTier = { 1: n < 8 ? 1 : 0.55, 2: 1, 3: n < 14 ? 0.9 : 1.4 };
      if (n === 0) return OBJECT_BY_ID[['bowl', 'teapot', 'lidpot'][Math.floor(run.rnd() * 3)]];
      for (let tries = 0; tries < 24; tries++) {
        const pool = OBJECTS.filter(o => tiers.includes(o.tier) && !run.recent.includes(o.id));
        let tot = 0; for (const o of pool) tot += wTier[o.tier];
        let r = run.rnd() * tot, pick = pool[0];
        for (const o of pool) { r -= wTier[o.tier]; if (r <= 0) { pick = o; break; } }
        // at most one round, rolling thing waiting at once
        const rolling = o => (o.angDamp || 0) > 1;
        if (rolling(pick) && run.tray.some(t => rolling(t.def)) && tries < 20) continue;
        if (!canHost(pick) && tries < 20) continue;
        return pick;
      }
      return OBJECT_BY_ID.lemon;
    }
    function arrive() {
      const def = pickDef();
      run.recent.push(def.id); if (run.recent.length > 4) run.recent.shift();
      run.tray.push({ def, counted: false, born: run.t });
      run.arriveT = 0;
      if (run.placed > 0) audio.chime(false);
    }
    function arrivalInterval() {
      if (run.placed < 5) return Infinity;
      return Math.max(ARRIVE_MIN, ARRIVE_START - (run.placed - 5) * 0.35);
    }

    // ---- contacts: sound and paint ----
    const hits = [];
    function onPostSolve(contact, imp) {
      let n = 0;
      const ni = imp.normalImpulses;
      for (let i = 0; i < ni.length; i++) n += ni[i] || 0;
      const prev = contact.__ut || 0;
      contact.__ut = n;
      const jump = n - prev;
      if (jump <= 0) return;
      const fa = contact.getFixtureA(), fb = contact.getFixtureB();
      const ba = fa.getBody(), bb = fb.getBody();
      const ra = ba.getUserData && ba.getUserData(), rb = bb.getUserData && bb.getUserData();
      const recA = ra && ra.rec, recB = rb && rb.rec;
      const m = Math.min(recA ? ba.getMass() : 1e9, recB ? bb.getMass() : 1e9);
      if (m === 1e9) return;
      const strength = jump / (m * 2.2);
      if (strength < 0.12) return;
      hits.push({ contact, recA, recB, a: ba, b: bb, strength: Math.min(1, strength) });
    }
    function processHits() {
      for (const h of hits) {
        const wm = h.contact.getWorldManifold(null);
        const p = wm && wm.points && wm.points[0];
        const rec = h.recA || h.recB, other = h.recA ? h.recB : h.recA;
        const otherBody = h.recA ? h.b : h.a;
        const s = h.strength;
        audio.hit(rec.id, MATERIAL_SOUND[rec.def.material], s * 0.9, rec.def.box[3]);
        if (other) audio.hit(other.id + 'b', MATERIAL_SOUND[other.def.material], s * 0.5, other.def.box[3]);
        else if (otherBody === sim.table) { audio.hit('table', 'wood', s * 0.5, 0.6); if (p && s > 0.2) flashes.push({ x: sim.table.getLocalPoint(p).x, t: 0, s }); }
        if (p && s > 0.28) {
          const cols = { ceramic: PAL.cream, brass: PAL.brassLight, glass: '#ffffff', fruit: PAL.mustard, books: PAL.creamDeep, wood: PAL.ochre };
          puffs.push({ x: p.x, y: p.y, t: 0, s, c: cols[rec.def.material] || PAL.cream, seed: (run.t * 1000) | 0 });
        }
        if (s > 0.5 && rec.def.mass > 2) haptic('light');
      }
      hits.length = 0;
    }

    // ---- object records ----
    let recId = 0;
    function makeRec(def, body, counted) {
      const rec = { id: 'o' + (recId++), def, body, counted, settleT: 0, px: 0, py: 0, pa: 0, dropT: run.t };
      body.setUserData({ kind: 'object', rec });
      const p = body.getPosition(); rec.px = p.x; rec.py = p.y; rec.pa = body.getAngle();
      run.recs.push(rec);
      return rec;
    }

    // ---- scoring (rules in src/03b_score.js) ----
    // A centred notice below the HUD; a new one replaces the old so they never stack.
    let notice = null;
    function showNotice(lines, color) { notice = { lines, color: color || PAL.cream, t: 0 }; }
    function addPoints(p, kind, extra) {
      run.points += p;
      scoreTrack.set(run.points);
      run.bump = 1;
      run.log.push(Object.assign({ kind, points: p, t: +run.t.toFixed(2) }, extra || {}));
      if (run.prevBest > 0 && run.points > run.prevBest && run.recordAt < 0) { run.recordAt = run.t; audio.chime(true); haptic('success'); }
    }
    // An object has come to rest: score it once the table stops swinging.
    function onSettled(rec) {
      rec.pending = true;
      run.pending.push({ rec, t: run.t });
    }
    function scorePending() {
      while (run.pending.length) {
        const p = run.pending[0];
        const still = Math.abs(sim.angVel()) < 0.03;
        if (!still && run.t - p.t < SCORING.settleWait) return;
        run.pending.shift();
        scorePlacement(p.rec);
      }
    }
    function scorePlacement(rec) {
      rec.pending = false;
      rec.counted = true;
      run.placed++;
      run.streak++;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      const prevMult = run.mult;
      const angleDeg = sim.angle() / DEG;
      const sc = placementScore(angleDeg, run.streak);
      run.mult = sc.mult;
      if (run.mult > prevMult) run.multPop = 1;
      run.perfectToken = true;
      addPoints(sc.total, 'placement', { id: rec.def.id, angle: +angleDeg.toFixed(2), base: sc.base, bonus: sc.bonus, mult: sc.mult });
      // feedback near the object: base, balance bonus and multiplier on separate lines
      const p = rec.body.getPosition();
      const [sx, sy] = W2S(p.x, p.y + rec.def.box[3]);
      const lines = [{ text: '+' + sc.base, size: 21, color: PAL.cream }];
      if (sc.bonus) lines.push({ text: '+' + sc.bonus + ' balance', size: 15, color: PAL.mustard });
      if (sc.mult > 1) lines.push({ text: '×' + fmtMult(sc.mult) + ' steady hand', size: 15, color: PAL.creamDeep });
      placePopup(lines, sx, sy);
      haptic(sc.bonus >= 70 ? 'medium' : 'light');
      if (sc.bonus === 100) audio.chime(true);
      try { ctx.platform.interact({ kind: 'placed', id: rec.def.id }); } catch (e) {}
      if (run.placed % 10 === 0) try { ctx.platform.milestone('placed_' + run.placed); } catch (e) {}
      if (!seenHint) { seenHint = true; save('seenHint', true); }
    }
    function placePopup(lines, x, y) {
      x = clamp(x, 70, W - 70);
      y = clamp(y - 28, L.hudBottom + 40, L.trayTop - 40);
      // keep clear of a group that is still on screen
      for (const q of popups) if (q.t < 1.4 && Math.abs(q.x - x) < 110 && Math.abs(q.y - y) < 60) y = q.y - 62;
      popups.push({ lines, x, y: Math.max(L.hudBottom + 30, y), t: 0 });
    }
    const fmtMult = m => String(m);

    // ---- failure ----
    function fail(cause) {
      if (run.state !== 'playing') return;
      run.state = 'collapse';
      run.cause = cause;
      run.collapseT = 0;
      popups.length = 0; notice = null;
      if (run.held) cancelHeld(true);
      haptic('error');
      sting('lose');
      try { music && music.setIntensity(0.1, { fadeMs: 1500 }); } catch (e) {}
      audio.creak(1);
    }
    function finish() {
      run.state = 'over';
      const res = { score: run.points, placed: run.placed, streak: run.bestStreak, board: { status: 'saving', rows: [], rank: null } };
      run.result = res;
      run.prevBest = best.score || 0;
      run.newBest = res.score > run.prevBest;
      best = { score: Math.max(best.score || 0, res.score), placed: Math.max(best.placed || 0, res.placed), streak: Math.max(best.streak || 0, res.streak) };
      save('best', best);
      if (run.newBest && res.score > 0) { sting('success'); }
      try { ctx.platform.fail({ score: res.score, placed: res.placed, cause: run.cause }); } catch (e) {}
      const my = attempt;
      // Leaderboard work never blocks replay; results are fenced to this attempt.
      (async () => {
        try {
          await scoreTrack.submit('score', { label: res.score.toLocaleString() + ' pts', metadata: { placed: res.placed, streak: res.streak } });
          const lb = await scoreTrack.leaderboard('score', { scope: 'global', period: 'all_time', limit: 3 });
          if (destroyed || my !== attempt) return;
          res.board = { status: 'ok', rows: (lb && lb.rows || []).slice(0, 3), rank: lb && lb.viewerRank ? lb.viewerRank.rank : null };
        } catch (e) {
          if (destroyed || my !== attempt) return;
          res.board = { status: 'unavailable', rows: [], rank: null };
        }
      })();
    }

    // ---- input ----
    let pointerId = null, finger = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
    function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    function slotRects() {
      const n = Math.max(TRAY_CAP, run.tray.length);
      const w = (L.right - L.left) / n;
      const rects = [];
      for (let i = 0; i < n; i++) rects.push({ x: L.left + i * w, y: L.trayTop + 10, w, h: L.trayH - 10 });
      return rects;
    }
    function trayScale(def, r) {
      const ow = def.box[2] - def.box[0], oh = def.box[3] - def.box[1];
      return Math.min(r.w * 0.78 / ow, (r.h - 34) * 0.92 / oh, cam.s * 1.05);
    }

    function firstGesture() {
      audio.unlock();
      startMusic();
      if (!started) { started = true; try { ctx.platform.start({ attempt }); } catch (e) {} }
    }

    function pickAt(x, y) {
      const [wx, wy] = S2W(x, y);
      const V = planck.Vec2;
      const tol = 16 / cam.s;
      const offs = [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol], [tol * 0.7, tol * 0.7], [-tol * 0.7, tol * 0.7], [tol * 0.7, -tol * 0.7], [-tol * 0.7, -tol * 0.7]];
      for (const [dx, dy] of offs) {
        for (let i = run.recs.length - 1; i >= 0; i--) {
          const r = run.recs[i];
          if (!r.body.isActive()) continue;
          for (let f = r.body.getFixtureList(); f; f = f.getNext()) if (f.testPoint(V(wx + dx, wy + dy))) return r;
        }
      }
      return null;
    }

    function startHold(def, rec, x, y, sx, sy, scale0, trayItem) {
      run.held = {
        def, rec, trayItem, x: sx, y: sy, ang: rec ? rec.body.getAngle() : 0, scale: scale0,
        off: [sx - x, sy - y], t: 0, sway: 0
      };
      audio.pick();
      haptic('light');
    }

    ctx.listen(canvas, 'pointerdown', e => {
      const [x, y] = local(e);
      firstGesture();
      if (run.state !== 'over' && Math.hypot(x - L.mute.x, y - L.mute.y) < L.mute.r + 10) { toggleMute(); return; }
      if (run.state === 'over') {
        const b = L.replayBtn;
        if (b && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h && run.result && run.t - run.overAt > 0.5) replay();
        return;
      }
      if (run.state !== 'playing' || run.held || pointerId != null) return;
      pointerId = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      finger = { x, y, vx: 0, vy: 0, t: performance.now() };
      // from the tray?
      const rects = slotRects();
      for (let i = 0; i < run.tray.length; i++) {
        const r = rects[i];
        if (x > r.x && x < r.x + r.w && y > r.y - 14 && y < r.y + r.h) {
          const item = run.tray.splice(i, 1)[0];
          const sc = trayScale(item.def, r);
          const bx = r.x + r.w / 2, by = r.y + r.h - 36;
          startHold(item.def, null, x, y, bx, by, sc / cam.s, item);
          return;
        }
      }
      // an object already on the table?
      const rec = pickAt(x, y);
      if (rec) {
        const p = rec.body.getPosition();
        const [bx, by] = W2S(p.x, p.y);
        sim.lift(rec.body);
        if (rec.pending) { rec.pending = false; run.pending = run.pending.filter(p => p.rec !== rec); }
        rec.settleT = 0;
        startHold(rec.def, rec, x, y, bx, by, 1, null);
        return;
      }
      pointerId = null;
    });
    ctx.listen(canvas, 'pointermove', e => {
      if (e.pointerId !== pointerId) return;
      const [x, y] = local(e);
      const now = performance.now(), dt = Math.max(1, now - finger.t);
      finger.vx = lerp(finger.vx, (x - finger.x) / dt * 1000, 0.5);
      finger.vy = lerp(finger.vy, (y - finger.y) / dt * 1000, 0.5);
      finger.x = x; finger.y = y; finger.t = now;
    });
    const endPointer = cancelled => e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (!run.held) return;
      if (cancelled) cancelHeld(false); else release();
    };
    ctx.listen(canvas, 'pointerup', endPointer(false));
    ctx.listen(canvas, 'pointercancel', endPointer(true));
    ctx.listen(canvas, 'lostpointercapture', e => { if (e.pointerId === pointerId) endPointer(false)(e); });

    function toggleMute() {
      audio.setMuted(!audio.muted);
      save('muted', audio.muted);
      if (audio.muted) { try { ctx.music.stop({ fadeOutMs: 300 }); } catch (e) {} music = null; }
      else startMusic();
    }

    // Where the held object would be released, in world units.
    function heldWorld() {
      const h = run.held;
      const [wx, wy] = S2W(h.x, h.y);
      return [wx, wy];
    }
    function dropTarget() {
      const [wx, wy] = heldWorld();
      if (wy < sim.P.floorY + 0.3 || Math.abs(wx) > 4) return null;
      const surf = sim.surfaceY(wx);
      const y0 = Math.max(wy, surf + 0.03);
      const hit = sim.supportBelow(wx, y0, run.held.rec ? run.held.rec.body : null);
      if (!hit || hit.kind === 'floor') return { ok: false, x: wx, y: hit ? hit.y : sim.P.floorY };
      return { ok: true, x: wx, y: hit.y, from: y0 };
    }

    function release() {
      const h = run.held;
      const tgt = dropTarget();
      if (h.y > L.trayTop - 4 || !tgt || !tgt.ok) { cancelHeld(false); return; }
      const [wx, wy] = heldWorld();
      const y = Math.max(wy, sim.surfaceY(wx) + 0.005);
      const vx = clamp(finger.vx / cam.s * 0.15, -1.2, 1.2), vy = clamp(-finger.vy / cam.s * 0.15, -1.2, 1.2);
      if (h.rec) {
        sim.drop(h.rec.body, wx, y, vx, vy);
        h.rec.settleT = 0; h.rec.dropT = run.t;
        const p = h.rec.body.getPosition(); h.rec.px = p.x; h.rec.py = p.y; h.rec.pa = 0;
      } else {
        const body = sim.addObject(h.def, wx, y, vx, vy);
        makeRec(h.def, body, h.trayItem ? h.trayItem.counted : false);
      }
      run.held = null;
      if (run.tray.length === 0) run.emptyT = 0;
    }

    // Return what is held to the tray (or discard it after a failure).
    function cancelHeld(discard) {
      const h = run.held;
      run.held = null;
      if (h.rec) {
        const i = run.recs.indexOf(h.rec);
        if (i >= 0) run.recs.splice(i, 1);
        sim.remove(h.rec.body);
        if (!discard) run.tray.unshift({ def: h.def, counted: h.rec.counted, born: run.t });
      } else if (!discard && h.trayItem) {
        run.tray.unshift(h.trayItem);
      }
    }

    function replay() {
      newRun();
      started = true;
      try { ctx.platform.start({ attempt }); } catch (e) {}
      musicIntensity(0.25);
    }

    // ---- simulation step (fixed 60 Hz) ----
    let prevTable = 0, lastCreakAngle = 0;
    function fixedUpdate(stepMs) {
      if (!run) return;
      const dt = stepMs / 1000;
      run.t += dt;
      if (run.state === 'over') { stepWorld(); return; }
      stepWorld();
      processHits();
      if (run.state === 'collapse') {
        run.collapseT += dt;
        if (run.collapseT > 2.4) { finish(); run.overAt = run.t; }
        return;
      }
      rules(dt);
    }
    function stepWorld() {
      prevTable = sim.table.getAngle();
      for (const r of run.recs) { const p = r.body.getPosition(); r.px = p.x; r.py = p.y; r.pa = r.body.getAngle(); }
      sim.step();
    }

    function rules(dt) {
      const a = sim.angle(), aa = Math.abs(a);
      // objects: settling, scoring, falling
      for (const r of run.recs) {
        if (!r.body.isActive()) continue;
        if (sim.touchesGround(r.body) || r.body.getPosition().y < sim.P.floorY + 0.15) {
          fail(`The ${r.def.name.toLowerCase()} fell off the table.`); return;
        }
        if (!r.counted && !r.pending) {
          const v = r.body.getLinearVelocity().length(), w = Math.abs(r.body.getAngularVelocity());
          if (v < 0.08 && w < 0.25 && sim.touchesTableOrStack(r.body)) r.settleT += dt; else r.settleT = 0;
          if (r.settleT > 0.45) onSettled(r);
        }
      }
      // the table's angle
      if (aa > SAFE) {
        run.overT += dt;
        if (run.overT > GRACE) { fail('The table tipped past its safe angle.'); return; }
      } else run.overT = Math.max(0, run.overT - dt * 2);

      const zone = aa < BAL ? 0 : aa < CRIT ? 1 : 2;
      if (zone === 2 && !run.inCrit) {
        run.inCrit = true; run.critAt = run.t;
        if (run.streak > 0) showNotice([{ text: 'STREAK LOST', size: 17 }], PAL.vermilion);
        run.streak = 0; run.mult = 1;
        haptic('warning'); sting('danger');
      }
      if (run.inCrit && zone === 0) run.inCrit = false;
      scorePending();
      perfectBalance(dt, aa);
      if (zone !== run.zone) { run.zone = zone; musicIntensity([0.25, 0.45, 0.75][zone]); }
      if (aa > CRIT * 0.92 && Math.abs(a - lastCreakAngle) > 0.03) { lastCreakAngle = a; audio.creak((aa - CRIT) / (SAFE - CRIT)); }

      // arrivals
      if (run.tray.length === 0 && !(run.held && !run.held.rec)) {
        run.emptyT += dt;
        if (run.emptyT > 0.6) { arrive(); run.emptyT = 0; }
      } else if (run.tray.length < TRAY_CAP) {
        run.arriveT += dt;
        if (run.arriveT > arrivalInterval()) arrive();
      }
    }

    // Perfect Balance: the table became unstable, then was brought back
    // within 2 degrees and held there. Once per placed object, so lifting and
    // replacing pieces cannot farm it, and never while holding something.
    function perfectBalance(dt, aa) {
      if (aa >= BAL) { run.unstableT += dt; if (run.unstableT >= SCORING.unstableHold) run.armed = true; }
      else run.unstableT = 0;
      const level = aa <= SCORING.perfectWithin * DEG && Math.abs(sim.angVel()) < 0.03 && !run.held;
      if (run.armed && run.perfectToken && level) {
        run.perfectT += dt;
        if (run.perfectT >= SCORING.perfectHold) {
          run.armed = false; run.perfectToken = false; run.perfectT = 0; run.recoveries++;
          addPoints(SCORING.perfect, 'perfect', { angle: +(sim.angle() / DEG).toFixed(2) });
          showNotice([{ text: 'PERFECT BALANCE', size: 20 }, { text: '+' + SCORING.perfect, size: 26 }], PAL.mustard);
          audio.chime(true); haptic('success');
        }
      } else run.perfectT = 0;
    }

    // ---- rendering ----
    let lastFrame = performance.now();
    function render(alpha) {
      if (!run || !A) return;
      const now = performance.now();
      const fdt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      hudDt = fdt;
      updateCamera(fdt);
      updateHeld(fdt);

      g.drawImage(A.backdrop, 0, 0, W, H);
      const s = cam.s;
      // floor and stand (world-anchored)
      drawSprite(g, A.floor, L.pivotX, L.pivotY, 0, s);
      const ta = lerp(prevTable, sim.table.getAngle(), alpha);
      // table shadow on the floor
      g.save(); g.fillStyle = rgba(PAL.ink, 0.3);
      const [fx, fy] = W2S(0, sim.P.floorY + 0.01);
      g.beginPath(); g.ellipse(fx, fy, 2.3 * s * Math.cos(ta), 0.07 * s, 0, 0, TAU); g.fill(); g.restore();
      drawSprite(g, A.stand, L.pivotX, L.pivotY, 0, s);
      drawSprite(g, A.ballast, L.pivotX, L.pivotY, ta, s);
      drawSprite(g, A.table, L.pivotX, L.pivotY, ta, s);
      // table flashes: a brief pale glint where something landed
      for (const f of flashes) {
        const k = 1 - f.t / 0.35;
        if (k <= 0) continue;
        g.save(); g.translate(L.pivotX, L.pivotY); g.rotate(-ta);
        g.fillStyle = rgba(PAL.cream, 0.35 * k * f.s);
        g.beginPath(); g.ellipse(f.x * s, -sim.P.topY * s - 2, (0.12 + 0.3 * (1 - k)) * s, 3, 0, 0, TAU); g.fill();
        g.restore();
      }
      // objects
      for (const r of run.recs) {
        if (!r.body.isActive()) continue;
        const p = r.body.getPosition();
        const x = lerp(r.px, p.x, alpha), y = lerp(r.py, p.y, alpha), an = lerp(r.pa, r.body.getAngle(), alpha);
        const [sx, sy] = W2S(x, y);
        drawSprite(g, A.objs[r.def.id].spr, sx, sy, an, s);
      }
      drawPuffs(fdt);
      if (run.held) drawHeld();
      // paper grain over the painted scene
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.6; g.fillStyle = A.grainPat; g.fillRect(0, 0, W, H); g.restore();
      drawTray();
      if (run.state !== 'over') drawHUD();
      drawPopups(fdt);
      if (run.state === 'over') drawResult();
      if (run.state === 'collapse') drawCause();
      for (const f of flashes) f.t += fdt;
      while (flashes.length && flashes[0].t > 0.4) flashes.shift();
    }

    function updateCamera(dt) {
      let top = 0;
      for (const r of run.recs) {
        if (!r.body.isActive()) continue;
        const p = r.body.getPosition();
        top = Math.max(top, p.y + (r.def.box[3] - r.def.box[1]));
      }
      const avail = L.pivotY - L.hudBottom - 34;
      const target = clamp(Math.min(L.s0, avail / Math.max(0.5, top + 0.6)), L.s0 * 0.55, L.s0);
      cam.s += (target - cam.s) * Math.min(1, dt * 1.6);
    }

    function updateHeld(dt) {
      const h = run.held;
      if (!h) return;
      h.t += dt;
      const lift = 30 + (h.def.box[3] - h.def.box[1]) * cam.s * 0.08;
      const k = Math.min(1, h.t / 0.22);
      const ox = lerp(h.off[0], 0, k), oy = lerp(h.off[1], -lift, k);
      const tx = finger.x + ox, ty = finger.y + oy;
      const f = Math.min(1, dt * 22);
      h.x += (tx - h.x) * f; h.y += (ty - h.y) * f;
      h.scale += (1 - h.scale) * Math.min(1, dt * 12);
      h.ang += (0 - h.ang) * Math.min(1, dt * 12);
      h.sway += (clamp(-finger.vx * 0.00008, -0.07, 0.07) - h.sway) * Math.min(1, dt * 10);
    }

    function drawHeld() {
      const h = run.held, s = cam.s * h.scale;
      const set = A.objs[h.def.id];
      // drop guide: a dotted plumb line and a painted landing mark
      const tgt = h.y < L.trayTop - 4 ? dropTarget() : null;
      if (tgt) {
        const [gx, gy] = W2S(tgt.x, tgt.y);
        const col = tgt.ok ? PAL.cream : PAL.vermilion;
        g.save();
        g.strokeStyle = rgba(col, 0.55); g.lineWidth = 1.5; g.setLineDash([2, 5]);
        g.beginPath(); g.moveTo(h.x, h.y + 4); g.lineTo(gx, gy); g.stroke(); g.setLineDash([]);
        g.fillStyle = rgba(tgt.ok ? PAL.ink : PAL.vermilion, tgt.ok ? 0.3 : 0.4);
        const hw = (h.def.box[2] - h.def.box[0]) * 0.45 * cam.s;
        g.beginPath(); g.ellipse(gx, gy - 1, hw, 4, 0, 0, TAU); g.fill();
        g.restore();
      }
      // lift shadow, cream halo, then the object
      drawSprite(g, set.shadow, h.x + 6, h.y + 10, h.ang + h.sway, s, 0.22);
      const halo = 0.55 + 0.15 * Math.sin(run.t * 6);
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) drawSprite(g, set.halo, h.x + dx, h.y + dy, h.ang + h.sway, s, halo * 0.5);
      drawSprite(g, set.spr, h.x, h.y, h.ang + h.sway, s * 1.03);
    }

    function drawPuffs(dt) {
      for (const p of puffs) {
        p.t += dt;
        const k = p.t / 0.5;
        if (k >= 1) continue;
        const rnd = mulberry(p.seed);
        const [x, y] = W2S(p.x, p.y);
        for (let i = 0; i < 5; i++) {
          const a = Math.PI + rnd() * Math.PI, d = (6 + rnd() * 14) * (0.3 + k) * p.s;
          g.fillStyle = rgba(p.c, (1 - k) * 0.55);
          g.beginPath(); g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5 - k * 4, 1.5 + rnd() * 2.5, 1 + rnd() * 1.5, rnd() * 3, 0, TAU); g.fill();
        }
      }
      while (puffs.length && puffs[0].t > 0.5) puffs.shift();
    }

    function drawTray() {
      g.drawImage(A.tray, 0, L.trayTop - 8, W, H - L.trayTop + 24);
      const rects = slotRects();
      for (let i = 0; i < rects.length && run.state !== 'over'; i++) {
        const r = rects[i];
        const item = run.tray[i];
        const cx = r.x + r.w / 2;
        if (!item) {
          g.save(); g.strokeStyle = rgba(PAL.cream, 0.12); g.setLineDash([3, 6]); g.lineWidth = 1.2;
          g.beginPath(); g.ellipse(cx, r.y + r.h - 36, r.w * 0.28, 6, 0, 0, TAU); g.stroke(); g.restore();
          continue;
        }
        const age = run.t - item.born;
        const slide = age < 0.4 ? Math.pow(1 - age / 0.4, 3) : 0;
        const sc = trayScale(item.def, r);
        const by = r.y + r.h - 36;
        drawSprite(g, A.objs[item.def.id].spr, cx + slide * W * 0.6, by - Math.sin(age * 2.2 + i) * 1.2, 0, sc);
        drawWeight(cx + slide * W * 0.6, by + 18, item.def.weight);
      }
      // first-time guidance
      if (run.state === 'playing' && run.placed === 0 && !run.held && run.recs.length === 0) {
        g.save();
        g.font = F(17, true); g.textAlign = 'center'; g.fillStyle = PAL.cream;
        g.shadowColor = 'rgba(30,5,10,0.8)'; g.shadowBlur = 6;
        g.fillText('Drag an object. Keep the table balanced.', W / 2, L.trayTop - 18);
        g.restore();
        if (!seenHint && run.tray.length) {
          // a ghost finger travelling from the first slot to the table
          const r = rects[0];
          const cyc = (run.t % 2.6) / 2.6;
          const k = clamp((cyc - 0.15) / 0.6, 0, 1), e = k * k * (3 - 2 * k);
          const [tx, ty] = W2S(-0.9, sim.P.topY + 0.3);
          const x = lerp(r.x + r.w / 2, tx, e), y = lerp(r.y + r.h - 50, ty, e);
          const alpha = cyc < 0.1 ? cyc * 10 : cyc > 0.85 ? (1 - cyc) / 0.15 : 1;
          g.save(); g.globalAlpha = alpha * 0.8;
          g.fillStyle = rgba(PAL.cream, 0.85); g.beginPath(); g.ellipse(x, y, 11, 11, 0, 0, TAU); g.fill();
          g.strokeStyle = rgba(PAL.ink, 0.6); g.lineWidth = 1.5; g.stroke();
          g.restore();
        }
      }
    }

    // Weight cue: one, two or three small brass weights and a word.
    function drawWeight(x, y, w) {
      const n = w === 'heavy' ? 3 : w === 'medium' ? 2 : 1;
      const total = n * 11 + (n - 1) * 3;
      g.save();
      for (let i = 0; i < n; i++) {
        const wx = x - total / 2 + i * 14 + 5.5;
        g.fillStyle = PAL.brass; g.strokeStyle = PAL.brassDark; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(wx - 5.5, y + 4); g.lineTo(wx + 5.5, y + 4); g.lineTo(wx + 3.5, y - 4); g.lineTo(wx - 3.5, y - 4); g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(wx, y - 6, 2, 2, 0, 0, TAU); g.stroke();
        g.fillStyle = rgba(PAL.brassLight, 0.8); g.fillRect(wx - 3, y - 2.5, 1.4, 5);
      }
      g.font = F(12, true); g.textAlign = 'center'; g.fillStyle = rgba(PAL.cream, 0.85);
      g.fillText(w, x, y + 18);
      g.restore();
    }

    // Small-caps labels: tracked out by hand (canvas letterSpacing is not
    // available in every WebView).
    function spaced(text, x, y, size, color, align, track = 0.14) {
      g.font = F(size); g.fillStyle = color;
      const sp = size * track;
      let w = 0; for (const ch of text) w += g.measureText(ch).width + sp; w -= sp;
      let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      const old = g.textAlign; g.textAlign = 'left';
      for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; }
      g.textAlign = old;
      return w;
    }
    function fitFont(text, size, maxW, italic) {
      g.font = F(size, italic);
      const w = g.measureText(text).width;
      return w > maxW ? Math.max(14, size * maxW / w) : size;
    }

    // HUD: score (primary) top left, the balance gauge top centre with the
    // steady-hand plate under it, the personal best top right.
    let hudDt = 0;
    function drawHUD() {
      const dt = hudDt;
      g.save();
      g.textBaseline = 'alphabetic';
      const G = L.gauge;
      // score, counting up smoothly
      const diff = run.points - run.shown;
      run.shown = Math.abs(diff) < 1 ? run.points : run.shown + diff * Math.min(1, dt * 7);
      run.bump = Math.max(0, run.bump - dt * 2.5);
      const scoreTxt = Math.round(run.shown).toLocaleString();
      const maxW = G.x - G.r - 18 - L.left;
      g.shadowColor = 'rgba(25,4,9,0.75)'; g.shadowBlur = 6;
      spaced('SCORE', L.left + 1, L.top + 13, 12.5, rgba(PAL.creamDeep, 0.85), 'left');
      const fs = fitFont(scoreTxt, 42, maxW);
      g.save();
      const k = 1 + 0.08 * Math.sin(Math.min(1, run.bump) * Math.PI);
      g.translate(L.left, L.top + 52); g.scale(k, k);
      g.font = F(fs); g.textAlign = 'left'; g.fillStyle = PAL.cream;
      g.fillText(scoreTxt, 0, 0);
      g.restore();
      spaced(`${run.placed} ${run.placed === 1 ? 'OBJECT' : 'OBJECTS'}`, L.left + 1, L.top + 76, 13, rgba(PAL.cream, 0.82), 'left');
      // personal best
      const record = run.recordAt >= 0;
      spaced('BEST', L.right, L.top + 13, 12.5, rgba(PAL.creamDeep, 0.85), 'right');
      const bestVal = Math.max(run.prevBest, Math.round(run.shown));
      const bfs = fitFont(bestVal.toLocaleString(), 22, W - (G.x + G.r + 18) - (W - L.right));
      g.font = F(bfs); g.textAlign = 'right'; g.fillStyle = record ? PAL.mustard : rgba(PAL.cream, 0.9);
      g.fillText(bestVal.toLocaleString(), L.right, L.top + 38);
      g.shadowBlur = 0;
      if (record) {
        const age = run.t - run.recordAt;
        g.shadowColor = 'rgba(25,4,9,0.75)'; g.shadowBlur = 5;
        spaced('NEW RECORD', L.right, L.top + 55, 11.5, PAL.vermilion, 'right');
        g.shadowBlur = 0;
        if (age < 1.2) { // a few flecks of gold paint around the number
          const rnd = mulberry(77);
          for (let i = 0; i < 7; i++) {
            const a = rnd() * TAU, d = 14 + age * 30 * (0.6 + rnd() * 0.6);
            g.fillStyle = rgba(i % 2 ? PAL.mustard : PAL.cream, 1 - age / 1.2);
            g.beginPath(); g.ellipse(L.right - 26 + Math.cos(a) * d, L.top + 30 + Math.sin(a) * d * 0.6, 2.2, 1.4, a, 0, TAU); g.fill();
          }
        }
      }
      drawMute();
      drawGauge(dt);
      drawSteadyHand(dt);
      g.restore();
    }

    function drawMute() {
      const m = L.mute;
      g.save();
      g.translate(m.x, m.y);
      g.fillStyle = rgba(PAL.burgundyDeep, 0.55); g.strokeStyle = rgba(PAL.brass, 0.7); g.lineWidth = 1.4;
      g.beginPath(); g.arc(0, 0, m.r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = PAL.cream;
      g.beginPath(); g.moveTo(-7, -3); g.lineTo(-3, -3); g.lineTo(2, -7); g.lineTo(2, 7); g.lineTo(-3, 3); g.lineTo(-7, 3); g.closePath(); g.fill();
      g.strokeStyle = PAL.cream; g.lineWidth = 1.5;
      if (audio.muted) { g.beginPath(); g.moveTo(5, -4); g.lineTo(10, 4); g.moveTo(10, -4); g.lineTo(5, 4); g.stroke(); }
      else { g.beginPath(); g.arc(3, 0, 5, -0.8, 0.8); g.stroke(); g.beginPath(); g.arc(3, 0, 8.5, -0.8, 0.8); g.stroke(); }
      g.restore();
    }

    // The balance gauge: an antique brass half dial on a cream face. The
    // needle follows the table's actual angle (lightly smoothed); the band
    // for the current state is drawn full strength, the others faded; a
    // vermilion ring fills while the table is past its safe angle.
    const ZONES = [
      { name: 'BALANCED', fill: PAL.olive, text: PAL.cream },
      { name: 'UNSTABLE', fill: PAL.ochre, text: PAL.ink },
      { name: 'CRITICAL', fill: PAL.vermilion, text: PAL.cream }
    ];
    let gaugeAng = 0;
    function drawGauge(dt) {
      const G = L.gauge, r = G.r;
      const span = 72 * DEG; // dial half-range drawn for the safe angle
      const toDial = ang => clamp(-ang / SAFE, -1.22, 1.22) * span; // right side down => needle right
      const ang = sim.angle();
      gaugeAng += (ang - gaugeAng) * Math.min(1, dt * 16);
      const aa = Math.abs(ang);
      const zone = aa < BAL ? 0 : aa < CRIT ? 1 : 2;
      g.save();
      g.translate(G.x, G.y);
      const top = -Math.PI;
      // brass frame: dark bevel, body, highlight on the upper left
      g.lineCap = 'butt';
      g.fillStyle = PAL.cream;
      g.beginPath(); g.arc(0, 0, r + 6, top, 0); g.lineTo(r + 6, 6); g.lineTo(-r - 6, 6); g.closePath(); g.fill();
      g.fillStyle = rgba(PAL.creamDeep, 0.6);
      g.beginPath(); g.arc(0, 0, r * 0.45, top, 0); g.closePath(); g.fill();
      g.strokeStyle = PAL.brassDark; g.lineWidth = 7;
      g.beginPath(); g.arc(0, 0, r + 9, top - 0.02, 0.02); g.lineTo(r + 9, 9); g.lineTo(-r - 9, 9); g.closePath(); g.stroke();
      g.strokeStyle = PAL.brass; g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, r + 9, top - 0.02, 0.02); g.lineTo(r + 9, 9); g.lineTo(-r - 9, 9); g.closePath(); g.stroke();
      g.strokeStyle = rgba(PAL.brassLight, 0.9); g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, r + 10, Math.PI * 1.08, Math.PI * 1.42); g.stroke();
      // zone bands
      const b = BAL / SAFE * span, c = CRIT / SAFE * span, e = span * 1.22;
      const band = (a0, a1, z) => {
        g.strokeStyle = rgba(ZONES[z].fill, zone === z ? 1 : 0.5);
        g.lineWidth = zone === z ? 8 : 6;
        g.beginPath(); g.arc(0, 0, r - 3, -Math.PI / 2 + a0, -Math.PI / 2 + a1); g.stroke();
      };
      band(-b, b, 0); band(b, c, 1); band(-c, -b, 1); band(c, e, 2); band(-e, -c, 2);
      // ticks every quarter of the safe range, longer at the safe-angle marks
      g.strokeStyle = PAL.ink; g.lineCap = 'round';
      for (let i = -4; i <= 4; i++) {
        const a = -Math.PI / 2 + i / 4 * span, long = Math.abs(i) === 4 || i === 0;
        g.lineWidth = long ? 2 : 1.2;
        g.beginPath(); g.moveTo(Math.cos(a) * (r - (long ? 14 : 11)), Math.sin(a) * (r - (long ? 14 : 11))); g.lineTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8)); g.stroke();
      }
      // grace ring while past the safe angle
      if (run.overT > 0) {
        g.strokeStyle = PAL.vermilion; g.lineWidth = 3.5;
        g.beginPath(); g.arc(0, 0, r + 15, top, top + Math.PI * clamp(run.overT / GRACE, 0, 1)); g.stroke();
      }
      // needle: tapered ink blade with a brass hub; the tip takes the state colour
      const na = -Math.PI / 2 + toDial(gaugeAng);
      g.save(); g.rotate(na + Math.PI / 2);
      g.fillStyle = 'rgba(30,10,8,0.25)';
      g.beginPath(); g.moveTo(-3.2 + 1.5, 2); g.lineTo(1.5, -(r - 5) + 2); g.lineTo(3.2 + 1.5, 2); g.closePath(); g.fill();
      g.fillStyle = PAL.ink;
      g.beginPath(); g.moveTo(-3.4, 4); g.lineTo(0, -(r - 5)); g.lineTo(3.4, 4); g.closePath(); g.fill();
      g.fillStyle = ZONES[zone].fill;
      g.beginPath(); g.moveTo(-1.6, -(r - 18)); g.lineTo(0, -(r - 5)); g.lineTo(1.6, -(r - 18)); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = PAL.brass; g.beginPath(); g.arc(0, 0, 5.5, 0, TAU); g.fill();
      g.strokeStyle = PAL.brassDark; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = PAL.brassLight; g.beginPath(); g.arc(-1.5, -1.5, 1.6, 0, TAU); g.fill();
      // state plate
      const Z = ZONES[zone];
      const pulse = zone === 2 ? 0.75 + 0.25 * Math.sin(run.t * 9) : 1;
      g.font = F(12.5);
      const pw = 96, ph = 21, py = 15;
      g.globalAlpha = pulse;
      g.fillStyle = Z.fill; roundRect(-pw / 2, py, pw, ph, 10.5); g.fill();
      g.strokeStyle = rgba(PAL.brassDark, 0.9); g.lineWidth = 1.2; g.stroke();
      g.globalAlpha = 1;
      spaced(Z.name, 0, py + 15, 12.5, Z.text, 'center', 0.16);
      g.restore();
    }

    // "STEADY HAND x1.5" under the gauge while a multiplier is active.
    function drawSteadyHand(dt) {
      run.multPop = Math.max(0, run.multPop - dt * 2.2);
      if (run.mult <= 1 || run.state !== 'playing') return;
      const G = L.gauge;
      const y = G.y + 50;
      const k = 1 + 0.18 * Math.sin(Math.min(1, run.multPop) * Math.PI);
      g.save();
      g.translate(G.x, y); g.scale(k, k);
      const txt = 'STEADY HAND  ×' + fmtMult(run.mult);
      g.globalAlpha = 0; // measure first
      const tw = spaced(txt, 0, 1, 12.5, PAL.mustard, 'center', 0.1);
      g.globalAlpha = 1;
      g.fillStyle = rgba(PAL.burgundyDeep, 0.7);
      roundRect(-tw / 2 - 12, -15, tw + 24, 22, 11); g.fill();
      g.strokeStyle = rgba(PAL.mustard, 0.6); g.lineWidth = 1; g.stroke();
      spaced(txt, 0, 1, 12.5, PAL.mustard, 'center', 0.1);
      g.restore();
    }

    // Placement feedback groups (lines fade in one after another and rise)
    // and the single centred notice.
    function drawPopups(dt) {
      for (const p of popups) {
        p.t += dt;
        const life = 1.9;
        if (p.t >= life) continue;
        p.lines.forEach((ln, i) => {
          const t = p.t - i * 0.22;
          if (t <= 0) return;
          const k = t / (life - i * 0.22);
          g.save();
          g.globalAlpha = Math.min(1, t * 8) * (1 - Math.max(0, (k - 0.65) / 0.35));
          g.font = F(ln.size, i > 0); g.textAlign = 'center'; g.lineJoin = 'round';
          const ty = p.y + i * 19 - k * 22;
          g.strokeStyle = 'rgba(30,6,12,0.8)'; g.lineWidth = 3.5; g.strokeText(ln.text, p.x, ty);
          g.fillStyle = ln.color; g.fillText(ln.text, p.x, ty);
          g.restore();
        });
      }
      while (popups.length && popups[0].t > 1.9) popups.shift();
      if (notice) {
        notice.t += dt;
        const n = notice, life = 2.0;
        if (n.t > life) { notice = null; return; }
        const a = Math.min(1, n.t * 6) * (1 - Math.max(0, (n.t - 1.5) / 0.5));
        const k = 1 + 0.15 * Math.max(0, 1 - n.t * 5);
        g.save();
        g.globalAlpha = a;
        g.translate(W / 2, L.hudBottom + 30); g.scale(k, k);
        g.shadowColor = 'rgba(25,4,9,0.9)'; g.shadowBlur = 8;
        let y = 0;
        n.lines.forEach((ln, i) => {
          if (i === 0) spaced(ln.text, 0, y, ln.size, n.color, 'center', 0.12);
          else { g.font = F(ln.size); g.textAlign = 'center'; g.fillStyle = PAL.cream; g.fillText(ln.text, 0, y); }
          y += ln.size + 8;
        });
        g.restore();
      }
    }

    function drawCause() {
      const k = clamp(run.collapseT / 0.5, 0, 1);
      g.save(); g.globalAlpha = k;
      g.font = F(19, true); g.textAlign = 'center'; g.fillStyle = PAL.cream;
      g.shadowColor = 'rgba(25,4,9,0.9)'; g.shadowBlur = 8;
      g.fillText(run.cause, W / 2, L.hudBottom + 30, W - 32);
      g.restore();
    }

    // Result: a small parchment certificate in the headroom above the table
    // (the collapsed still life stays in view below it) and Play again in the
    // tray zone. The score counts up, then a wax seal marks a new best.
    function drawResult() {
      const res = run.result;
      const t = run.t - run.overAt;
      const k = clamp(t / 0.5, 0, 1), e = 1 - Math.pow(1 - k, 3);
      const cw = Math.min(L.right - L.left, 360), ch = 252;
      const cx = W / 2 - cw / 2, cy = L.top - (1 - e) * 26;
      g.save();
      g.globalAlpha = e;
      if (!A.card || A.card.w !== cw || A.card.h !== ch) A.card = paintCard(cw, ch);
      g.drawImage(A.card.c, cx - 6, cy - 6, cw + 12, ch + 12);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      spaced('THE UNSTABLE TABLE', W / 2, cy + 30, 12, PAL.burgundy, 'center', 0.22);
      g.font = F(fitFont(run.cause, 14.5, cw - 36, true), true); g.fillStyle = PAL.umber;
      g.fillText(run.cause, W / 2, cy + 50);
      // final score, counting up
      const ct = clamp((t - 0.25) / 0.9, 0, 1), ce = 1 - Math.pow(1 - ct, 3);
      g.font = F(56); g.fillStyle = PAL.ink;
      g.fillText(Math.round(res.score * ce).toLocaleString(), W / 2, cy + 110);
      g.font = F(14, true); g.fillStyle = PAL.wine;
      if (run.newBest && res.score > 0) {
        if (run.prevBest > 0) g.fillText('previous best ' + run.prevBest.toLocaleString(), W / 2, cy + 132);
      } else g.fillText('best ' + best.score.toLocaleString(), W / 2, cy + 132);
      // divider
      g.strokeStyle = rgba(PAL.ochre, 0.8); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx + 40, cy + 146); g.lineTo(W / 2 - 8, cy + 146); g.moveTo(W / 2 + 8, cy + 146); g.lineTo(cx + cw - 40, cy + 146); g.stroke();
      g.fillStyle = PAL.ochre; g.beginPath(); g.ellipse(W / 2, cy + 146, 3, 3, 0, 0, TAU); g.fill();
      // objects placed and best streak
      const stats = [['OBJECTS PLACED', res.placed], ['BEST STREAK', res.streak]];
      for (let i = 0; i < 2; i++) {
        const sx = cx + cw * (i === 0 ? 0.3 : 0.7);
        g.font = F(26); g.fillStyle = PAL.ink; g.textAlign = 'center'; g.fillText(String(stats[i][1]), sx, cy + 180);
        spaced(stats[i][0], sx, cy + 197, 11.5, PAL.wine, 'center', 0.14);
      }
      // compact leaderboard: top three and the viewer's rank when known
      g.font = F(13, true); g.fillStyle = PAL.umber; g.textAlign = 'center';
      const bd = res.board;
      let line = '';
      if (bd.status === 'saving') line = 'saving to the leaderboard…';
      else if (bd.status === 'unavailable') line = 'leaderboard unavailable right now';
      else line = bd.rows.map(r => `${r.rank}. ${shortName(r)} ${Number(r.value).toLocaleString()}`).join('   ') || 'no scores yet';
      if (bd.status === 'ok' && bd.rank) line += `   ·   you #${bd.rank}`;
      g.fillText(line, W / 2, cy + 228, cw - 28);
      // wax seal for a new best
      if (run.newBest && res.score > 0 && t > 1.1) {
        const st = clamp((t - 1.1) / 0.28, 0, 1);
        const sc = lerp(1.7, 1, 1 - Math.pow(1 - st, 2));
        g.save();
        g.globalAlpha = e * st;
        g.translate(cx + cw - 50, cy + 92); g.rotate(-0.18); g.scale(sc, sc);
        g.fillStyle = PAL.tomato;
        g.beginPath();
        for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU, rr = 31 + (i % 2 ? 2.5 : 0); i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(rr, 0); }
        g.fill();
        g.fillStyle = PAL.vermilion; g.beginPath(); g.arc(0, 0, 25, 0, TAU); g.fill();
        g.strokeStyle = rgba(PAL.cream, 0.7); g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, 21, 0, TAU); g.stroke();
        spaced('NEW', 0, -2, 12, PAL.cream, 'center', 0.12);
        spaced('BEST', 0, 12, 12, PAL.cream, 'center', 0.12);
        g.restore();
      }
      g.restore();
      // Play again, in the tray zone, fading in after the certificate
      const bk = clamp((t - 0.45) / 0.35, 0, 1);
      const bw = Math.min(260, W - 70), bh = 58;
      const b = { x: W / 2 - bw / 2, y: L.trayTop + (L.bottom - L.trayTop - bh) / 2 + 4, w: bw, h: bh };
      L.replayBtn = b;
      const breathe = 1 + 0.015 * Math.sin(t * 2.4);
      g.save();
      g.globalAlpha = bk;
      g.translate(W / 2, b.y + bh / 2); g.scale(breathe, breathe); g.translate(-W / 2, -(b.y + bh / 2));
      g.fillStyle = 'rgba(30,6,12,0.4)'; roundRect(b.x + 3, b.y + 5, b.w, b.h, 29); g.fill();
      g.fillStyle = PAL.vermilion; roundRect(b.x, b.y, b.w, b.h, 29); g.fill();
      g.strokeStyle = PAL.brassDark; g.lineWidth = 2; g.stroke();
      g.strokeStyle = rgba(PAL.cream, 0.45); g.lineWidth = 1.5; roundRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10, 24); g.stroke();
      g.fillStyle = PAL.cream; g.font = F(23); g.textAlign = 'center';
      g.fillText('Play again', W / 2, b.y + 37);
      g.restore();
      if (!run.pulsed && t > 1.6) {
        run.pulsed = true;
        if (res.placed >= 3) try { ctx.pulse.complete({ score: res.score, text: `Balanced ${res.placed} curiosities on The Unstable Table`, mode: 'endless' }); } catch (e) {}
      }
    }
    function shortName(r) {
      const n = r.displayName || r.username || r.name || r.displayLabel || '';
      return n.length > 10 ? n.slice(0, 9) + '…' : n;
    }
    function roundRect(x, y, w, h, rr) {
      g.beginPath(); g.moveTo(x + rr, y); g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr); g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr); g.closePath();
    }
    function paintCard(w, h) {
      const dpr = dprOf();
      const c = makeBuffer((w + 12) * dpr, (h + 12) * dpr);
      const cg = c.getContext('2d');
      cg.scale(dpr, dpr); cg.translate(6, 6);
      const rnd = mulberry(5150);
      const B = makeBrush(cg, rnd, 1);
      const p = handPoly([[0, 0], [w, 0], [w, h], [0, h]], 2.5, rnd);
      B.gouache(p, { base: PAL.cream, box: [0, 0, w, h], washes: [PAL.creamDeep, '#f7ecd2'], strokeAngle: 0, strokes: 40, strokeLen: w * 0.4, shadow: 0.15, lit: 0.1, bottomShade: false, edgeColor: PAL.umber });
      B.stroke([[14, 10], [w - 14, 11]], PAL.vermilion, 2, 0.6, 1);
      B.stroke([[14, h - 9], [w - 14, h - 10]], PAL.vermilion, 2, 0.6, 1);
      return { c, w, h };
    }

    // ---- start ----
    layout();
    const t0 = performance.now();
    buildAssets();
    if (DEV) console.log('assets painted in', Math.round(performance.now() - t0), 'ms');
    newRun();
    ctx.onResize(() => { layout(); buildAssets(); }, { immediate: false, debounceMs: 120 });
    fontLoads.then(() => {});

    const loop = ctx.game.loop({ fixedHz: 60, maxSubsteps: 4, fixedUpdate, render });
    render(1);
    ctx.markVisualReady('table-painted');
    ctx.platform.ready();

    if (DEV) {
      window.__UT = {
        get sim() { return sim; }, get run() { return run; }, get A() { return A; }, OBJECT_BY_ID, OBJECTS, L, cam, W2S, S2W, loop,
        place(id, x, yAbove = 0.01) { const def = OBJECT_BY_ID[id]; const b = sim.addObject(def, x, sim.surfaceY(x) + yAbove); return makeRec(def, b, false); },
        angleDeg: () => sim.angle() / DEG,
        restart: () => newRun(),
        score: (a, n) => placementScore(a, n),
        step(n) { for (let i = 0; i < n; i++) fixedUpdate(1000 / 60); }
      };
    }
  }
};
