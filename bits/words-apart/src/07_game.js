// WORDS APART: the Plethora entry point. Glues the rules, the world, the camera and the interface.
const SAVE_KEY = 'words-apart.v1';
window.plethoraBit = {
  meta: { title: 'WORDS APART', runtime: 'plethora-bit@2', tags: ['word', 'puzzle', 'daily', '3d'], permissions: ['haptics', 'audio', 'storage'], keyboardBehavior: 'none' },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    // the single clock every timer reads from (a dev recording harness may substitute a virtual one)
    const now = () => (window.__WA_DEV && window.__waNow ? window.__waNow() : performance.now());
    const bank = loadBank(PUZZLE_BANK_RAW);
    // ---------- persistence (per device) ----------
    let save = { muted: false, days: {}, practiceBest: 0, runs: 0 };
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(save, s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };
    const plat = (fn, ...a) => { try { const p = ctx.platform && ctx.platform[fn]; if (p) p.apply(ctx.platform, a); } catch (e) { } };

    // ---------- first frame: the DOM shell ----------
    const canvas = ctx.createCanvas({ touchAction: 'manipulation', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:#080b09';
    const root = ctx.createRoot({ className: 'wa', layer: 'overlay', input: 'passthrough' });
    // a hidden 2D canvas owned by the runtime, used only to draw textures (grain, glow sprites)
    const scratch = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' }); scratch.style.display = 'none';
    const H = buildUI(root, scratch);
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    H.guide.style.display = coarse ? 'none' : ''; H.tap.style.display = 'none';
    for (const e of [H.top, H.hud, H.stage, H.foot]) e.style.opacity = 0;
    H.hud.style.pointerEvents = 'none';
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }
    const day = dayNumber(new Date());
    H.tKick.textContent = 'Daily descent · No. ' + day;
    H.title.classList.add('on');
    if (ctx.markVisualReady) ctx.markVisualReady('title');

    function bootFail(stage, err) {
      plat('error', { stage, message: String((err && err.message) || err) });
      H.title.classList.remove('on');
      const msg = { library: 'The 3D engine could not be downloaded. Check your connection and reopen WORDS APART.', renderer: 'This device could not start 3D graphics.', frame: 'The first frame failed to draw. Please reopen WORDS APART.' }[stage];
      H.el('div', 'wa-boot', msg);
      plat('ready');
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    const quality = { shadow: small ? 1024 : 2048, motes: small ? 160 : 300, dpr: Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 2 : 1.75) };
    renderer.setPixelRatio(quality.dpr);
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const W = createWorld(THREE, renderer, quality, scratch);
    const camera = new THREE.PerspectiveCamera(50, ctx.width / ctx.height, 0.1, 900);
    const D = createDirector(THREE, W, camera);
    const audio = createAudio(caps.audio !== false);
    audio.setMuted(!!save.muted);
    ctx.onDestroy(() => { destroyed = true; audio.close(); try { W.dispose(); renderer.dispose(); } catch (e) { } });
    const scoreRecord = (() => { try { return ctx.memory && ctx.memory.record ? ctx.memory.record('score') : null; } catch (e) { return null; } })();

    // ---------- state ----------
    let mode = 'title'; // title | intro | play | over
    let run = null, runKind = 'daily', ranked = false, pendingSubmit = null, autoT = 0, lastTimeText = '', lastSec = -1, intro = 0, finaleT = -1, overAt = 0, submitted = null;
    let urgency = 0;

    function showPanel(p) { for (const x of [H.title, H.result, H.board]) x.classList.toggle('on', x === p); }
    function playHud(on) { for (const e of [H.top, H.hud, H.stage, H.foot]) e.style.opacity = on ? 1 : 0; H.scrim.style.opacity = on ? 1 : 0; H.stage.style.pointerEvents = on ? '' : 'none'; H.osk.classList.toggle('on', on && coarse); layout(); }
    function toast(msg) { H.toast.textContent = msg; H.toast.classList.add('on'); ctx.timeout(() => H.toast.classList.remove('on'), 1800); }

    // ---------- title ----------
    function renderTitle() {
      const rec = save.days[day];
      if (rec) {
        H.tToday.innerHTML = `Today's descent: <b>${rec.score.toLocaleString()} pts</b> · ${rec.solved}/5 words${rec.won ? ' · reached the bottom' : ''}<br><span class="wa-lab" style="font-size:10px">Next daily in <b class="cd">--:--:--</b></span>`;
        H.begin.textContent = 'Practice descent'; H.tPractice.style.display = 'none'; H.rules.style.display = 'none';
      } else {
        H.tToday.innerHTML = ''; H.begin.textContent = 'Begin the descent'; H.tPractice.style.display = ''; H.rules.style.display = '';
      }
    }
    function countdown() {
      const cd = H.tToday.querySelector('.cd'); if (!cd) return;
      const d = new Date(), next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), s = Math.max(0, Math.floor((next - d) / 1000));
      cd.textContent = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
    }

    // ---------- slots ----------
    let slotEls = [], slotSize = 48, slotsFor = null;
    function buildSlots(p, enter) {
      H.slots.className = 'wa-slots' + (enter ? ' enter' : '');
      H.slots.innerHTML = ''; slotEls = []; slotsFor = p;
      for (let i = 0; i < p.length; i++) {
        const s = document.createElement('div'); const give = i === 0 || i === p.length - 1;
        s.className = 'wa-slot ' + (give ? 'give' : 'mid'); s.innerHTML = '<b>' + (give ? (i === 0 ? p.startLetter : p.endLetter) : '') + '</b>';
        if (enter) s.style.animationDelay = (i * 0.035) + 's';
        H.slots.appendChild(s); slotEls.push(s);
      }
      sizeSlots(); renderSlots(false);
    }
    function sizeSlots() {
      if (!slotEls.length) return;
      const n = slotEls.length, w = ctx.width, gapK = 0.16;
      slotSize = Math.floor(clamp((w - 40) / (n + (n - 1) * gapK), 26, w > 700 ? 64 : 54));
      H.slots.style.gap = Math.round(slotSize * gapK) + 'px';
      for (const s of slotEls) { s.style.width = slotSize + 'px'; s.style.height = Math.round(slotSize * 1.12) + 'px'; s.style.fontSize = Math.round(slotSize * 0.78) + 'px'; }
    }
    let shown = '';
    function renderSlots(animateNew) {
      if (!run || slotsFor !== run.puzzle) return; // a solved word stays locked until the next one replaces it
      const mid = run.input.middle, n = slotEls.length;
      for (let i = 1; i < n - 1; i++) {
        const s = slotEls[i], ch = mid[i - 1] || '', b = s.firstChild;
        if (b.textContent !== ch) { b.textContent = ch; if (ch && animateNew) { s.classList.remove('in'); void s.offsetWidth; s.classList.add('in'); } }
        s.classList.toggle('fill', !!ch);
        s.classList.toggle('cur', mode === 'play' && run.state === 'playing' && i - 1 === mid.length);
      }
      shown = mid;
    }

    // ---------- input ----------
    function focusInput() { if (mode !== 'play' || coarse) return; /* touch screens use the on-screen keyboard */ try { H.input.focus({ preventScroll: true }); } catch (e) { H.input.focus(); } }
    function typed(ch) {
      if (mode !== 'play' || !run) return;
      if (run.type(ch, now())) { audio.key(run.input.middle.length); renderSlots(true); maybeAuto(); }
      H.slots.classList.remove('wrong');
    }
    function backspace() { if (mode !== 'play' || !run) return; if (run.back(now())) { audio.back(); renderSlots(false); } H.slots.classList.remove('wrong'); }
    function maybeAuto() { // only an exact accepted word submits itself; anything else waits for Enter
      if (run.input.full && isAccepted(run.puzzle, run.input.word)) autoT = now() + 140;
    }
    function syncField() { H.input.value = run ? run.input.raw : ''; }
    ctx.listen(H.input, 'keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Backspace' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); backspace(); syncField(); }
      else if (/^[a-zA-Z]$/.test(e.key) && !e.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typed(e.key); syncField(); }
      else if (e.key === ' ') e.preventDefault();
    });
    // soft keyboards (and IME composition) arrive as input events instead
    ctx.listen(H.input, 'input', e => {
      if (!run || mode !== 'play') { syncField(); return; }
      const v = H.input.value.toUpperCase().replace(/[^A-Z]/g, ''), old = run.input.raw;
      if (e.inputType === 'deleteContentBackward' || v.length < old.length && old.startsWith(v)) backspace();
      else if (v.startsWith(old)) { for (const c of v.slice(old.length)) typed(c); }
      else if (run.accepting(now())) { run.input.setRaw(v); renderSlots(true); maybeAuto(); }
      syncField();
    });
    ctx.listen(window, 'keydown', e => {
      if (e.target === H.input) return;
      if (mode === 'title' && e.key === 'Enter' && H.title.classList.contains('on')) { e.preventDefault(); H.begin.click(); return; }
      if (mode !== 'play') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
      else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); typed(e.key); }
      else return;
      syncField(); focusInput();
    });
    ctx.listen(H.slots, 'pointerdown', e => { e.preventDefault(); focusInput(); });
    ctx.listen(canvas, 'pointerdown', () => focusInput());
    // on-screen keys act on press, so fast typing never waits for a click
    ctx.listen(H.osk, 'pointerdown', e => {
      const b = e.target && e.target.closest ? e.target.closest('.wa-key') : null; if (!b) return;
      e.preventDefault(); b.classList.add('down'); ctx.timeout(() => b.classList.remove('down'), 110);
      const k = b.dataset.k; haptic('light');
      if (k === 'Enter') submit(); else if (k === 'Backspace') backspace(); else typed(k);
    });

    // ---------- the run ----------
    function begin(kind) {
      audio.unlock(); audio.ambient(true);
      const daily = dailyPuzzles(bank, day);
      runKind = kind; ranked = kind === 'daily' && !save.days[day];
      const puzzles = kind === 'daily' ? daily : practicePuzzles(bank, (Date.now() ^ (Math.random() * 1e9)) >>> 0, daily.map(p => p.id));
      run = new Run(puzzles); mode = 'intro'; intro = 0; finaleT = -1; submitted = null; urgency = 0; lastSec = -1;
      W.S.dark = 0; W.S.finale = 0; W.S.celebrate = 0; W.S.urgency = 0;
      D.reset(); D.intro(); D.shiftTarget = ctx.height > ctx.width ? 0.2 : 0.3;
      showPanel(null); playHud(true);
      H.stage.style.opacity = 0; H.clue.classList.remove('on'); H.clue.innerHTML = '';
      buildSlots(run.puzzle, true); updateHud(); updateLevel();
      H.input.value = ''; H.input.style.pointerEvents = 'auto';
      focusInput(); // synchronous with the tap, so phones raise the keyboard
      plat('start', { mode: kind, day });
      save.runs++; persist();
    }
    function activate() { // the first puzzle becomes active: the clock starts now
      mode = 'play'; run.start(now()); H.stage.style.opacity = 1; renderSlots(false); focusInput();
    }
    function updateLevel() {
      const l = run.level;
      H.levelT.textContent = pad2(l + 1) + ' / 05 · ' + LEVEL_NAMES[l];
      H.prog.forEach((s, i) => { s.className = i < run.solved.length ? 'done' : i === l && run.state !== 'won' ? 'now' : ''; });
      H.nudge.style.display = ''; H.nudge.disabled = false; H.nudge.innerHTML = 'Need a nudge? <em>−5s</em>';
    }
    function submit() {
      if (mode !== 'play' || !run) return;
      autoT = 0;
      const t = now(), res = run.submit(t);
      if (res.kind === 'incomplete' || res.kind === 'empty') { H.slots.classList.remove('nudge'); void H.slots.offsetWidth; H.slots.classList.add('nudge'); return; }
      if (res.kind === 'wrong') {
        audio.wrong(); haptic('warning');
        H.slots.classList.remove('shake', 'wrong'); void H.slots.offsetWidth; H.slots.classList.add('shake', 'wrong');
        plat('interact', { type: 'guess', correct: false, level: run.level + 1 });
        return;
      }
      if (res.kind === 'lost') return lose();
      if (res.kind === 'correct' || res.kind === 'won') solved(res);
    }
    function solved(res) {
      const e = res.entry, lvl = e.level;
      plat('interact', { type: 'guess', correct: true, level: lvl + 1 });
      plat('milestone', 'level_' + (lvl + 1), { word: e.word, points: e.points });
      audio.correct(lvl); haptic('success');
      // lock the word in the light
      slotEls.forEach((s, i) => { s.firstChild.textContent = e.word[i]; s.classList.remove('cur'); });
      H.slots.classList.remove('shake', 'wrong', 'nudge'); H.slots.classList.add('win');
      H.pop.querySelector('b').textContent = '+' + e.points;
      H.pop.querySelector('span').textContent = [e.speed ? `${e.base} + ${e.speed} speed` : `${e.base}`, e.mult > 1 ? `× ${e.mult} streak` : '', e.penalty ? `− ${e.penalty} nudge` : ''].filter(Boolean).join('  ');
      H.pop.classList.remove('on'); void H.pop.offsetWidth; H.pop.classList.add('on');
      H.input.value = '';
      ctx.timeout(() => {
        if (destroyed) return;
        const dur = D.descend(lvl); audio.rumble(dur, lvl === 4);
        if (res.kind === 'won') { win(); return; }
        // the next puzzle surfaces while the descent is still under way (the clock never stops)
        ctx.timeout(() => {
          if (destroyed || !run || run.state !== 'playing') return;
          H.slots.classList.add('out');
          ctx.timeout(() => {
            if (destroyed || !run || run.state !== 'playing') return;
            H.clue.classList.remove('on'); H.clue.innerHTML = '';
            buildSlots(run.puzzle, true); updateLevel(); syncField();
          }, 380);
        }, 240);
      }, 420);
      updateLevel();
    }
    function hint() {
      if (mode !== 'play' || !run) return;
      const t = now(), r = run.hint(t);
      if (r.kind === 'ok') {
        audio.hint(); haptic('light');
        H.clue.innerHTML = '<small class="wa-lab">Nudge</small>' + escapeHtml(r.hint);
        H.nudge.style.display = 'none'; ctx.timeout(() => H.clue.classList.add('on'), 30);
        H.pen.classList.remove('on'); void H.pen.offsetWidth; H.pen.classList.add('on');
        plat('interact', { type: 'hint', level: run.level + 1 });
      } else if (r.kind === 'denied') { audio.nudgeBlocked(); H.nudge.disabled = true; H.nudge.textContent = 'Too late for a nudge'; }
      focusInput();
    }
    ctx.listen(H.nudge, 'pointerdown', e => e.preventDefault()); // keep the keyboard up
    ctx.listen(H.nudge, 'click', e => { e.preventDefault(); hint(); });
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

    function finish(won) {
      mode = 'over'; overAt = now(); H.input.blur(); H.input.style.pointerEvents = 'none'; H.tap.classList.remove('on');
      const rec = { score: run.score, solved: run.solved.length, won, time: Math.round(run.elapsedMs() / 100) / 10, hints: run.hintsUsed, words: run.solved.map(e => e.word), at: Date.now() };
      if (ranked) {
        save.days[day] = rec; persist();
        submitted = 'pending';
        const label = run.score.toLocaleString() + ' pts · ' + rec.solved + '/5';
        const done = ok => { submitted = ok ? 'ok' : 'failed'; renderNote(); };
        try {
          if (scoreRecord && scoreRecord.submit) Promise.resolve(scoreRecord.submit(run.score, { label })).then(r => done(!(r && r.ok === false)), () => done(false));
          else if (ctx.game && ctx.game.score) { const sc = ctx.game.score(); sc.set(run.score); Promise.resolve(sc.submit('score', { label })).then(() => done(true), () => done(false)); }
          else done(false);
        } catch (e) { done(false); }
      } else if (run.score > save.practiceBest) { save.practiceBest = run.score; persist(); }
      if (won) plat('complete', { score: run.score, time: rec.time, hints: rec.hints, mode: runKind });
      else plat('fail', { score: run.score, solved: rec.solved, mode: runKind });
    }
    function win() { finish(true); finaleT = 0; D.shiftTarget = -0.16; }
    function lose() {
      if (mode === 'over') return;
      finish(false); audio.fail(); audio.ambient(false); haptic('error');
      H.slots.classList.add('out'); H.nudge.style.display = 'none';
      ctx.timeout(() => { if (!destroyed && mode === 'over') showResult(false); }, 2300);
    }
    function renderNote() {
      if (!run) return;
      const n = runKind === 'daily' ? (ranked ? ({ pending: 'Submitting to today\'s Plethora leaderboard…', ok: 'Submitted to today\'s Plethora leaderboard.', failed: 'Your score is saved on this device, but it could not be sent to the Plethora leaderboard.' })[submitted] || '' : 'You already played today\'s descent; this run is not ranked.') : 'Practice runs are not ranked.';
      H.sNote.textContent = n;
    }
    function showResult(won) {
      const r = run, rec = { time: Math.round(r.elapsedMs() / 100) / 10, depth: Math.round(-D.slabY) };
      H.sKick.textContent = (runKind === 'daily' ? 'Daily descent · No. ' + day : 'Practice descent') + (won ? ' · Complete' : '');
      if (won) {
        H.sHead.textContent = 'You reached the bottom.';
        const clean = r.solved.every(e => !e.hint && !e.wrong);
        H.sPerf.textContent = clean ? 'A clean descent: no nudges, no wrong turns.' : r.hintsUsed === 0 ? 'No nudges needed.' : r.hintsUsed === 1 ? 'One nudge on the way down.' : r.hintsUsed + ' nudges on the way down.';
      } else {
        const n = r.solved.length;
        H.sHead.textContent = n === 0 ? 'The light ran out at the surface.' : 'The light ran out ' + ['', 'one word', 'two words', 'three words', 'four words'][n] + ' down.';
        H.sPerf.textContent = n >= 4 ? 'So close to the bottom. One more try?' : n >= 2 ? 'You know the way now. The dark gives way to practice.' : 'Every descent starts with a single word. Try again.';
      }
      H.sScore.textContent = r.score.toLocaleString();
      H.sStats.innerHTML = `<div><b>${won ? rec.time.toFixed(1) + 's' : '—'}</b>Time</div><div><b>${r.hintsUsed}</b>Nudges</div><div><b>${rec.depth} m</b>Depth</div>`;
      H.sWords.innerHTML = r.puzzles.map((p, i) => {
        const e = r.solved[i];
        if (e) return `<div class="w"><span class="n wa-lab">${pad2(i + 1)}</span><span class="word">${e.word}${!e.primary ? `<small>we had ${p.answer}</small>` : ''}</span><span class="pts">+${e.points}${e.bonus ? ' +' + e.bonus : ''}</span></div>`;
        return `<div class="w miss"><span class="n wa-lab">${pad2(i + 1)}</span><span class="word">${p.answer}</span><span class="pts wa-lab">${i === r.solved.length ? 'unsolved' : 'not reached'}</span></div>`;
      }).join('');
      H.sAgain.textContent = runKind === 'daily' && !won ? 'Try a practice descent' : 'Practice descent';
      renderNote();
      playHud(false); showPanel(H.result);
    }
    function shareText() {
      const r = run, rows = r.puzzles.map((p, i) => { const e = r.solved[i]; return !e ? '▫' : e.hint ? '▪' : '■'; }).join('');
      const head = runKind === 'daily' ? 'WORDS APART No. ' + day : 'WORDS APART (practice)';
      return `${head}\n${rows}  ${r.solved.length}/5 · ${r.score.toLocaleString()} pts\n${r.state === 'won' ? 'Reached the bottom in ' + (Math.round(r.elapsedMs() / 100) / 10).toFixed(1) + 's' : 'The light ran out'} · ${r.hintsUsed} nudge${r.hintsUsed === 1 ? '' : 's'}`;
    }
    async function share() {
      const text = shareText();
      try { if (ctx.share) { ctx.share({ sceneId: 'result', title: 'WORDS APART', text }); return; } } catch (e) { }
      try { await navigator.clipboard.writeText(text); toast('Result copied'); return; } catch (e) { }
      toast('Sharing is not available here');
    }
    let boardReq = 0;
    function showBoard() {
      const req = ++boardReq;
      H.bHead.textContent = "Today's descent";
      H.bNote.textContent = runKind === 'practice' && run ? 'Only the first daily descent is ranked.' : 'Daily No. ' + day + ' · global ranking';
      H.bList.innerHTML = '<div><span>Loading the global board…</span><span></span></div>';
      H.board.classList.add('on');
      const local = localHistory();
      if (!scoreRecord || !scoreRecord.leaderboard) { H.bNote.textContent = 'The global board is not available here. Your own descents:'; H.bList.innerHTML = local; return; }
      Promise.resolve(scoreRecord.leaderboard({ scope: 'global', period: 'daily', limit: 10 })).then(b => {
        if (destroyed || req !== boardReq) return;
        const rows = (b && b.rows) || [], me = b && b.viewerRank;
        const name = r => escapeHtml(r.displayName || r.handle || r.username || (r.user && (r.user.displayName || r.user.handle)) || 'Player');
        const val = r => Number(r.value != null ? r.value : r.score || 0).toLocaleString();
        let html = rows.length ? rows.map((r, i) => `<div class="${r.isViewer || r.viewer ? 'me' : ''}"><span>${r.rank || i + 1}. ${name(r)}</span><span><b>${val(r)}</b></span></div>`).join('')
          : '<div><span>No one has reached the bottom today yet.</span><span></span></div>';
        if (me && me.rank) html += `<div class="me"><span>You · #${me.rank}${b.totalRanked ? ' of ' + b.totalRanked : ''}</span><span><b>${val(me)}</b></span></div>`;
        H.bList.innerHTML = html + '<div class="b-sub wa-lab">On this device</div>' + local;
      }, () => {
        if (destroyed || req !== boardReq) return;
        H.bNote.textContent = 'The global board could not be loaded right now. Your own descents:'; H.bList.innerHTML = local;
      });
    }
    function localHistory() {
      const days = Object.entries(save.days).map(([d, r]) => [Number(d), r]).sort((a, b) => b[0] - a[0]).slice(0, 8);
      let h = days.length ? days.map(([d, r]) => `<div><span>No. ${d}${d === day ? ' · today' : ''}</span><span>${r.solved}/5 · <b>${r.score.toLocaleString()}</b></span></div>`).join('')
        : '<div><span>No daily descents yet.</span><span></span></div>';
      if (save.practiceBest) h += `<div><span>Best practice score</span><span><b>${save.practiceBest.toLocaleString()}</b></span></div>`;
      return h;
    }
    function toTitle() {
      mode = 'title'; run = null; audio.ambient(false);
      W.S.dark = 0; W.S.finale = 0; W.S.celebrate = 0; W.S.urgency = 0; D.reset(); D.shiftTarget = ctx.height > ctx.width ? 0.08 : 0.3; D.shift = D.shiftTarget;
      playHud(false); renderTitle(); showPanel(H.title);
    }
    ctx.listen(H.begin, 'click', () => begin(save.days[day] ? 'practice' : 'daily'));
    ctx.listen(H.tPractice, 'click', () => begin('practice'));
    ctx.listen(H.tBoard, 'click', showBoard);
    ctx.listen(H.sBoard, 'click', showBoard);
    ctx.listen(H.bClose, 'click', () => H.board.classList.remove('on'));
    ctx.listen(H.sShare, 'click', share);
    ctx.listen(H.sAgain, 'click', () => begin('practice'));
    ctx.listen(H.sMenu, 'click', toTitle);
    ctx.listen(H.mute, 'click', () => { save.muted = !save.muted; persist(); audio.setMuted(save.muted); H.mute.innerHTML = save.muted ? ICONS.mute : ICONS.sound; focusInput(); });
    H.mute.innerHTML = save.muted ? ICONS.mute : ICONS.sound;

    // ---------- HUD ----------
    function fmt(ms) { const s = ms / 1000; if (s < 10) return s.toFixed(1); const w = Math.ceil(s); return Math.floor(w / 60) + ':' + pad2(w % 60); }
    function updateHud() {
      if (!run) return;
      const t = now(), rem = run.remainingMs(t), txt = fmt(rem);
      if (txt !== lastTimeText) { H.timeT.textContent = txt; lastTimeText = txt; }
      H.drainB.style.transform = `scaleX(${rem / (run.cfg.runSeconds * 1000)})`;
      const s = rem / 1000, live = run.state === 'playing';
      const cls = 'wa-time' + (!live && run.state !== 'ready' ? '' : s <= 5 ? ' critical' : s <= 15 ? ' urgent' : s <= 30 ? ' warn' : '');
      if (H.time.className !== cls) H.time.className = cls;
      urgency = live ? clamp((15 - s) / 15, 0, 1) : Math.max(0, urgency - 0.02);
      H.heat.style.opacity = (urgency * 0.9).toFixed(3);
      if (live && s <= 5) { const sec = Math.ceil(s); if (sec !== lastSec) { lastSec = sec; audio.beat(sec <= 3); haptic('light'); } }
      if (live && !run.hintAvailable(t) && !run.hints[run.level] && H.nudge.style.display !== 'none' && !H.nudge.disabled) { H.nudge.disabled = true; H.nudge.textContent = 'Too late for a nudge'; }
      H.depthB.textContent = String(Math.max(0, Math.round(-D.slabY))).padStart(3, '0');
    }

    // ---------- layout ----------
    let kb = 0;
    function layout() {
      if (!renderer) return;
      const w = ctx.width, h = ctx.height, safe = ctx.contentSafeArea || ctx.safeArea || {}, top = safe.top || 0, bot = safe.bottom || 0;
      const oskOn = coarse && (mode === 'play' || mode === 'intro');
      const keyH = Math.round(clamp(h * 0.058, 40, 50));
      for (const k of H.osk.querySelectorAll('.wa-key')) k.style.height = keyH + 'px';
      H.osk.style.bottom = (bot + 8) + 'px';
      kb = oskOn ? keyH * 3 + 14 + 8 + 22 : 0;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      const short = h < 560, portrait = h > w;
      H.top.style.top = top + 'px';
      const timeSize = Math.round(clamp(Math.min(w * 0.13, h * 0.075), 34, 60));
      H.time.style.fontSize = timeSize + 'px';
      H.hud.style.top = (top + (short ? 40 : 52)) + 'px';
      const hudBottom = top + (short ? 40 : 52) + timeSize + 34;
      const visible = h - bot - kb;
      // the puzzle sits between the HUD and whatever the keyboard leaves, nearer the top on phones
      const stageH = 190, avail = Math.max(stageH, visible - hudBottom - 20);
      const stageTop = hudBottom + Math.max(52, (avail - stageH) * (portrait ? (kb ? 0.3 : 0.32) : 0.42));
      H.stage.style.top = stageTop + 'px';
      H.scrim.style.top = (stageTop + 70) + 'px'; H.scrim.style.width = Math.min(w * 1.1, 760) + 'px'; H.scrim.style.height = '300px';
      H.foot.style.bottom = (bot + 14 + kb) + 'px';
      H.clue.style.fontSize = (w < 420 ? 17 : 20) + 'px';
      H.pop.style.top = '-50px';
      H.input.style.top = (stageTop + 40) + 'px'; H.input.style.left = '50%';
      // title
      const nameSize = Math.round(clamp(Math.min(w * 0.17, h * 0.1), 44, 96));
      H.tName.style.fontSize = nameSize + 'px'; H.tTag.style.fontSize = (w < 420 ? 17 : 20) + 'px';
      H.tHead.style.top = (top + h * (short ? 0.06 : 0.11)) + 'px';
      H.tLow.style.bottom = (bot + (short ? 16 : 32)) + 'px';
      H.rules.style.display = (short || save.days[day]) ? 'none' : '';
      H.sheet.style.paddingTop = '80px'; H.sheet.style.paddingBottom = (bot + 18) + 'px';
      H.sHead.style.fontSize = (w < 420 ? 26 : 32) + 'px'; H.sScore.style.fontSize = (w < 420 ? 44 : 56) + 'px';
      H.toast.style.bottom = (bot + 24) + 'px';
      D.shiftTarget = mode === 'over' && run && run.state === 'won' ? -0.16 : kb ? 0.02 : mode === 'title' && portrait ? 0.08 : portrait ? 0.2 : 0.3; // with our keyboard up, lift the traveller into the gap above it
      sizeSlots();
    }
    ctx.onResize(() => layout(), { immediate: true });

    // ---------- adaptive quality ----------
    let perfT = 0, perfN = 0, perfStage = 0;
    function adapt(dt) {
      if (perfStage > 1 || mode === 'title' || (window.__WA_DEV && window.__waNow)) return; // a virtual-clock recording keeps full quality
      perfT += dt; perfN++;
      if (perfT > 2.5) {
        const avg = perfT / perfN; perfT = 0; perfN = 0;
        if (avg > 1 / 40) {
          if (perfStage === 0) { renderer.setPixelRatio(Math.min(1.25, quality.dpr)); layout(); }
          else { renderer.setPixelRatio(1); layout(); }
          perfStage++;
        } else perfStage = 2;
      }
    }

    // ---------- frame ----------
    let dripAt = 6, lastNow = now(), devFreeze = false;
    function frame(dtMs) {
      if (destroyed) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000)), t = now();
      if (devFreeze && run && run.state === 'playing') { run.endAt += t - lastNow; }
      lastNow = t;
      if (mode === 'intro') { intro += dt; if (intro > 0.7) activate(); }
      if (mode === 'play' && run) {
        if (run.tick(t) === 'lost') lose();
        else if (autoT && t >= autoT) { autoT = 0; if (run.input.full && isAccepted(run.puzzle, run.input.word)) submit(); }
        // the caret follows the input once the next puzzle opens
        if (run.state === 'playing' && slotEls.length && run.accepting(t) !== H.slots._acc) { H.slots._acc = run.accepting(t); renderSlots(false); }
      }
      if (run && mode !== 'title') updateHud();
      // world state
      W.S.urgency = urgency; W.S.pulse += dt * Math.PI * 2 * (urgency > 0.66 ? 1.25 : 0.8);
      if (mode === 'over' && run && run.state === 'lost') W.S.dark = Math.min(1, W.S.dark + dt / 2.6);
      if (finaleT >= 0) {
        finaleT += dt;
        const landAt = D.move ? D.move.dur : 7;
        if (D.mode === 'final') {
          if (W.S.finale === 0) { audio.final(); haptic('success'); }
          W.S.finale = Math.min(1, W.S.finale + dt / 3.2); W.S.celebrate = Math.min(1, W.S.celebrate + dt / 1.2);
          if (W.S.finale >= 0.55 && !H.result.classList.contains('on')) showResult(true);
        }
        if (finaleT > landAt + 8 && !H.result.classList.contains('on')) showResult(true);
      }
      audio.depth(clamp(-D.slabY / 410, 0, 1));
      if ((dripAt -= dt) < 0) { dripAt = 5 + Math.random() * 9; if (mode !== 'title') audio.drip(); }
      if (mode === 'title') countdown();
      D.update(dt, ctx.width / ctx.height);
      const w = ctx.width, h = ctx.height;
      camera.setViewOffset(w, h, 0, -h * D.shift, w, h);
      W.update(dt, camera);
      renderer.render(W.scene, camera);
      adapt(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: frame });
    else ctx.onFrame(frame);

    renderTitle(); toTitle();
    try { frame(16); } catch (e) { bootFail('frame', e); return; }
    plat('ready');

    if (window.__WA_DEV) window.__wa = {
      get run() { return run; }, get mode() { return mode; }, W, D, camera, renderer, begin, submit, hint, typed, backspace, toTitle, showBoard, layout, save: () => save,
      // jump the clock forward for tests: shifts the run's deadline instead of touching the clock
      spend(sec) { if (run) { run.endAt -= sec * 1000; } },
      freeze(on) { devFreeze = !!on; },
      // camera at a puzzle stop (u == null) or partway through the descent after `level`
      jump(level, u, finale) {
        if (u == null) { if (level >= 5) { D.descend(4); D.t = 1e9; } else D.at(level); }
        else { D.descend(level); D.t = u * D.move.dur; }
        W.S.finale = finale || 0; W.S.celebrate = finale || 0; frame(16);
      }
    };
  }
};
