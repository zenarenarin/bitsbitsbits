// =====================================================================
// THE LAST LIGHT ON THE STREET — the game: input, the run, captures and
// marks, the HUD, title, pause, result and the Plethora lifecycle.
// =====================================================================
const SAVE_KEY = 'lastlight_v1';
const SCORE = { base: 10000, perSecond: 40, perSeen: 250, perAlarm: 500, perCapture: 1500, floor: 100, perMetre: 10, escapeMin: 1500 };
// While running, the score is the distance reached (10 points a metre, at most ~1,420).
// An escape scores at least escapeMin, so any escape outranks any capture.
const LAMP_NAME = { tower: 'the tower searchlight', bracket: 'the wall lamp', lantern: 'the lantern', post: 'the lamppost', door: 'the open doorway' };

const UI_CSS = `
.ll{position:absolute;inset:0;font-family:Inter,system-ui,sans-serif;color:#ece7dc;user-select:none;-webkit-user-select:none;pointer-events:none;
  --top:max(var(--plethora-content-safe-top,0px),64px);--bot:max(var(--plethora-content-safe-bottom,120px),120px)}
.ll-play{position:absolute;left:calc(var(--plethora-content-safe-left,0px) + 26px);top:calc(var(--top) + 16px + 188px);pointer-events:auto;border:0;background:#ece7dc;color:#0d0d0c;font:600 15px Inter,system-ui,sans-serif;padding:13px 30px;cursor:pointer}
.ll-play:active{opacity:.85}
.ll *{box-sizing:border-box}
.ll-panel{position:absolute;inset:0;display:none;flex-direction:column;justify-content:flex-end;align-items:center;padding:calc(var(--top) + 16px) 16px calc(var(--bot) + 16px);background:rgba(13,13,12,.62)}
.ll-panel.on{display:flex}
.ll-card{width:100%;max-width:380px;pointer-events:auto;background:#ece7dc;color:#0d0d0c;padding:24px 20px 20px;box-shadow:0 0 0 1px #0d0d0c,0 0 0 5px #ece7dc,0 0 0 6px #0d0d0c}
.ll-h{font-family:'DM Serif Display',Georgia,serif;font-size:34px;line-height:1.05;margin:0}
.ll-it{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:20px;line-height:1.2;margin:4px 0 0;opacity:.85}
.ll-rule{height:1px;background:#0d0d0c;margin:16px 0}
.ll-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;text-align:left}
.ll-stats div{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
.ll-stats b{display:block;text-transform:none;font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:22px;letter-spacing:0;opacity:1;margin-bottom:2px;font-variant-numeric:tabular-nums}
.ll-score{display:flex;align-items:baseline;justify-content:space-between;margin-top:16px}
.ll-score b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:44px;line-height:1;font-variant-numeric:tabular-nums}
.ll-score span{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.ll-note{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;margin-top:4px;min-height:20px}
.ll-board{font-size:13px;margin-top:8px}
.ll-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(13,13,12,.15);font-variant-numeric:tabular-nums}
.ll-row.me{font-weight:600}
.ll-dim{opacity:.6;font-size:12px;padding:4px 0}
.ll-b{display:block;width:100%;margin-top:8px;padding:14px;border:0;background:#0d0d0c;color:#ece7dc;font:600 12px Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;pointer-events:auto;cursor:pointer}
.ll-b.sec{background:transparent;color:#0d0d0c;box-shadow:inset 0 0 0 1px #0d0d0c}
.ll-b:active{opacity:.8}
.ll-keys{font-size:12px;line-height:1.6;margin-top:12px;opacity:.75}
.ll-why{font-size:15px;line-height:1.45;margin:0}
.ll-tip{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;line-height:1.3;margin:10px 0 0}
.ll-break{font-size:11px;line-height:1.5;opacity:.7;margin-top:6px;font-variant-numeric:tabular-nums}
`;

window.plethoraBit = {
  meta: { title: 'The Last Light on the Street', runtime: 'plethora-bit@2' },
  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });
    const tune = (id, d) => { try { const v = ctx.tune && ctx.tune.number(id); return Number.isFinite(v) ? v : d; } catch (e) { return d; } };
    const safe = fn => { try { return fn(); } catch (e) { return undefined; } };
    // Layout area: ctx.contentSafeArea ?? ctx.safeArea, never smaller than the
    // documented reserves (the 120px content-safe-bottom fallback, and room for
    // a camera cutout/island at the top) even if a host reports smaller insets.
    const SAFE_MIN = { top: 64, bottom: 120 };
    const area = () => {
      const a = ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, right: 0, bottom: 120, left: 0 };
      return { top: Math.max(a.top || 0, SAFE_MIN.top), right: a.right || 0, bottom: Math.max(a.bottom || 0, SAFE_MIN.bottom), left: a.left || 0 };
    };

    // fonts: wanted, not required
    safe(() => ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }));
    safe(() => ctx.loadFont('Cormorant Garamond', 'cormorant-garamond', '1.0.0', { weight: '300', style: 'italic' }).catch(() => { }));
    safe(() => ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '600', style: 'normal' }).catch(() => { }));
    safe(() => ctx.loadFont('Inter', 'inter', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }));

    // ---- persistence (device-local conveniences)
    let save = { best: 0, bestTime: 0, runs: 0, sound: true };
    if (caps.storage) { const s = safe(() => ctx.storage.get(SAVE_KEY)); if (s && typeof s === 'object') save = Object.assign(save, s); }
    const persist = () => { if (caps.storage) safe(() => ctx.storage.set(SAVE_KEY, save)); };

    // ---- the world
    Object.assign(MOVE, { run: tune('run_speed', MOVE.run), jumpH: tune('jump_height', MOVE.jumpH) });
    Object.assign(WATCH, { notice: tune('notice_time', WATCH.notice), lock: tune('lock_time', WATCH.lock), lockHunt: tune('lock_time', WATCH.lock) * 0.7 });
    const level = buildLevel();
    const lampPace = tune('lamp_pace', 1);
    for (const l of level.lights) l.period /= lampPace;
    const world = createWorld(level);
    world.holdScale = tune('awning_hold', 1);
    const optics = createOptics(level);
    const player = createPlayer(world);
    const watcher = createWatcher(level, optics, world);
    const dynOcc = [];
    world.dynamicOccluders(dynOcc, 0); optics.setDynamic(dynOcc);

    // ---- surfaces
    const canvas = ctx.createCanvas2D({ maxDpr: 1.5, layer: 'content', input: 'auto', touchAction: 'none' });
    const ui = ctx.createRoot({ className: 'll', layer: 'overlay', input: 'passthrough' });
    const style = document.createElement('style'); style.textContent = UI_CSS; ui.appendChild(style);
    const R = createRenderer(canvas, level, world, optics, watcher, () => {
      const c = ctx.createCanvas2D({ layer: 'background', order: -100, input: 'passthrough' });
      c.style.display = 'none';
      return c;
    });
    const audio = createAudio(); audio.on = save.sound;
    const g = canvas.getContext('2d');
    let dpr = 1, W = 1, H = 1;
    let controlsH = 150;
    function layout() {
      W = ctx.width; H = ctx.height;
      dpr = canvas.width / Math.max(1, W) || 1;
      const a = area();
      controlsH = W > H * 1.2 ? 0 : 150;
      R.layout(W, H, dpr, a, controlsH);
      R.follow(player, 1, true);
      placeControls();
    }

    // ---- input: keyboard, and touch drawn on the canvas
    const key = {};
    const I = { mx: 0, my: 0, jumpPressed: false, jumpHeld: false, actPressed: false };
    const touch = { stick: null, jump: null, act: null };
    const btn = { jump: { x: 0, y: 0, r: 38 }, act: { x: 0, y: 0, r: 28 }, pause: { x: 0, y: 0, r: 20 } };
    // The usable band: below the top inset and above both the bottom inset
    // and Plethora's logo button, with a 16px margin from each.
    function bottomLimit() {
      const a = area(), logo = ctx.logoArea;
      let b = H - a.bottom;
      if (logo && logo.height > 0) b = Math.min(b, logo.y);
      return b - 16;
    }
    function inReservedZone(x, y) {
      const a = area(), logo = ctx.logoArea;
      if (y > H - a.bottom || y < a.top) return true;
      if (logo && logo.width > 0 && x > logo.x - 8 && x < logo.x + logo.width + 8 && y > logo.y - 8 && y < logo.y + logo.height + 8) return true;
      return false;
    }
    function placeControls() {
      const a = area(), b = bottomLimit();
      btn.jump.x = W - a.right - 16 - btn.jump.r; btn.jump.y = b - btn.jump.r - 8;
      btn.act.x = btn.jump.x - 78; btn.act.y = btn.jump.y - 30;
      // clear of the top inset: centre at a.top + 16 + 20 + 16, so its top edge sits a.top + 32
      btn.pause.x = W - a.right - 16 - btn.pause.r; btn.pause.y = a.top + 16 + 20 + 16;
      touch.home = { x: a.left + 16 + 56, y: b - 56 - 8 };
    }
    const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', Space: 'j', KeyK: 'j', KeyZ: 'j', KeyE: 'a', KeyJ: 'a', KeyX: 'a', Enter: 'enter', Escape: 'esc', KeyP: 'esc', KeyR: 'restart' };
    ctx.listen(window, 'keydown', e => {
      const k = KEYMAP[e.code]; if (!k) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (key[k]) return;
      key[k] = true;
      if (k === 'j') { I.jumpPressed = true; }
      if (k === 'a') I.actPressed = true;
      if (mode === 'title' && (k === 'j' || k === 'enter')) beginRun();
      else if (k === 'esc') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
      else if (k === 'restart' && (mode === 'play' || mode === 'paused')) { resume(); respawn(false); }
      else if (mode === 'result' && (k === 'enter' || k === 'j')) beginRun();
      else if (mode === 'caughtCard' && (k === 'enter' || k === 'j')) retryFromMark();
      else if (mode === 'caughtCard' && k === 'restart') beginRun();
    });
    ctx.listen(window, 'keyup', e => { const k = KEYMAP[e.code]; if (k) key[k] = false; });
    ctx.listen(window, 'blur', () => { for (const k in key) key[k] = false; });

    const hit = (b, x, y, pad) => Math.hypot(x - b.x, y - b.y) <= b.r + (pad || 12);
    ctx.listen(canvas, 'pointerdown', e => {
      const x = e.offsetX, y = e.offsetY;
      safe(() => canvas.setPointerCapture(e.pointerId));
      audio.unlock();
      if (mode === 'title') { beginRun(); return; }
      if (mode !== 'play') return;
      // never act on touches under the insets or on the logo button
      if (inReservedZone(x, y)) return;
      if (hit(btn.pause, x, y, 10)) { pause(); return; }
      if (hit(btn.jump, x, y, 18)) { touch.jump = e.pointerId; I.jumpPressed = true; return; }
      if (actVis.on && hit(btn.act, x, y, 14)) { touch.act = e.pointerId; I.actPressed = true; return; }
      if (x < W * 0.6 && !touch.stick) { touch.stick = { id: e.pointerId, ox: x, oy: y, x, y }; save.stickSeen = true; return; }
      // a tap elsewhere on the right side also jumps
      if (x >= W * 0.6) { touch.jump = e.pointerId; I.jumpPressed = true; }
    });
    ctx.listen(canvas, 'pointermove', e => {
      const t = touch.stick;
      if (t && t.id === e.pointerId) {
        t.x = e.offsetX; t.y = e.offsetY;
        // the stick's origin follows a finger that drags far
        const dx = t.x - t.ox, dy = t.y - t.oy, d = Math.hypot(dx, dy), max = 56;
        if (d > max) { t.ox = t.x - dx / d * max; t.oy = t.y - dy / d * max; }
      }
    });
    const up = e => {
      if (touch.stick && touch.stick.id === e.pointerId) touch.stick = null;
      if (touch.jump === e.pointerId) touch.jump = null;
      if (touch.act === e.pointerId) touch.act = null;
    };
    ctx.listen(canvas, 'pointerup', up); ctx.listen(canvas, 'pointercancel', up); ctx.listen(canvas, 'lostpointercapture', up);

    function readInput() {
      let mx = (key.r ? 1 : 0) - (key.l ? 1 : 0), my = (key.u ? 1 : 0) - (key.d ? 1 : 0);
      const t = touch.stick;
      if (t) {
        const dx = t.x - t.ox, dy = t.y - t.oy;
        const ax = Math.abs(dx) < 9 ? 0 : sign(dx) * Math.min(1, (Math.abs(dx) - 6) / 30);
        const ay = Math.abs(dy) < 16 ? 0 : -sign(dy) * Math.min(1, (Math.abs(dy) - 12) / 26);
        mx = clamp(mx + ax, -1, 1); my = clamp(my + ay, -1, 1);
      }
      I.mx = mx; I.my = my;
      I.jumpHeld = !!key.j || touch.jump !== null;
    }

    // ---- the run
    let farX = 0, mode = 'title', runT = 0, time = 0, captures = 0, cp = 0, sectionSeen = -1, caption = null, captureT = 0, attempt = 0, result = null;
    let titleT = 0, stepAcc = 0, cityStepT = 0;
    const score = safe(() => ctx.game.score()) || { set() { }, reset() { }, value: 0 };
    const progressPts = () => Math.max(0, Math.floor(farX - level.start.x)) * SCORE.perMetre;
    // ---- the board: the server's numbers are the truth; ctx.storage is only a fallback
    const BOARD = { scope: 'global', period: 'all_time' };
    let serverBest = null, runSaved = 0;
    const bestShown = () => serverBest != null ? serverBest : save.best;
    const standingOf = s => { const v = s && ((s.viewerRank && s.viewerRank.value) ?? (s.standing && s.standing.value)); return typeof v === 'number' && isFinite(v) ? v : null; };
    function refreshBest() {
      return Promise.resolve().then(() => score.rank('score', BOARD)).then(s => { if (destroyed) return; const v = standingOf(s); if (v != null) serverBest = v; }).catch(() => { });
    }
    // submit one run result; if the server cannot take it, report it and hand
    // it to the host's retrying checkpoint queue so it is not lost
    function saveScore(value, kind, metadata) {
      const label = value.toLocaleString() + ' pts';
      if (value > save.best) { save.best = value; persist(); }
      return Promise.resolve().then(() => score.submit('score', { label, metadata }))
        .then(res => { const pb = !!(res && res.isPersonalBest); if (pb) serverBest = Math.max(serverBest || 0, value); return refreshBest().then(() => ({ state: 'ok', pb })); })
        .catch(err => {
          safe(() => ctx.platform.error({ code: 'score_submit_failed', message: String(err && (err.code || err.message) || err), kind, value }));
          return Promise.resolve().then(() => ctx.memory.record('score').checkpoint(value, { label, metadata }))
            .then(() => ({ state: 'queued' }), () => ({ state: 'fail' }));
        });
    }
    refreshBest();
    function resetWorld() {
      world.reset(); watcher.reset();
      world.dynamicOccluders(dynOcc, time); optics.setDynamic(dynOcc);
    }
    function respawn(capturedNow) {
      const c = level.checkpoints[cp];
      resetWorld();
      player.reset(c.x, c.y, c.face);
      R.follow(player, 1, true);
      I.jumpPressed = false; I.actPressed = false;
      if (capturedNow) captures++;
      R.capture = null; actVis.k = 0; actVis.on = false;
      mode = 'play';
    }
    function beginRun() {
      attempt++;
      audio.unlock(); audio.setOn(save.sound);
      safe(() => ctx.platform.start({ attempt }));
      safe(() => ctx.platform.interact({ type: 'begin' }));
      if (caps.backgroundMusic && save.sound) safe(() => { ctx.music.unlock(); ctx.music.play({ preset: 'drone', volume: 0.22, intensity: 0.15, tempo: 60, scale: 'minor', fadeInMs: 2400 }); });
      runT = 0; farX = level.start.x; runSaved = 0; captures = 0; cp = 0; sectionSeen = -1; caption = null; result = null; R.capture = null;
      watcher.alarms = 0; watcher.hunts = 0; watcher.exposure = 0;
      score.reset && score.reset();
      hidePanels(); playBtn.style.display = 'none';
      save.runs++; persist();
      respawn(false);
    }

    function retryFromMark() { if (mode !== 'caughtCard') return; hidePanels(); respawn(false); safe(() => ctx.platform.start({ attempt, retry: true })); }

    // why it caught you, from the state at the moment of capture
    function captureReason() {
      const c = watcher.captureCtx || {};
      const lamp = LAMP_NAME[c.lamp && c.lamp.kind] || 'the light';
      const secs = (c.litRun || 0).toFixed(1);
      if (c.door) return ['You hid in a doorway near where it lost you.', 'During a hunt, doorways near its last sighting open. Move on instead.'];
      if (c.onAwning) return ['You were on top of the awning, under ' + lamp + '.', 'The shadow falls beneath the awning, not on it.'];
      if (c.state === 'hang' || c.state === 'pipe' || c.state === 'climbup' || c.state === 'rope') return ['It locked on while you were climbing in ' + lamp + '’s light.', 'Climb while the beam is away, or climb out of its reach.'];
      if (c.reacquired) return ['It had lost you, and you went back into ' + lamp + '\u2019s light while it was still searching.', 'After it loses you, it hunts that spot. Leave by another way.'];
      if (c.sinceNoise < 3.5) return ['The noise told it where to look, and you were still in ' + lamp + '’s reach.', 'Pull when the lamp is turned away, then move at once.'];
      if (c.speed < 1) return ['You stood still in ' + lamp + '’s light for ' + secs + ' s.', 'Once it has found you, get something solid between you and the lamp.'];
      if (c.hunt) return ['It was already hunting you, and you stayed in ' + lamp + '’s light for ' + secs + ' s.', 'In a hunt it locks on faster. Break its line of sight, then change route.'];
      return ['It found you in ' + lamp + '’s light and you stayed in it for ' + secs + ' s.', 'A quick crossing is survivable. Lingering is not.'];
    }
    function showCaught() {
      const [why, tip] = captureReason();
      const sec = level.sections[currentSection()];
      const mark = level.sections[markSection()];
      panel.innerHTML = '';
      const card = document.createElement('div'); card.className = 'll-card';
      card.innerHTML = `<p class="ll-h">Caught.</p><p class="ll-it">${esc(sec.num + '. ' + sec.name)}, at ${fmtTime(runT)}</p><div class="ll-rule"></div>
        <p class="ll-why">${esc(why)}</p><p class="ll-tip">${esc(tip)}</p>`;
      card.appendChild(button('Run the street again', '', () => beginRun()));
      card.appendChild(button('From the last mark (' + mark.num + ')', 'sec', () => retryFromMark()));
      const k = document.createElement('div'); k.className = 'll-break';
      k.textContent = 'From the mark, the clock keeps running and this capture costs ' + SCORE.perCapture.toLocaleString() + ' points.';
      card.appendChild(k);
      const pts = progressPts();
      const saveLine = document.createElement('div'); saveLine.className = 'll-dim ll-save';
      card.insertBefore(saveLine, card.querySelector('.ll-b'));
      panel.appendChild(card); panel.className = 'll-panel on';
      // the distance reached is a result too: save it (best_per_user keeps the best)
      score.set && score.set(pts);
      const show = t => { if (!destroyed && saveLine.isConnected) saveLine.textContent = t; };
      if (pts > runSaved) {
        runSaved = pts;
        show('Score ' + pts.toLocaleString() + '. Saving…');
        saveScore(pts, 'caught', { timeMs: Math.round(runT * 1000), captures, metres: pts / SCORE.perMetre }).then(r => show(
          r.state === 'ok' ? 'Score ' + pts.toLocaleString() + (r.pb ? ', a new best.' : ' saved. Your best is ' + bestShown().toLocaleString() + '.')
            : r.state === 'queued' ? 'Score ' + pts.toLocaleString() + '. The board could not be reached; it will be saved when it can.'
              : 'Score ' + pts.toLocaleString() + '. It could not be saved.'));
      } else show('Score ' + pts.toLocaleString() + '. Your best is ' + bestShown().toLocaleString() + '.');
      safe(() => ctx.platform.fail({ section: currentSection() + 1, timeMs: Math.round(runT * 1000) }));
    }
    function markSection() { const c = level.checkpoints[Math.min(cp, level.checkpoints.length - 1)]; let s = 0; for (let i = 0; i < level.sections.length; i++) if (c.x >= level.sections[i].x) s = i; return s; }

    function pause() { if (mode !== 'play') return; mode = 'paused'; showPause(); safe(() => ctx.music.pause()); }
    function resume() { if (mode !== 'paused') return; mode = 'play'; hidePanels(); safe(() => ctx.music.resume()); }

    // ---- events from the systems
    function handleEvents() {
      for (const e of player.events) {
        if (e.type === 'jump') audio.jump();
        else if (e.type === 'land') {
          audio.land(e.v, e.kind);
          if (e.v > 15 && e.drop > 4) watcher.hear(e.x, e.y, 'landing');
          if (e.v > 13) safe(() => caps.haptics && ctx.platform.haptic('light'));
        }
        else if (e.type === 'grab') { audio.grab(e.what); }
        else if (e.type === 'pullup') audio.pullup();
        else if (e.type === 'slide') audio.slide();
        else if (e.type === 'vault') audio.vault();
      }
      player.events.length = 0;
    }
    function handleWatcher() {
      const pan = x => clamp((x - R.cam.x) / 12, -1, 1);
      for (const e of watcher.events) {
        if (e.type === 'notice') audio.notice();
        else if (e.type === 'investigate') audio.investigate();
        else if (e.type === 'track') { audio.track(); safe(() => caps.haptics && ctx.platform.haptic('warning')); setMusic(0.6, 78); }
        else if (e.type === 'hunt') { audio.hunt(); setMusic(0.9, 96); }
        else if (e.type === 'search') { if (e.from === 'track' || e.from === 'hunt') { audio.lost(); setMusic(0.15, 60); } else if (e.settled || e.from === 'notice') audio.settle(); }
        else if (e.type === 'lost') audio.settle();
        else if (e.type === 'reacquire') audio.track();
        else if (e.type === 'capture') capture();
      }
      watcher.events.length = 0;
      for (const e of worldEvents) {
        if (e.type === 'awningOut') audio.awningOut();
        else if (e.type === 'awningBack') audio.awningBack();
        else if (e.type === 'shutterDown') audio.shutter(Math.abs(e.s.x0 - player.x), pan(e.s.x0));
        else if (e.type === 'shutterShut') audio.shutterShut(Math.abs(e.s.x0 - player.x), pan(e.s.x0));
      }
      worldEvents.length = 0;
    }
    function setMusic(intensity, tempo) { if (caps.backgroundMusic && save.sound) safe(() => { ctx.music.setIntensity(intensity, { fadeMs: 1200 }); ctx.music.setTempo(tempo); }); }
    function capture() {
      mode = 'caught'; captureT = 0;
      player.state = 'caught'; player.vx = 0; player.vy = 0;
      R.capture = { x: player.x, y: player.y, t: 0 };
      // every lamp that can reach turns on the runner
      for (const l of level.lights) if (watcher.reaches(l, player)) l.engaged = true;
      audio.capture();
      safe(() => caps.haptics && ctx.platform.haptic('error'));
      safe(() => ctx.platform.milestone('captured', { section: currentSection() }));
      setMusic(0.15, 60);
    }
    function currentSection() { let s = 0; for (let i = 0; i < level.sections.length; i++) if (player.x >= level.sections[i].x) s = i; return s; }

    const worldEvents = [];
    let lastDoor = [];
    function step(dt) {
      readInput();
      if (mode === 'play') {
        runT += dt;
        farX = Math.max(farX, player.x);
        { const pp = progressPts(); if (pp > score.value) score.set && score.set(pp); }
        // act: pull the cord in reach
        if (I.actPressed) {
          updateActVis();
          const it = actVis.it;
          if (it && it.kind === 'cord' && it.ready) {
            player.startPull();
            world.pullAwning(it.a);
            watcher.hear(it.a.cord.x, it.a.cord.y, 'cord');
            safe(() => ctx.platform.interact({ type: 'awning' }));
            safe(() => caps.haptics && ctx.platform.haptic('medium'));
          }
        }
        player.update(dt, I);
        world.update(dt, player, watcher, worldEvents);
        world.dynamicOccluders(dynOcc, time); optics.setDynamic(dynOcc);
        watcher.update(dt, player, time);
        handleEvents(); handleWatcher();
        // marks along the street
        for (let i = cp + 1; i < level.checkpoints.length; i++) { const c = level.checkpoints[i]; if (player.x >= c.x && player.state === 'ground' && Math.abs(player.y - c.y) < 1 && watcher.mode !== 'track' && watcher.mode !== 'hunt') { cp = i; } }
        const sec = currentSection();
        if (sec > sectionSeen) { sectionSeen = sec; caption = { s: level.sections[sec], t: 0 }; if (sec > 0) safe(() => ctx.platform.milestone('section', { n: sec + 1 })); safe(() => ctx.platform.setProgress(sec / (level.sections.length))); }
        if (player.y < -8) respawn(false);
        if (player.x >= level.exitX && player.y < 1.5 && (player.state === 'ground' || player.state === 'air')) finish();
        updateActVis();
        // doors that open during a hunt creak
        level.recesses.forEach((r, i) => { const o = r.open > 0.05; if (o && !lastDoor[i]) audio.door(Math.abs(r.x0 - player.x), clamp((r.x0 - R.cam.x) / 12, -1, 1)); lastDoor[i] = o; });
      } else if (mode === 'caught') {
        captureT += dt;
        watcher.update(dt, player, time);
        watcher.events.length = 0;
        R.capture.t = captureT;
        if (captureT > 0.95) { captures++; mode = 'caughtCard'; showCaught(); }
      }
      I.jumpPressed = false; I.actPressed = false;
    }

    // ---- result
    function finish() {
      mode = 'result';
      player.state = 'gone';
      const t = runT, seen = watcher.exposure, alarms = watcher.alarms;
      const value = Math.max(SCORE.escapeMin, Math.round(SCORE.base - SCORE.perSecond * t - SCORE.perSeen * seen - SCORE.perAlarm * alarms - SCORE.perCapture * captures));
      const prevBest = bestShown();
      if (!save.bestTime || t < save.bestTime) save.bestTime = t;
      persist();
      result = { t, seen, alarms, captures, value, prevBest, attempt, saved: { state: 'saving' }, board: { state: 'loading' } };
      audio.escape();
      safe(() => caps.backgroundMusic && save.sound && ctx.music.sting('win'));
      setMusic(0.1, 56);
      score.set && score.set(value);
      showResult();
      // records: submit first, then mark the outcome; detached, fenced to this attempt
      const mine = attempt, live = () => !destroyed && mine === attempt && result && mode === 'result';
      runSaved = value;
      const saving = saveScore(value, 'escape', { timeMs: Math.round(t * 1000), captures, alarms });
      safe(() => ctx.platform.complete({ score: value, timeMs: Math.round(t * 1000), captures }));
      saving.then(sv => { if (live()) { result.saved = sv; renderBoard(); } })
        .then(() => score.leaderboard('score', Object.assign({ limit: 3 }, BOARD)))
        .then(b => { if (!live()) return; const v = standingOf(b); if (v != null) serverBest = v; result.board = { state: 'ok', rows: (b && b.rows) || [], me: b && b.viewerRank, total: b && b.totalRanked, failed: !!(b && b.checkpointStatus && b.checkpointStatus.failed) }; renderBoard(); })
        .catch(() => { if (live()) { result.board = { state: 'fail' }; renderBoard(); } });
      safe(() => ctx.timeout(() => { if (!destroyed && mine === attempt && mode === 'result') safe(() => ctx.pulse.complete({ timeMs: Math.round(t * 1000), score: value, text: 'Escaped the Watcher\'s street in ' + fmtTime(t) + '.' })); }, 900));
    }
    const fmtTime = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

    // ---- DOM panels: pause and result
    const panel = document.createElement('div'); panel.className = 'll-panel'; ui.appendChild(panel);
    // the start control: a real button under the title, laid out from the
    // content-safe CSS variables, nowhere near the bottom of the screen
    const playBtn = document.createElement('button'); playBtn.className = 'll-play'; playBtn.textContent = 'Play';
    ctx.input.activate(playBtn, () => { audio.unlock(); if (mode === 'title') beginRun(); });
    ui.appendChild(playBtn);
    function hidePanels() { panel.className = 'll-panel'; panel.innerHTML = ''; }
    function button(label, cls, fn) { const b = document.createElement('button'); b.className = 'll-b' + (cls ? ' ' + cls : ''); b.textContent = label; ctx.input.activate(b, e => { audio.ui(); fn(e); }); return b; }
    function showPause() {
      panel.innerHTML = '';
      const card = document.createElement('div'); card.className = 'll-card';
      card.innerHTML = '<p class="ll-h">Paused</p><p class="ll-it">The Watcher waits with you.</p><div class="ll-rule"></div>';
      card.appendChild(button('Resume', '', resume));
      card.appendChild(button('Back to the last mark', 'sec', () => { resume(); respawn(false); }));
      card.appendChild(button('Restart the street', 'sec', () => { mode = 'play'; beginRun(); }));
      card.appendChild(button('Sound: ' + (save.sound ? 'on' : 'off'), 'sec', () => { save.sound = !save.sound; persist(); audio.setOn(save.sound); safe(() => save.sound ? ctx.music.resume() : ctx.music.pause()); showPause(); }));
      const k = document.createElement('div'); k.className = 'll-keys';
      k.textContent = 'Drag on the left to run, climb and drop. Right side: jump (hold for height) and pull. Keys: arrows or WASD, Space to jump, E to pull, Esc to pause.';
      card.appendChild(k);
      panel.appendChild(card); panel.className = 'll-panel on';
    }
    function showResult() {
      const r = result;
      panel.innerHTML = '';
      const card = document.createElement('div'); card.className = 'll-card';
      const verdict = r.captures === 0 && r.alarms === 0 ? 'Unseen.' : r.captures === 0 ? 'Escaped.' : 'Escaped, at last.';
      const sub = r.captures === 0 && r.alarms === 0 ? 'It never knew you were there.' : r.captures === 0 ? 'It found you ' + (r.alarms === 1 ? 'once' : r.alarms + ' times') + ', and you shook it off.' : 'It caught you ' + (r.captures === 1 ? 'once' : r.captures + ' times') + ' on the way.';
      card.innerHTML = `<p class="ll-h">${verdict}</p><p class="ll-it">${sub}</p><div class="ll-rule"></div>
        <div class="ll-stats"><div><b>${fmtTime(r.t)}</b>Time</div><div><b>${r.seen.toFixed(1)}s</b>In light</div><div><b>${r.alarms}</b>Detected</div><div><b>${r.captures}</b>Caught</div></div>
        <div class="ll-score"><b>${r.value.toLocaleString()}</b><span>Score</span></div>
        <div class="ll-break">${SCORE.base.toLocaleString()} − ${Math.round(SCORE.perSecond * r.t)} time − ${Math.round(SCORE.perSeen * r.seen)} light − ${SCORE.perAlarm * r.alarms} detected − ${SCORE.perCapture * r.captures} caught</div>
        <div class="ll-note"></div>
        <div class="ll-board"></div>`;
      card.appendChild(button('Run again', '', () => beginRun()));
      panel.appendChild(card); panel.className = 'll-panel on';
      renderBoard();
    }
    function renderBoard() {
      const el = panel.querySelector('.ll-board'); if (!el || !result) return;
      const note = panel.querySelector('.ll-note'), sv = result.saved, r0 = result;
      if (note) note.textContent = sv.state === 'saving' ? 'Saving your score…'
        : sv.state === 'ok' ? (sv.pb ? (r0.prevBest ? 'A new best: ' + r0.prevBest.toLocaleString() + ' before.' : 'Your first score on the board.') : 'Saved. Your best is ' + bestShown().toLocaleString() + '.')
          : sv.state === 'queued' ? 'The board could not be reached. Your score will be saved when it can.'
            : 'Your score could not be saved.';
      const b = result.board;
      if (b.state === 'loading') { el.innerHTML = '<div class="ll-dim">Updating the board…</div>'; return; }
      if (b.state === 'fail') { el.innerHTML = '<div class="ll-dim">The board is unavailable right now.</div>'; return; }
      const isMe = r => !!b.me && (r.userId && b.me.userId ? r.userId === b.me.userId : r.rank === b.me.rank);
      const who = r => r.username || r.displayName || r.name || (isMe(r) ? 'you' : '');
      const rows = (b.rows || []).slice(0, 3).map(r => `<div class="ll-row${isMe(r) ? ' me' : ''}"><span>${r.rank}.${who(r) ? ' ' + esc(who(r)) : ''}</span><span>${esc(r.displayLabel || (typeof r.value === 'number' ? r.value.toLocaleString() + ' pts' : ''))}</span></div>`).join('');
      const me = b.me && b.me.rank ? `<div class="ll-dim">You are ${b.me.rank}${b.total ? ' of ' + b.total : ''}.</div>` : '';
      const warn = b.failed ? '<div class="ll-dim">Some scores were not saved. Showing the scores the board accepted.</div>' : '';
      el.innerHTML = (rows ? rows + me : '<div class="ll-dim">No scores yet.</div>') + warn;
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    // ---- HUD on the canvas
    function drawHUD(dt) {
      const a = area();
      g.save();
      g.textBaseline = 'alphabetic';
      if (mode === 'title') {
        const x = a.left + 24, y = a.top + 16 + 68;
        g.fillStyle = 'rgba(13,13,12,0.0)';
        g.fillStyle = PAPER;
        g.font = '400 46px "DM Serif Display", Georgia, serif';
        g.fillText('The Last Light', x, y);
        g.font = 'italic 300 32px "Cormorant Garamond", Georgia, serif';
        g.fillText('on the Street', x + 2, y + 36);
        g.fillRect(x + 2, y + 58, 40, 1);
        g.font = '600 11px Inter, system-ui, sans-serif';
        if (g.letterSpacing !== undefined) g.letterSpacing = '2px';
        g.fillText('THE WATCHER’S STREET', x + 2, y + 82);
        if (bestShown()) { g.globalAlpha = 0.75; g.fillText('BEST ' + bestShown().toLocaleString(), x + 2, y + 102); g.globalAlpha = 1; }
        if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
        g.restore();
        return;
      }
      // time
      g.fillStyle = PAPER;
      g.font = '400 26px "DM Serif Display", Georgia, serif';
      // distance covered: the furthest point reached along the street
      const dist = String(Math.max(0, Math.floor(farX - level.start.x)));
      const hudY = a.top + 40 + 16; // readout baseline, well below the top inset
      g.fillText(dist, a.left + 16, hudY);
      const dw = g.measureText(dist).width;
      g.font = '400 17px "DM Serif Display", Georgia, serif';
      g.fillText('m', a.left + 16 + dw + 4, hudY);
      // section caption, like a chapter heading
      if (caption) {
        caption.t += dt;
        const k = caption.t < 0.5 ? caption.t / 0.5 : caption.t > 3 ? Math.max(0, 1 - (caption.t - 3) / 0.8) : 1;
        if (k > 0) {
          g.globalAlpha = k;
          g.font = 'italic 300 22px "Cormorant Garamond", Georgia, serif';
          g.fillText(caption.s.num + '.  ' + caption.s.name, a.left + 16, hudY + 28);
          g.globalAlpha = 1;
        }
      }
      drawEye(W / 2, btn.pause.y);
      // pause
      const p = btn.pause;
      g.strokeStyle = 'rgba(236,231,220,0.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
      g.fillStyle = PAPER; g.fillRect(p.x - 5, p.y - 7, 3, 14); g.fillRect(p.x + 2, p.y - 7, 3, 14);
      drawControls();
      g.restore();
    }
    function drawEye(cx, cy) {
      const m = watcher.mode, w = 18;
      const open = m === 'search' ? 0 : m === 'investigate' ? 0.25 : m === 'notice' ? 0.2 + watcher.S * 0.6 : 1;
      R.eye = approach(R.eye || 0, open, 0.08);
      const o = R.eye;
      g.strokeStyle = PAPER; g.fillStyle = PAPER; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - w, cy); g.quadraticCurveTo(cx, cy - 13 * o - 0.5, cx + w, cy); g.quadraticCurveTo(cx, cy + 13 * o + 0.5, cx - w, cy); g.stroke();
      if (o > 0.3) {
        const pr = (m === 'hunt' ? 2.5 : 4.5) * Math.min(1, (o - 0.3) / 0.5);
        const lx = clamp((watcher.last.x - player.x) * 0.4, -6, 6);
        g.beginPath(); g.arc(cx + (m === 'investigate' ? lx : 0), cy, pr, 0, TAU); g.fill();
      }
      if (m === 'hunt') { g.lineWidth = 1; for (let i = 0; i < 7; i++) { const a = -Math.PI + (i + 0.5) * Math.PI / 7; g.beginPath(); g.moveTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 15); g.lineTo(cx + Math.cos(a) * 27, cy + Math.sin(a) * 19); g.stroke(); } }
      // a hairline that fills: suspicion (grey) then lock-on (paper)
      const lw = 84, ly = cy + 22;
      g.fillStyle = 'rgba(236,231,220,0.25)'; g.fillRect(cx - lw / 2, ly, lw, 1);
      if (m === 'notice' || m === 'search' || m === 'investigate') { g.fillStyle = 'rgba(236,231,220,0.6)'; const v = watcher.S; g.fillRect(cx - lw / 2 * v, ly - 0.5, lw * v, 2); }
      else { g.fillStyle = PAPER; const v = watcher.L; g.fillRect(cx - lw / 2 * v, ly - 1, lw * v, 3); }
    }
    // the pull button exists only while there is something to pull; a wider
    // radius to leave than to enter keeps it from flickering at the edge
    const actVis = { k: 0, on: false, it: null };
    function updateActVis() {
      let it = null;
      if (mode === 'play' && (player.state === 'ground' || player.state === 'pull')) {
        for (const a of level.awnings) {
          const d = Math.abs(player.x - a.cord.x), dy = Math.abs(player.y - a.cord.y);
          if (dy < 0.5 && d < (actVis.on ? 1.35 : 0.95)) it = { kind: 'cord', a, ready: a.cool <= 0 && a.target === 0 && player.state !== 'pull' };
        }
      }
      actVis.on = !!it; actVis.it = it;
    }
    function drawControls() {
      const it = actVis.it;
      // stick
      const t = touch.stick, home = touch.home;
      g.lineWidth = 1.5;
      if (t) {
        g.strokeStyle = 'rgba(236,231,220,0.45)'; g.beginPath(); g.arc(t.ox, t.oy, 50, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(236,231,220,0.35)'; g.beginPath(); g.arc(t.x, t.y, 20, 0, TAU); g.fill();
      } else {
        const hint = !save.stickSeen ? 0.5 + 0.3 * Math.sin(time * 3) : 0.22;
        g.strokeStyle = 'rgba(236,231,220,' + hint.toFixed(2) + ')';
        g.beginPath(); g.arc(home.x, home.y, 50, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(236,231,220,' + (hint * 0.6).toFixed(2) + ')';
        g.beginPath(); g.arc(home.x + (!save.stickSeen ? Math.sin(time * 1.6) * 22 : 0), home.y, 18, 0, TAU); g.fill();
      }
      // jump
      const j = btn.jump, held = touch.jump !== null;
      g.fillStyle = held ? 'rgba(236,231,220,0.3)' : 'rgba(13,13,12,0.25)';
      g.beginPath(); g.arc(j.x, j.y, j.r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(236,231,220,0.7)'; g.stroke();
      g.strokeStyle = PAPER; g.lineWidth = 2.5; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(j.x - 11, j.y + 5); g.lineTo(j.x, j.y - 7); g.lineTo(j.x + 11, j.y + 5); g.stroke();
      // act: appears with something to pull; WAIT while the awning is out
      actVis.k = approach(actVis.k, actVis.on && mode === 'play' ? 1 : 0, 0.12);
      if (actVis.k > 0.01) {
        const ac = btn.act, live = it && it.ready;
        g.save(); g.globalAlpha = actVis.k;
        g.lineWidth = 1.5;
        g.fillStyle = live ? 'rgba(236,231,220,0.94)' : 'rgba(13,13,12,0.35)';
        g.beginPath(); g.arc(ac.x, ac.y, ac.r, 0, TAU); g.fill();
        g.strokeStyle = live ? PAPER : 'rgba(236,231,220,0.4)'; g.stroke();
        if (live) { const k = (time * 1.4) % 1; g.globalAlpha = actVis.k * (1 - k); g.beginPath(); g.arc(ac.x, ac.y, ac.r + k * 14, 0, TAU); g.stroke(); g.globalAlpha = actVis.k; }
        // glyph: a cord and its toggle
        const col = live ? INK : 'rgba(236,231,220,0.5)';
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(ac.x, ac.y - 15); g.lineTo(ac.x, ac.y - 3); g.stroke();
        g.fillRect(ac.x - 3, ac.y - 4, 6, 9);
        g.font = '600 9px Inter, system-ui, sans-serif'; g.textAlign = 'center';
        if (g.letterSpacing !== undefined) g.letterSpacing = '1.5px';
        g.fillText(live ? 'PULL' : 'WAIT', ac.x + 1, ac.y + 17);
        if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
        g.textAlign = 'left';
        g.restore();
      }
    }

    // ---- frame
    function frame(dt) {
      time += dt;
      if (mode === 'title') {
        titleT += dt;
        // the title holds on the roofs while the first lamp searches
        R.cam.x = 26 + Math.sin(titleT * 0.08) * 3; R.cam.yb = 4.2;
        player.update(0, I);
        watcher.update(dt, player, time);
        watcher.events.length = 0;
      } else if (mode === 'play' || mode === 'caught' || mode === 'caughtCard') R.follow(player, dt);
      R.flash = 0;
      R.dpr = canvas.width / Math.max(1, ctx.width) || 1;
      R.draw({ player, time }, dt);
      drawHUD(dt);
      // audio scene
      let hum = 0, turn = 0;
      for (const l of level.lights) { if (!l.on) continue; const d = Math.hypot(l.x - player.x, l.y - player.y); const k = clamp(1 - d / 24, 0, 1); if (k > hum) { hum = k; turn = Math.abs(angNorm(l.ang - (l.prevAng === undefined ? l.ang : l.prevAng))) / Math.max(dt, 1e-3); } l.prevAng = l.ang; }
      audio.frame(dt, { lit: mode === 'play' ? watcher.seenFrac : 0, hum: mode === 'title' ? hum * 0.5 : hum, humTurn: clamp(turn / 0.8, 0, 1), tension: watcher.tension(), height: player.y, playing: mode === 'play', lock: watcher.L, tracking: watcher.mode === 'track' || watcher.mode === 'hunt' });
      // footsteps
      if (mode === 'play' && player.state === 'ground' && Math.abs(player.vx) > 0.8 && player.slideT <= 0) {
        stepAcc += Math.abs(player.vx) * dt;
        if (stepAcc > 0.8) { stepAcc = 0; audio.step(player.ground ? player.ground.kind : 'street', Math.abs(player.vx) / MOVE.run); }
      }
      if (mode === 'play' && player.state === 'pipe' && Math.abs(player.vy) > 0.5) { cityStepT += dt * Math.abs(player.vy); if (cityStepT > 0.55) { cityStepT = 0; audio.climb(); } }
      for (const a of level.awnings) { if (a.shake && !a.warned) { a.warned = true; audio.awningWarn(); } if (!a.shake) a.warned = false; }
    }

    ctx.onResize(layout, { immediate: true });
    if (!W || !H) layout();
    // a first frame before the host reveals the Bit
    R.cam.x = 26; R.cam.yb = 4.2;
    player.reset(level.start.x, level.start.y, 1);
    frame(0);
    ctx.game.loop({
      fixedHz: 120,
      maxDeltaMs: 80,
      fixedUpdate: ms => { if (mode === 'play' || mode === 'caught') step(ms / 1000); },
      update: ms => frame(Math.min(0.05, ms / 1000)),
      onError: (err, phase) => { safe(() => ctx.platform.error({ stage: 'loop_' + phase, message: String((err && err.message) || err) })); }
    });
    ctx.onDestroy(() => audio.close());
    if (window.__LL_DEV) window.__ll = { act: actVis, level, world, player, watcher, optics, R, I, key, touch, btn, get mode() { return mode; }, set mode(v) { mode = v; }, beginRun, retryFromMark, respawn, step, frame, finish, setCp: i => { cp = i; }, get cp() { return cp; }, get runT() { return runT; }, get captures() { return captures; }, get result() { return result; }, get farX() { return farX; }, set farX(v) { farX = v; }, bestShown, get score() { return score.value; } };
    ctx.markVisualReady('title');
    ctx.platform.ready();
  }
};
