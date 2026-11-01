// ONE LAST THING: game flow, input, HUD.

window.plethoraBit = {
  meta: { title: 'One Last Thing', runtime: 'plethora-bit@2', tags: ['puzzle', '3d', 'packing'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const DEV = typeof window !== 'undefined' && window.__OLT_DEV;
    const { clamp, lerp, qAxis, qMul, qNorm, qSlerp, v3 } = U;
    let disposed = false; ctx.onDestroy(() => { disposed = true; });
    const area = () => ctx.contentSafeArea ?? ctx.safeArea ?? { top: 0, bottom: 120, left: 0, right: 0 };

    // ---------- surfaces ----------
    const bgRoot = ctx.createRoot({ layer: 'background', input: 'passthrough', style: 'background:#efe4cc;overflow:hidden;' });
    const canvas = ctx.createCanvas({ layer: 'content', touchAction: 'none' });
    canvas.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    const hud = ctx.createRoot({ layer: 'overlay', input: 'passthrough', className: 'olt' });
    hud.innerHTML = HUD_HTML;
    const $ = s => hud.querySelector(s);
    try { const bg = Paint.paperBg(512, 512, 7); bgRoot.style.backgroundImage = `radial-gradient(ellipse at 50% 35%, rgba(255,250,235,0.55), rgba(120,80,40,0.16) 95%), url(${bg.toDataURL('image/jpeg', 0.82)})`; bgRoot.style.backgroundSize = 'cover, 512px 512px'; } catch (e) { }
    // fonts (non-blocking)
    const fonts = [['DM Serif Display', 'dm-serif-display', { weight: '400', style: 'normal' }], ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'italic' }], ['Cormorant Garamond', 'cormorant-garamond', { weight: '300', style: 'normal' }], ['Nunito Sans', 'nunito-sans', { weight: '700', style: 'normal' }], ['Nunito Sans', 'nunito-sans', { weight: '400', style: 'normal' }]];
    const fontsReady = Promise.all(fonts.map(([fam, name, o]) => { try { return ctx.loadFont(fam, name, '1.0.0', o).catch(() => null); } catch (e) { return null; } }));

    // ---------- persistence ----------
    const store = {
      get(k, d) { try { const v = ctx.capabilities.storage ? ctx.storage.get('olt.' + k) : null; return v == null ? d : v; } catch (e) { return d; } },
      set(k, v) { try { if (ctx.capabilities.storage) ctx.storage.set('olt.' + k, v); } catch (e) { } },
    };
    const prefs = { muted: store.get('muted', false), mode: store.get('mode', 'fit'), unlocked: store.get('unlocked', 0), coach: store.get('coach', 0), best: store.get('best', {}) };

    // ---------- three ----------
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); }
    catch (e) {
      $('.olt-boot').innerHTML = '<div class="olt-boot-t">The drawer would not open.</div><div class="olt-boot-s">The 3D library failed to load. Check your connection and reopen.</div>';
      try { ctx.platform.error({ stage: 'library', message: String(e && e.message || e) }); } catch (_) { }
      return;
    }
    if (disposed) return;
    let view;
    try { view = createView(THREE, canvas, { dpr: ctx.dpr || 1, lowPower: (ctx.dpr || 1) > 2.5 }); }
    catch (e) {
      $('.olt-boot').innerHTML = '<div class="olt-boot-t">The drawer would not open.</div><div class="olt-boot-s">This device could not start a 3D view (WebGL).</div>';
      try { ctx.platform.error({ stage: 'renderer', message: String(e && e.message || e) }); } catch (_) { }
      return;
    }
    ctx.onDestroy(() => view.dispose());
    const audio = createAudio(ctx); audio.setMuted(prefs.muted);
    const haptic = k => { try { if (ctx.capabilities.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- state ----------
    const S = {
      lv: null, index: 0, endlessN: -1, dr: null, objs: [], held: null, ghost: null, undo: [],
      moves: 0, rearr: 0, undos: 0, t0: 0, elapsed: 0, started: false, done: false, failed: false,
      fine: false, toastT: 0, anim: [], time: 0, blocker: null, glow: null, admire: false, clockLimit: 0,
      next: null, nextGen: null, nextFor: -1, firstFrame: false, attempt: 0, coachStep: 0,
    };
    const placedBodies = () => S.objs.filter(o => o.state === 'placed').map(o => o.body);
    const nameOf = o => o.def.name.toLowerCase();

    // ---------- level loading ----------
    function puzzleFor(index) {
      if (index < Levels.count) return Levels.designed(index);
      return null;
    }
    function loadLevel(pz, opts = {}) {
      // clear old
      for (const o of S.objs) { view.scene.remove(o.vis.group); view.trayScene.remove(o.trayGroup); }
      if (S.ghost) { view.scene.remove(S.ghost); S.ghost = null; }
      S.lv = pz; S.index = pz.index; S.objs = []; S.held = null; S.undo = []; S.moves = S.rearr = S.undos = 0; S.elapsed = 0; S.started = false; S.done = false; S.failed = false; S.admire = false; S.anim = [];
      S.dr = World.makeDrawer(pz.W, pz.D, pz.H);
      view.buildDrawer(pz.W, pz.D, pz.H, { index: pz.index });
      // objects in catalogue order on the shelf
      const items = pz.items.map((it, i) => ({ it, i })).sort((a, b) => Catalog.byId[a.it.id].no - Catalog.byId[b.it.id].no);
      items.forEach(({ it, i }, k) => {
        const def = Catalog.byId[it.id], scale = it.scale || 1;
        const vis = view.buildObject(def, scale, U.hashStr(def.id) + i);
        const body = World.makeBody(def.id + '#' + i, def, scale);
        const trayGroup = vis.group.clone();
        const o = { uid: def.id + '#' + i, def, scale, vis, body, trayGroup, state: 'tray', trayX: k * 10, trayYaw: 0, k };
        vis.group.userData.objRef = o;
        // centre the shelf copy on its footprint, scale it to fit a slot
        const b = vis.box, sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
        const fit = Math.min(1, 7.6 / Math.max(sx, sz * 0.8), 6.4 / sy);
        o.trayFit = fit; o.trayOff = [-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2];
        trayGroup.scale.setScalar(scale * fit);
        view.trayScene.add(trayGroup);
        S.objs.push(o);
      });
      view.resetOrbit(); view.orbit.init = false;
      layout();
      view.tray.scroll = 0; S.trayV = 0;
      S.clockLimit = prefs.mode === 'clock' ? Math.round(pz.items.length * 40 + 20) : 0;
      S.attempt++;
      updateHud(); setToast('');
      $('.olt-result').classList.remove('on');
      saveProgress();
      if (S.index === 0 && !prefs.coach) startCoach(); else stopCoach();
      // background: prepare the next endless drawer while this one is played
      if (pz.index >= Levels.count - 2) prepareNext(pz.index + 1);
    }
    function levelByIndex(i) {
      if (i < Levels.count) { const pz = puzzleFor(i); const v = Packer.verify(pz); if (!v.ok) { console.warn('designed level failed verification', i, v.problems); } return v.ok ? pz : null; }
      return null;
    }
    function prepareNext(index) {
      if (index < Levels.count) return;
      if (S.nextFor === index && (S.next || S.nextGen)) return;
      S.nextFor = index; S.next = null; S.nextGen = Levels.endlessGen(index - Levels.count);
    }
    function stepGen(budgetMs) {
      if (!S.nextGen) return;
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) {
        const r = S.nextGen.next();
        if (r.done) {
          S.nextGen = null;
          const pz = r.value;
          if (pz && Packer.verify(pz).ok) S.next = pz; // only verified puzzles are presented
          else { S.nextFor = -1; prepareNext(S.waitingFor || S.index + 1); }
          break;
        }
      }
    }
    function goLevel(i) {
      if (S.lv && i === S.index && S.lv.endless != null) { loadLevel(S.lv); return; } // restart the same endless drawer
      if (i < Levels.count) { const pz = levelByIndex(i); if (pz) loadLevel(pz); return; }
      prepareNext(i);
      if (S.next && S.nextFor === i) { const pz = S.next; S.next = null; S.nextFor = -1; loadLevel(pz); return; }
      S.waitingFor = i; $('.olt-preparing').classList.add('on');
    }

    function saveProgress() {
      store.set('current', S.index);
      try { if (ctx.game && ctx.game.progress) ctx.game.progress.save('main', { state: { level: S.index }, label: 'Drawer ' + (S.index + 1), percent: Math.min(1, S.index / Levels.count), stateSchemaVersion: 1 }).catch(() => { }); } catch (e) { }
    }

    // ---------- object state ----------
    function setPoseVis(o, p, q) { o.vis.group.position.set(p[0], p[1], p[2]); o.vis.group.quaternion.set(q[0], q[1], q[2], q[3]); }
    function setState(o, st, pose) {
      o.state = st;
      if (st === 'tray') { view.scene.remove(o.vis.group); view.trayScene.add(o.trayGroup); o.trayGroup.visible = true; }
      else { view.trayScene.remove(o.trayGroup); if (!o.vis.group.parent) view.scene.add(o.vis.group); }
      if (st === 'placed' && pose) { World.setPose(o.body, pose.p, pose.q); setPoseVis(o, pose.p, pose.q); }
    }
    function snapshot() { return S.objs.map(o => { const st = S.held && S.held.obj === o ? S.held.from : { state: o.state, pose: o.state === 'placed' ? World.poseOf(o.body) : null }; return { o, state: st.state, pose: st.pose }; }); }
    function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); }
    function restore(snap) {
      dropHeldVisuals(); S.held = null; S.anim = [];
      for (const s of snap) setState(s.o, s.state, s.pose);
      clearBlocker(); updateHud();
    }

    // ---------- holding ----------
    const HOVER = 0.9; // cm above the rim when hovering
    function heldBodyPose(h) {
      // orientation h.q, footprint centre (cx, cz), bottom at hover or lowered height
      const b = h.obj.body;
      World.setPose(b, [0, 0, 0], h.q);
      const bb = b.box, bottom = h.lower == null ? S.dr.H + HOVER : h.lower;
      // the walls hold the piece inside whenever its footprint can fit; otherwise centre that axis
      const hw = (bb[3] - bb[0]) / 2, hd = (bb[5] - bb[2]) / 2, dr = S.dr, e = 0.02;
      h.cx = hw * 2 <= dr.W ? clamp(h.cx, dr.x0 + hw + e, dr.x1 - hw - e) : 0;
      h.cz = hd * 2 <= dr.D ? clamp(h.cz, dr.z0 + hd + e, dr.z1 - hd - e) : 0;
      const p = [h.cx - (bb[0] + bb[3]) / 2, bottom - bb[1], h.cz - (bb[2] + bb[5]) / 2];
      World.setPose(b, p, h.q);
      return { p, q: h.q.slice() };
    }
    function grab(o, from, cx, cz) {
      if (S.done) return;
      firstGesture();
      if (S.held) cancelHeld(false);
      const q = from.state === 'placed' ? o.body.q.slice() : [0, 0, 0, 1];
      if (from.state === 'placed') { const bb = o.body.box; cx = (bb[0] + bb[3]) / 2; cz = (bb[2] + bb[5]) / 2; }
      setState(o, 'held');
      S.held = { obj: o, from, q, cx, cz, lower: null, res: null, dirty: true, lastCalc: -1, shake: 0, probe: World.makeBody('probe', o.def, o.scale) };
      const pose = heldBodyPose(S.held);
      if (from.state === 'tray') { // appear from the shelf
        setPoseVis(o, [pose.p[0], pose.p[1] + 2, pose.p[2] + 3], pose.q);
      }
      o.vis.oMat.uniforms.uColor.value.set(0x6b3d14); o.vis.oMat.uniforms.uW.value = 2.2;
      S.ghost = view.ghostOf(o.vis, 0xc98e2f); view.scene.add(S.ghost); S.ghost.visible = false;
      audio.play('lift'); haptic('light');
      try { ctx.platform.interact({ action: 'pick', object: o.def.id }); } catch (e) { }
      coachEvent('grab');
      updateHud();
    }
    function dropHeldVisuals() {
      if (S.ghost) { view.scene.remove(S.ghost); S.ghost = null; }
      view.setDropLine(null); view.glowWall(null, 0);
      if (S.held) { const u = S.held.obj.vis.oMat.uniforms; u.uColor.value.set(0x2a1a12); u.uW.value = 1.5; }
    }
    function cancelHeld(sound = true) {
      const h = S.held; if (!h) return;
      dropHeldVisuals(); S.held = null; clearBlocker();
      if (h.from.state === 'placed') { setState(h.obj, 'placed', h.from.pose); }
      else setState(h.obj, 'tray');
      if (sound) audio.play('turn');
      updateHud();
    }
    function returnToTray() {
      const h = S.held; if (!h) return;
      if (h.from.state === 'placed') { pushUndo(); S.rearr++; }
      dropHeldVisuals(); S.held = null; clearBlocker();
      setState(h.obj, 'tray');
      audio.play(h.obj.def.snd === 'paper' ? 'paper' : 'turn', 0.6);
      updateHud(); setToast('');
    }
    function markDirty() { if (S.held) { S.held.dirty = true; } }
    function computeSettle(force) {
      const h = S.held; if (!h || (!h.dirty && !force)) return h && h.res;
      const pose = heldBodyPose(h);
      World.setPose(h.probe, pose.p, pose.q);
      const res = World.settle(h.probe, placedBodies(), S.dr);
      res.final = World.poseOf(h.probe);
      res.start = pose;
      h.res = res; h.dirty = false; h.lastCalc = S.time;
      showFeedback(res);
      return res;
    }
    function clearBlocker() {
      if (S.blocker) { const u = S.blocker.vis.oMat.uniforms; u.uColor.value.set(0x2a1a12); u.uW.value = 1.5; S.blocker = null; }
      S.glow = null;
    }
    function showFeedback(res) {
      clearBlocker();
      const g = S.ghost; if (!g) return;
      const col = res.ok ? 0xc98e2f : 0xd4462a;
      g.userData.mat.color.set(col); g.userData.om.uniforms.uColor.value.set(col);
      const fp = res.final;
      g.position.set(fp.p[0], fp.p[1], fp.p[2]); g.quaternion.set(fp.q[0], fp.q[1], fp.q[2], fp.q[3]);
      g.visible = res.frames.length > 1 || !res.ok;
      if (!res.ok && res.reason === 'overlap' && res.blocker) {
        const bo = S.objs.find(o => o.body === res.blocker);
        if (bo) { S.blocker = bo; bo.vis.oMat.uniforms.uColor.value.set(0xd4462a); bo.vis.oMat.uniforms.uW.value = 2.6; }
      }
      if (!res.ok && (res.reason === 'outside' || res.reason === 'tall')) S.glow = res.side || 'top';
      const s = res.start, bb = S.held.obj.body.box;
      view.setDropLine([(bb[0] + bb[3]) / 2, bb[1], (bb[2] + bb[5]) / 2], [(bb[0] + bb[3]) / 2, Math.max(0, bb[1] - (s.p[1] - fp.p[1])), (bb[2] + bb[5]) / 2]);
    }
    const SIDE = { left: 'the left wall', right: 'the right wall', back: 'the back wall', front: 'the front panel', top: 'the rim', floor: 'the floor' };
    function reasonText(res) {
      const n = nameOf(S.held.obj);
      switch (res.reason) {
        case 'tall': return `Too tall. The ${n} rises above the rim, so try tipping or rolling it.`;
        case 'outside': return `The ${n} would hang over ${SIDE[res.side] || 'the edge'}.`;
        case 'overlap': { const bo = S.objs.find(o => o.body === res.blocker); return bo ? `It would pass through the ${nameOf(bo)}.` : 'Something is in the way.'; }
        case 'topple': return `The ${n} wouldn't stay put there. It would topple.`;
        default: return 'That doesn’t fit there.';
      }
    }
    function place() {
      const h = S.held; if (!h || S.done) return;
      const res = computeSettle(true);
      if (!res.ok) {
        h.shake = 1; audio.play('nope'); haptic('warning'); setToast(reasonText(res), 'bad');
        coachEvent('fail', res);
        return;
      }
      pushUndo();
      const o = h.obj, from = h.from;
      if (from.state === 'placed') S.rearr++;
      S.moves++;
      dropHeldVisuals(); S.held = null;
      // the body takes its settled pose immediately; the mesh follows the recorded settle path
      World.setPose(o.body, res.final.p, res.final.q);
      o.state = 'placed';
      const g = o.vis.group;
      const path = [{ p: [g.position.x, g.position.y, g.position.z], q: [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w] }].concat(res.frames.slice(1));
      S.anim.push(makeSettleAnim(o, path, res));
      setToast('');
      try { ctx.platform.interact({ action: 'place', object: o.def.id }); } catch (e) { }
      coachEvent('place');
      updateHud();
    }
    function makeSettleAnim(o, path, res) {
      // duration per segment: falls accelerate, tips swing
      const segs = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const dy = a.p[1] - b.p[1], ang = U.qAngleBetween(a.q, b.q), dxz = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
        const fall = dy > 0.05 && ang < 0.01;
        const dur = fall ? Math.sqrt(2 * dy / 520) + 0.02 : Math.max(0.045, ang * 0.32 + dxz * 0.03);
        segs.push({ a, b, dur, fall, dy });
      }
      return { o, segs, i: 0, t: 0, landed: false, res, wob: 0 };
    }
    function stepAnims(dt) {
      for (const an of S.anim) {
        if (an.i >= an.segs.length) { // tiny settle wobble then rest
          an.wob += dt;
          const f = an.res.final, k = Math.exp(-an.wob * 9) * Math.sin(an.wob * 38) * 0.012;
          const q = qMul(qAxis(1, 0, 0.4, k), f.q);
          setPoseVis(an.o, f.p, q);
          if (an.wob > 0.45) { setPoseVis(an.o, f.p, f.q); an.dead = true; }
          continue;
        }
        const s = an.segs[an.i];
        an.t += dt;
        let t = Math.min(1, an.t / s.dur);
        const e = s.fall ? t * t : U.easeInOut(t);
        setPoseVis(an.o, v3.lerp(s.a.p, s.b.p, e), qSlerp(s.a.q, s.b.q, e));
        if (t >= 1) {
          if (s.fall && !an.landed) { an.landed = true; impact(an.o, Math.min(1.1, 0.35 + s.dy * 0.12)); }
          an.i++; an.t = 0;
          if (an.i >= an.segs.length && !an.landed) { an.landed = true; impact(an.o, 0.5); }
          if (an.i >= an.segs.length && an.segs.length > 1 && an.segs[an.segs.length - 1].fall === false) impact(an.o, 0.35);
        }
      }
      if (S.anim.some(a => a.dead)) { S.anim = S.anim.filter(a => !a.dead); checkComplete(); }
    }
    function impact(o, k) { audio.play(o.def.snd, k); haptic(k > 0.7 ? 'medium' : 'light'); }

    // ---------- rotation & height ----------
    function rotateHeld(axis, sign) {
      const h = S.held; if (!h) return;
      firstGesture();
      const ang = (S.fine ? Math.PI / 12 : Math.PI / 2) * sign;
      const ax = axis === 'y' ? [0, 1, 0] : axis === 'x' ? [1, 0, 0] : [0, 0, 1];
      h.q = qNorm(qMul(qAxis(ax[0], ax[1], ax[2], ang), h.q));
      h.spin = { axis: ax, ang, t: 0 };
      markDirty(); audio.play('turn'); haptic('light');
      coachEvent('rotate');
    }
    function liftHeld(dir) {
      const h = S.held; if (!h) return;
      const auto = S.dr.H + HOVER;
      let cur = h.lower == null ? auto : h.lower;
      cur = dir > 0 ? cur + 1 : Math.max(0, Math.floor(cur - 1));
      h.lower = cur >= auto - 0.01 ? null : cur;
      markDirty(); audio.play('tick'); haptic('light');
      updateHud();
    }

    // ---------- completion ----------
    function checkComplete() {
      if (S.done || S.held || S.anim.length) return;
      if (S.objs.some(o => o.state !== 'placed')) return;
      const problems = World.validate(placedBodies(), S.dr);
      if (problems.length) { console.warn('arrangement problems', problems); return; }
      S.done = true; S.admire = true;
      const lvl = S.index + 1;
      audio.chime(true); haptic('success');
      prefs.unlocked = Math.max(prefs.unlocked, S.index + 1); store.set('unlocked', prefs.unlocked);
      const prevBest = prefs.best[S.index];
      const rec = { t: Math.round(S.elapsed), m: S.moves };
      if (!prevBest || rec.t < prevBest.t) { prefs.best[S.index] = rec; store.set('best', prefs.best); }
      if (S.index === 0) { prefs.coach = 1; store.set('coach', 1); stopCoach(); }
      try { ctx.platform.milestone('drawer_packed', { level: lvl }); ctx.platform.complete({ level: lvl, timeMs: Math.round(S.elapsed * 1000), moves: S.moves }); } catch (e) { }
      const attempt = S.attempt;
      try {
        if (ctx.memory && ctx.memory.record) {
          const r = ctx.memory.record('drawers');
          r.submit(lvl, { label: 'Drawer ' + lvl }).then(() => r.rank({ scope: 'global', period: 'all_time' })).then(st => {
            if (disposed || attempt !== S.attempt) return;
            const vr = st && st.viewerRank;
            $('.olt-rank').textContent = vr && vr.rank ? `Among packers: No. ${vr.rank} of ${st.totalRanked}` : '';
          }).catch(() => { if (!disposed && attempt === S.attempt) $('.olt-rank').textContent = ''; });
        }
      } catch (e) { }
      if (S.index + 1 >= Levels.count - 1) prepareNext(S.index + 1);
      ctx.timeout(() => { if (!disposed && attempt === S.attempt) showResult(); }, 1700);
    }
    function showResult() {
      const n = S.objs.length;
      const stars = S.moves <= n ? 3 : S.moves <= Math.ceil(n * 1.5) ? 2 : 1;
      let vol = 0; for (const o of S.objs) vol += o.body.mass;
      const used = Math.round(vol / (S.dr.W * S.dr.D * S.dr.H) * 100);
      $('.olt-r-title').textContent = `Drawer No. ${S.index + 1}`;
      $('.olt-r-name').textContent = S.lv.name || '';
      $('.olt-r-stars').innerHTML = '<span class="on">✦</span>'.repeat(stars) + '<span>✦</span>'.repeat(3 - stars);
      $('.olt-r-rows').innerHTML = [
        [`${n}/${n}`, 'placed'], [fmtTime(S.elapsed), 'time'], [S.moves, S.rearr ? `moves · ${S.rearr} redone` : 'moves'], [`${used}%`, 'space used'],
      ].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
      $('.olt-r-status').textContent = 'Everything fits. Nothing sticks out, nothing overlaps.';
      $('.olt-result').classList.add('on');
      try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ level: S.index + 1, timeMs: Math.round(S.elapsed * 1000), timeLabel: fmtTime(S.elapsed), text: `Packed drawer No. ${S.index + 1} in ${fmtTime(S.elapsed)}` }); } catch (e) { }
    }
    function timeUp() {
      if (S.done || S.failed) return;
      S.failed = true; if (S.held) cancelHeld(false);
      audio.play('nope'); haptic('error');
      try { ctx.platform.fail({ level: S.index + 1, reason: 'time' }); } catch (e) { }
      $('.olt-r-title').textContent = 'Time’s up';
      $('.olt-r-name').textContent = `Drawer No. ${S.index + 1}`;
      $('.olt-r-stars').innerHTML = '';
      const placed = S.objs.filter(o => o.state === 'placed').length;
      $('.olt-r-rows').innerHTML = [[`${placed}/${S.objs.length}`, 'placed'], [S.moves, 'moves']].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
      $('.olt-r-status').textContent = 'Not everything made it in. Try again?';
      $('.olt-rank').textContent = '';
      $('.olt-next').textContent = 'Try again';
      $('.olt-result').classList.add('on');
    }
    const fmtTime = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

    function firstGesture() {
      audio.unlock();
      if (!S.started) { S.started = true; S.t0 = S.time; try { ctx.platform.start({ level: S.index + 1, mode: prefs.mode }); } catch (e) { } }
    }

    // ---------- HUD ----------
    function updateHud() {
      const placed = S.objs.filter(o => o.state === 'placed').length, n = S.objs.length;
      $('.olt-no').textContent = 'No. ' + (S.index + 1);
      $('.olt-name').textContent = S.lv ? S.lv.name : '';
      $('.olt-count').textContent = `${placed} of ${n} placed`;
      const holding = !!S.held;
      hud.classList.toggle('holding', holding);
      $('.olt-fine').classList.toggle('on', S.fine);
      $('.olt-fine b').textContent = S.fine ? '15°' : '90°';
      $('.olt-undo').disabled = !S.undo.length;
      $('.olt-reset').disabled = !S.objs.some(o => o.state === 'placed');
      const left = S.objs.filter(o => o.state === 'tray').length;
      $('.olt-shelf-cap').textContent = holding ? 'Tap the shelf to put it back' : left ? `The collection · ${left} to go` : 'The collection is empty';
      $('.olt-sound').classList.toggle('off', audio.muted);
      if (S.held) $('.olt-lift-v').textContent = S.held.lower == null ? 'above' : S.held.lower.toFixed(0) + ' cm';
    }
    let toastTimer = 0;
    function setToast(text, kind) {
      const t = $('.olt-toast'); t.textContent = text; t.className = 'olt-toast' + (text ? ' on' : '') + (kind ? ' ' + kind : '');
      toastTimer = text ? 4.5 : 0;
    }

    // tray labels (DOM, follow the shelf scroll)
    const labelsEl = $('.olt-labels');
    function updateLabels() {
      const r = view.view.trayRect, tr = view.tray;
      const tr0 = S.objs.filter(o => o.state === 'tray');
      let html = '';
      for (const o of tr0) {
        const x = r.x + (o.trayX - tr.scroll) / tr.unit * tr.slotPx + tr.slotPx / 2;
        if (x < -60 || x > r.x + r.w + 60) continue;
        html += `<div class="olt-label" style="transform:translateX(${x.toFixed(1)}px);width:${tr.slotPx - 8}px;margin-left:${-(tr.slotPx - 8) / 2}px"><i>No. ${o.def.no}</i>${o.def.name}</div>`;
      }
      if (html !== labelsEl._h) { labelsEl.innerHTML = html; labelsEl._h = html; }
    }

    // ---------- layout ----------
    const L = { trayTop: 0, trayBottom: 0, rowTop: 0 };
    function layout() {
      const w = ctx.width, h = ctx.height, a = area();
      const top = a.top + 66, trayH = clamp(Math.round(h * 0.16), 112, 150), rowH = 64;
      L.trayBottom = h - Math.max(a.bottom, 8) - 2; L.trayTop = L.trayBottom - trayH; L.rowTop = L.trayTop - rowH;
      const drawerRect = { x: 8, y: top, w: w - 16, h: Math.max(120, L.rowTop - top - 6) };
      const trayRect = { x: 0, y: L.trayTop + 22, w, h: trayH - 22 - 24 };
      view.layout(w, h, drawerRect, trayRect);
      view.tray.slotPx = clamp(Math.round(w / 4.3), 84, 120);
      hud.style.setProperty('--top', a.top + 'px');
      hud.style.setProperty('--row', L.rowTop + 'px');
      hud.style.setProperty('--tray', L.trayTop + 'px');
      hud.style.setProperty('--trayb', (h - L.trayBottom) + 'px');
      hud.style.setProperty('--labels', (L.trayBottom - 22) + 'px');
      hud.style.setProperty('--sl', (a.left || 0) + 'px'); hud.style.setProperty('--sr', (a.right || 0) + 'px');
    }
    ctx.onResize(() => { if (S.lv) layout(); }, { immediate: false });

    // ---------- input ----------
    const ptrs = new Map();
    let drag = null, gest = null;
    const inTray = y => y >= L.trayTop;
    const inRow = y => y >= L.rowTop && y < L.trayTop;
    function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function traySlotAt(x) {
      const r = view.view.trayRect, tr = view.tray;
      const wx = tr.scroll + (x - r.x - tr.slotPx / 2) / tr.slotPx * tr.unit;
      let best = null, bd = 6;
      for (const o of S.objs) if (o.state === 'tray') { const d = Math.abs(o.trayX - wx); if (d < bd) { bd = d; best = o; } }
      return best;
    }
    function heldPlaneY() { const h = S.held; return h ? (h.lower == null ? S.dr.H + HOVER : h.lower) : S.dr.H; }
    function moveHeldTo(x, y, off) {
      const hit = view.planeHit(x, y, heldPlaneY()); if (!hit) return;
      const m = 6;
      S.held.cx = clamp(hit.x + off[0], -S.dr.W / 2 - m, S.dr.W / 2 + m);
      S.held.cz = clamp(hit.z + off[1], -S.dr.D / 2 - m, S.dr.D / 2 + m);
      markDirty();
    }
    ctx.listen(canvas, 'pointerdown', e => {
      if (!S.lv || $('.olt-menu').classList.contains('on')) return;
      const [x, y] = local(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
      ptrs.set(e.pointerId, { x, y, x0: x, y0: y });
      audio.unlock();
      if (ptrs.size === 2) { startGesture(); return; }
      if (ptrs.size > 2) return;
      if (S.done) { drag = { kind: 'orbit', x, y, moved: 0 }; return; }
      if (inTray(y)) {
        drag = S.held ? { kind: 'trayReturn', x, y, moved: 0, obj: traySlotAt(x) } : { kind: 'tray', x, y, x0: x, y0: y, moved: 0, scroll0: view.tray.scroll, obj: traySlotAt(x), t: S.time };
        return;
      }
      if (inRow(y)) return;
      if (S.held) {
        const hit = view.planeHit(x, y, heldPlaneY());
        const off = hit ? [S.held.cx - hit.x, S.held.cz - hit.z] : [0, 0];
        drag = { kind: 'held', x, y, moved: 0, off };
        return;
      }
      const pk = view.pick(x, y, S.objs.filter(o => o.state === 'placed').map(o => o.vis.group));
      if (pk) {
        const o = pk.obj;
        const an = S.anim.find(a => a.o === o);
        if (an) { setPoseVis(o, an.res.final.p, an.res.final.q); S.anim = S.anim.filter(a => a !== an); }
        const on = World.restingOn(o.body, placedBodies(), S.dr);
        if (on.length) {
          const names = on.map(b => nameOf(S.objs.find(oo => oo.body === b)));
          setToast(`The ${names[0]}${names.length > 1 ? ' and more are' : ' is'} resting on the ${nameOf(o)}. Lift that first.`, 'bad');
          audio.play('nope'); haptic('warning');
          for (const b of on) { const oo = S.objs.find(q => q.body === b); flashOutline(oo); }
          drag = { kind: 'orbit', x, y, moved: 0 };
          return;
        }
        grab(o, { state: 'placed', pose: World.poseOf(o.body) });
        const hit = view.planeHit(x, y, heldPlaneY());
        drag = { kind: 'held', x, y, moved: 0, off: hit ? [S.held.cx - hit.x, S.held.cz - hit.z] : [0, 0], fresh: true };
        return;
      }
      drag = { kind: 'orbit', x, y, moved: 0 };
    });
    ctx.listen(canvas, 'pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const [x, y] = local(e); const dx = x - p.x, dy = y - p.y; p.x = x; p.y = y;
      if (gest) { moveGesture(); return; }
      if (!drag) return;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.kind === 'tray') {
        const tdx = x - drag.x0, tdy = y - drag.y0;
        if (!drag.mode && Math.hypot(tdx, tdy) > 9) drag.mode = (tdy < -Math.abs(tdx) * 0.7 && drag.obj) ? 'lift' : 'scroll';
        if (drag.mode === 'scroll') { view.tray.scroll = drag.scroll0 - tdx / view.tray.slotPx * view.tray.unit; S.trayV = -dx / view.tray.slotPx * view.tray.unit / Math.max(1 / 120, S.lastDt || 1 / 60); }
        if (drag.mode === 'lift' && y < L.trayTop - 4) {
          // lift the object off the shelf straight into the drawer view, just above the finger
          const o = drag.obj;
          const hit = view.planeHit(x, y - 46, S.dr.H + HOVER);
          grab(o, { state: 'tray' }, hit ? hit.x : 0, hit ? hit.z : 0);
          drag = { kind: 'held', x, y, moved: 99, off: [0, 0], fromTray: true, dyOff: -46 };
          if (hit) { S.held.cx = hit.x; S.held.cz = hit.z; }
        }
        return;
      }
      if (drag.kind === 'held' && S.held) {
        if (drag.moved < 5 && !drag.fromTray) return;
        S.held.overTray = inTray(y);
        hud.classList.toggle('overtray', S.held.overTray);
        if (!S.held.overTray) moveHeldTo(x, y + (drag.dyOff || 0), drag.off);
        return;
      }
      if (drag.kind === 'orbit') view.nudgeOrbit(-dx * 0.0065, -dy * 0.0045);
    });
    const endPtr = e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      ptrs.delete(e.pointerId);
      if (gest) { if (ptrs.size < 2) { gest = null; drag = null; } return; }
      const d = drag; drag = null; if (!d) return;
      const [x, y] = local(e);
      const cancelled = e.type === 'pointercancel';
      if (d.kind === 'tray') {
        if (!d.mode && d.obj && !cancelled) { // tap: pick it up to inspect, hovering over the drawer
          grab(d.obj, { state: 'tray' }, 0, 0);
          setToast('Turn it with the buttons, then drag it into place.', 'hint');
        }
        return;
      }
      if (d.kind === 'trayReturn') { if (d.moved < 12 && !cancelled) { const other = d.obj; returnToTray(); if (other && other.state === 'tray') grab(other, { state: 'tray' }, 0, 0); } return; }
      if (d.kind === 'held' && S.held) {
        hud.classList.remove('overtray');
        if (cancelled) return;
        if (S.held.overTray) { S.held.overTray = false; returnToTray(); return; }
        if (d.moved >= 6 || d.fromTray) { place(); return; }
        if (d.fresh) return; // a tap that just picked it up
        // a tap while holding: on the held object places it, on another swaps
        const pk = view.pick(x, y, S.objs.filter(o => o.state === 'placed' || o === S.held.obj).map(o => o.vis.group));
        if (pk && pk.obj === S.held.obj) place();
        else if (pk && pk.obj.state === 'placed') { const o = pk.obj; if (!World.restingOn(o.body, placedBodies(), S.dr).length) grab(o, { state: 'placed', pose: World.poseOf(o.body) }); }
      }
    };
    ctx.listen(canvas, 'pointerup', endPtr);
    ctx.listen(canvas, 'pointercancel', endPtr);
    function gestureState() {
      const [a, b] = [...ptrs.values()];
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x), dist: Math.hypot(b.x - a.x, b.y - a.y) };
    }
    function startGesture() { drag = null; gest = gestureState(); gest.acc = 0; hud.classList.remove('overtray'); if (S.held) S.held.overTray = false; }
    function moveGesture() {
      if (ptrs.size < 2) return;
      const g = gestureState();
      let da = g.ang - gest.ang; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      const zoom = gest.dist / Math.max(1, g.dist);
      if (S.held && !S.done) {
        const h = S.held; h.q = qNorm(qMul(qAxis(0, 1, 0, -da), h.q)); markDirty();
        gest.acc += Math.abs(da); if (gest.acc > 0.25) { audio.play('tick', 0.5); gest.acc = 0; }
        view.nudgeOrbit(0, -(g.cy - gest.cy) * 0.004, zoom);
      } else view.nudgeOrbit(-(g.cx - gest.cx) * 0.006 + da * 0.6, -(g.cy - gest.cy) * 0.004, zoom);
      gest.cx = g.cx; gest.cy = g.cy; gest.ang = g.ang; gest.dist = g.dist;
    }
    ctx.listen(canvas, 'wheel', e => { e.preventDefault(); view.nudgeOrbit(0, 0, e.deltaY > 0 ? 1.06 : 1 / 1.06); }, { passive: false });
    ctx.listen(window, 'keydown', e => {
      if (!S.lv) return;
      const k = e.key.toLowerCase();
      if (S.held) {
        const step = e.shiftKey ? 0.2 : 0.8;
        if (k === 'arrowleft') { S.held.cx -= step; markDirty(); }
        else if (k === 'arrowright') { S.held.cx += step; markDirty(); }
        else if (k === 'arrowup') { S.held.cz -= step; markDirty(); }
        else if (k === 'arrowdown') { S.held.cz += step; markDirty(); }
        else if (k === 'q' || k === 'e') rotateHeld('y', k === 'q' ? 1 : -1);
        else if (k === 'w' || k === 's') rotateHeld('x', k === 'w' ? -1 : 1);
        else if (k === 'a' || k === 'd') rotateHeld('z', k === 'a' ? 1 : -1);
        else if (k === 'r') liftHeld(1); else if (k === 'f') liftHeld(-1);
        else if (k === 'enter' || k === ' ') place();
        else if (k === 'escape' || k === 'backspace') returnToTray();
        else return;
        e.preventDefault(); return;
      }
      if (k === 'z') doUndo(); else if (k === 'c') view.resetOrbit();
    });
    function flashOutline(o) { if (!o) return; const u = o.vis.oMat.uniforms; u.uColor.value.set(0xc98e2f); u.uW.value = 2.6; ctx.timeout(() => { if (S.blocker !== o && !(S.held && S.held.obj === o)) { u.uColor.value.set(0x2a1a12); u.uW.value = 1.5; } }, 900); }

    // buttons
    const on = (sel, fn) => ctx.listen($(sel), 'click', e => { e.stopPropagation(); audio.unlock(); fn(e); });
    on('.olt-turn', () => rotateHeld('y', 1));
    on('.olt-tip', () => rotateHeld('x', 1));
    on('.olt-roll', () => rotateHeld('z', -1));
    on('.olt-fine', () => { S.fine = !S.fine; updateHud(); audio.play('tick'); });
    on('.olt-up', () => liftHeld(1));
    on('.olt-down', () => liftHeld(-1));
    on('.olt-place', () => place());
    on('.olt-back', () => returnToTray());
    on('.olt-undo', () => doUndo());
    on('.olt-reset', () => { if (S.done) return; if (S.held) cancelHeld(false); pushUndo(); for (const o of S.objs) if (o.state === 'placed') setState(o, 'tray'); S.anim = []; updateHud(); audio.play('paper', 0.8); setToast('Everything is back on the shelf. Undo brings it back.', 'hint'); });
    on('.olt-view', () => { view.resetOrbit(); audio.play('tick'); });
    on('.olt-sound', () => { audio.setMuted(!audio.muted); prefs.muted = audio.muted; store.set('muted', prefs.muted); updateHud(); });
    on('.olt-menu-btn', () => openMenu());
    on('.olt-menu-close', () => $('.olt-menu').classList.remove('on'));
    on('.olt-admire', () => { $('.olt-result').classList.remove('on'); $('.olt-again').classList.add('on'); });
    on('.olt-again', () => { $('.olt-again').classList.remove('on'); $('.olt-result').classList.add('on'); });
    on('.olt-next', () => { $('.olt-again').classList.remove('on'); $('.olt-next').textContent = 'Next drawer'; if (S.failed) goLevel(S.index); else goLevel(S.index + 1); });
    on('.olt-restart', () => { $('.olt-menu').classList.remove('on'); goLevel(S.index); });
    on('.olt-mode', () => { prefs.mode = prefs.mode === 'fit' ? 'clock' : 'fit'; store.set('mode', prefs.mode); renderMenu(); goLevel(S.index); $('.olt-menu').classList.remove('on'); });
    ctx.listen($('.olt-levels'), 'click', e => {
      const b = e.target.closest('[data-l]'); if (!b || b.disabled) return;
      $('.olt-menu').classList.remove('on'); goLevel(+b.dataset.l);
    });
    function doUndo() {
      if (!S.undo.length || S.done) return;
      restore(S.undo.pop()); S.undos++; audio.play('turn'); setToast('');
    }
    function openMenu() { renderMenu(); $('.olt-menu').classList.add('on'); }
    function renderMenu() {
      const maxL = Math.max(prefs.unlocked, S.index);
      let h = '';
      for (let i = 0; i < Levels.count; i++) {
        const ok = i <= maxL, b = prefs.best[i];
        h += `<button data-l="${i}" ${ok ? '' : 'disabled'} class="${i === S.index ? 'cur' : ''} ${b ? 'done' : ''}"><b>${i + 1}</b><i>${ok ? Levels.DEFS[i].name : 'locked'}</i></button>`;
      }
      const eN = Math.max(Levels.count, Math.min(maxL, 999));
      h += `<button data-l="${Math.max(Levels.count, S.index >= Levels.count ? S.index : Levels.count)}" ${prefs.unlocked >= Levels.count ? '' : 'disabled'} class="endless"><b>∞</b><i>${prefs.unlocked >= Levels.count ? 'Endless drawers' : 'Endless · finish No. 12'}</i></button>`;
      $('.olt-levels').innerHTML = h;
      $('.olt-mode b').textContent = prefs.mode === 'fit' ? 'Fit everything' : 'Beat the clock';
    }

    // ---------- onboarding: a small worked example on the first drawer ----------
    function startCoach() { S.coachStep = 1; hud.classList.add('coach1'); }
    function stopCoach() { S.coachStep = 0; hud.classList.remove('coach1', 'coach2'); }
    function coachEvent(ev, res) {
      if (!S.coachStep) return;
      if (ev === 'grab' && S.coachStep === 1) { S.coachStep = 2; hud.classList.remove('coach1'); hud.classList.add('coach2'); }
      if (ev === 'rotate' || ev === 'place') { hud.classList.remove('coach2'); if (ev === 'place') S.coachStep = 3; }
    }

    // ---------- main loop ----------
    let lastHud = 0;
    ctx.game.loop({
      update(dtMs) {
        if (disposed || !S.lv) return;
        const dt = Math.min(0.05, dtMs / 1000); S.lastDt = dt; S.time += dt;
        if (S.started && !S.done && !S.failed) S.elapsed += dt;
        if (S.clockLimit && S.started && !S.done && !S.failed && S.elapsed >= S.clockLimit) timeUp();
        // completion admiration: a slow drift of the camera
        if (S.admire) { view.orbit.azT = 0.36 + Math.sin(S.time * 0.22) * 0.32; view.orbit.distT = view.orbit.fit * 0.94; }
        view.updateCamera(dt);
        // held object follows its target pose
        const h = S.held;
        if (h) {
          if (h.dirty && S.time - h.lastCalc > 0.07) computeSettle();
          const pose = heldBodyPose(h);
          const g = h.obj.vis.group, k = 1 - Math.exp(-dt * 16);
          let q = pose.q;
          if (h.spin) { h.spin.t += dt; const e = Math.min(1, h.spin.t / 0.18); q = qMul(qAxis(h.spin.axis[0], h.spin.axis[1], h.spin.axis[2], -h.spin.ang * (1 - U.easeOut(e))), pose.q); if (e >= 1) h.spin = null; }
          const sh = h.shake > 0 ? Math.sin(S.time * 60) * h.shake * 0.35 : 0; h.shake = Math.max(0, h.shake - dt * 3);
          g.position.x += (pose.p[0] + sh - g.position.x) * k; g.position.y += (pose.p[1] - g.position.y) * k; g.position.z += (pose.p[2] - g.position.z) * k;
          const cq = [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w], nq = h.spin ? q : qSlerp(cq, q, Math.min(1, k * 1.4));
          g.quaternion.set(nq[0], nq[1], nq[2], nq[3]);
          // feedback glow pulses gently
          view.glowWall(S.glow, S.glow ? 0.55 + 0.45 * Math.sin(S.time * 5) : 0);
        } else view.glowWall(null, 0);
        stepAnims(dt);
        // shelf: slots, momentum and a gentle turn so each piece reads as 3D
        const tr = S.objs.filter(o => o.state === 'tray');
        const maxScroll = Math.max(0, (tr.length - 1) * 10 - (view.view.trayRect.w / view.tray.slotPx - 1) * 10);
        if (!drag || drag.kind !== 'tray' || drag.mode !== 'scroll') { view.tray.scroll += (S.trayV || 0) * dt; S.trayV = (S.trayV || 0) * Math.exp(-dt * 5); }
        view.tray.scroll = clamp(view.tray.scroll, 0, maxScroll);
        tr.forEach((o, i) => {
          const tx = i * 10; o.trayX += (tx - o.trayX) * (1 - Math.exp(-dt * 10));
          const g = o.trayGroup, f = o.trayFit * o.scale;
          o.trayYaw = 0.5 + Math.sin(S.time * 0.5 + o.k * 1.7) * 0.32;
          g.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.trayYaw);
          const off = new THREE.Vector3(o.trayOff[0], o.trayOff[1], o.trayOff[2]).multiplyScalar(f).applyQuaternion(g.quaternion);
          g.position.set(o.trayX + off.x, off.y, off.z);
        });
        stepGen(S.waitingFor != null ? 30 : 5);
        if (S.waitingFor != null && S.next && S.nextFor === S.waitingFor) { const i = S.waitingFor; S.waitingFor = null; $('.olt-preparing').classList.remove('on'); goLevel(i); }
        audio.tickBed(dtMs, S.objs.length ? S.objs.filter(o => o.state === 'placed').length / S.objs.length : 0);
        if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) setToast(''); }
        if (S.time - lastHud > 0.25) {
          lastHud = S.time;
          const left = S.clockLimit ? S.clockLimit - S.elapsed : 0;
          $('.olt-time').textContent = S.clockLimit ? fmtTime(left) : (S.started ? fmtTime(S.elapsed) : '');
          $('.olt-time').classList.toggle('urgent', !!S.clockLimit && left < 20);
        }
        updateLabels();
      },
      render() {
        if (disposed || !S.lv) return;
        view.render();
        if (!S.firstFrame) {
          S.firstFrame = true;
          $('.olt-boot').classList.add('gone');
          try { ctx.markVisualReady('drawer'); ctx.platform.ready(); } catch (e) { }
        }
      },
    });

    // ---------- go ----------
    await Promise.race([fontsReady, new Promise(r => ctx.timeout(r, 1200))]);
    if (disposed) return;
    let startAt = Math.min(store.get('current', 0) | 0, Math.max(prefs.unlocked, 0));
    try {
      if (ctx.game && ctx.game.progress) {
        const saved = await Promise.race([ctx.game.progress.load('main'), new Promise(r => ctx.timeout(() => r(null), 900))]);
        if (saved && saved.resumeEligible === true && saved.state && Number.isInteger(saved.state.level)) startAt = Math.max(0, Math.min(saved.state.level, Math.max(prefs.unlocked, startAt)));
      }
    } catch (e) { }
    if (disposed) return;
    if (startAt >= Levels.count) { goLevel(Levels.count - 1 >= 0 ? startAt : 0); if (!S.lv) loadLevel(levelByIndex(Levels.count - 1)); }
    else goLevel(startAt);

    function devSolve(n) {
      if (S.held) cancelHeld(false);
      const used = new Set();
      S.lv.solution.slice(0, n == null ? 99 : n).forEach(sol => {
        const o = S.objs.find(o => o.def.id === sol.id && !used.has(o)); used.add(o);
        setState(o, 'placed', { p: sol.p, q: sol.q });
      });
      updateHud(); checkComplete();
    }
    if (DEV) window.__olt = { devSolve, G, S, view, World, Catalog, Levels, Packer, place, grab, rotateHeld, liftHeld, returnToTray, doUndo, goLevel, computeSettle, layout, L, setState, loadLevel, heldBodyPose, markDirty, audio };
  },
};

const ICON = {
  turn: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5c0 2.4 3.4 4.3 7.5 4.3s7.5-1.9 7.5-4.3-3.4-4.3-7.5-4.3"/><path d="M10 6.3l2.4 1.9-2 2.3"/><path d="M12 3v18" stroke-dasharray="1.5 2.5"/></svg>',
  tip: '<svg viewBox="0 0 24 24"><path d="M12 19.5c-4.1 0-7.5-3.4-7.5-7.5S7.9 4.5 12 4.5"/><path d="M10.2 2.6l2.2 1.9-2 2.3"/><path d="M3 12h18" stroke-dasharray="1.5 2.5"/></svg>',
  roll: '<svg viewBox="0 0 24 24"><path d="M12 4.5c4.1 0 7.5 3.4 7.5 7.5s-3.4 7.5-7.5 7.5"/><path d="M13.8 2.6l-2.2 1.9 2 2.3"/><circle cx="12" cy="12" r="1.6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
  place: '<svg viewBox="0 0 24 24"><path d="M12 4v10"/><path d="M8 10.5l4 4 4-4"/><path d="M5 19.5h14"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7L4.5 11 9 15"/><path d="M5 11h9a5 5 0 010 10h-3"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M5 9h14l-1.3 10.5H6.3z"/><path d="M8.5 9V6.5h7V9"/></svg>',
  view: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="w" d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/><path class="x" d="M16 9.5l5 5m0-5l-5 5"/></svg>',
  hand: '<svg viewBox="0 0 40 40"><path d="M15 34c-3-3-7-8-7-10 0-1.6 2-2 3.4-.6L14 26V9.5a2 2 0 014 0V20l.2-3a2 2 0 014 .1V20a2 2 0 014 0v1.2a2 2 0 014 0V27c0 4-2 7-5 7z" fill="#efe4cc" stroke="#3a2418" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

const HUD_HTML = `
<style>
.olt{font-family:'Nunito Sans',system-ui,sans-serif;color:#3a2418;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.olt *{box-sizing:border-box}
.olt button{pointer-events:auto;font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.olt svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.olt-boot{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;transition:opacity .6s;background:transparent;text-align:center;padding:0 32px}
.olt-boot.gone{opacity:0;pointer-events:none}
.olt-boot-t{font-family:'DM Serif Display',Georgia,serif;font-size:34px;letter-spacing:.5px}
.olt-boot-s{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:19px;opacity:.8}
.olt-top{position:absolute;top:calc(var(--top) + 6px);left:calc(16px + var(--sl));right:calc(16px + var(--sr));display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none}
.olt-title{line-height:1}
.olt-no{font-family:'DM Serif Display',Georgia,serif;font-size:28px;letter-spacing:.3px}
.olt-name{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;margin-left:8px}
.olt-sub{margin-top:5px;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;opacity:.72;display:flex;gap:10px}
.olt-time.urgent{color:#b8371f;opacity:1}
.olt-icons{display:flex;gap:6px}
.olt-ib{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:15px 13px 16px 12px;border:1.5px solid rgba(58,36,24,.55);background:rgba(244,236,218,.72)}
.olt-sound .x{display:none}.olt-sound.off .x{display:inline}.olt-sound.off .w{display:none}
.olt-toast{position:absolute;left:24px;right:24px;top:calc(var(--row) - 46px);text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;line-height:1.15;opacity:0;transform:translateY(4px);transition:opacity .25s,transform .25s;pointer-events:none;text-shadow:0 0 8px rgba(239,228,204,.95),0 0 3px rgba(239,228,204,.95)}
.olt-toast.on{opacity:1;transform:none}.olt-toast.bad{color:#a8331c}.olt-toast.hint{color:#3a2418}
.olt-row{position:absolute;left:calc(10px + var(--sl));right:calc(10px + var(--sr));top:var(--row);height:58px;display:flex;align-items:center;justify-content:center;gap:4px}
.olt-row .grp{display:flex;gap:4px;align-items:center}
.olt-b{min-width:46px;height:52px;padding:0 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border-radius:14px 12px 15px 11px;border:1.5px solid rgba(58,36,24,.5);background:rgba(244,236,218,.8)}
.olt-b span{font-size:9px;letter-spacing:1.1px;text-transform:uppercase;opacity:.8}
.olt-b b{font-weight:700;font-size:13px}
.olt-b:disabled{opacity:.35}
.olt-b.on{background:#3a2418;color:#efe4cc}
.olt-b.primary{background:#3a2418;color:#f4ead4;min-width:62px}
.olt-lift{display:flex;flex-direction:column;align-items:center;gap:2px}
.olt-lift .olt-b{height:25px;min-width:40px;border-radius:10px}
.olt-lift .olt-b svg{width:18px;height:18px}
.olt-lift-v{font-size:9px;letter-spacing:1px;text-transform:uppercase;opacity:.7;position:absolute;margin-top:-12px}
.olt .when-held{display:none}.olt.holding .when-held{display:flex}.olt.holding .when-free{display:none}
.olt-shelf{position:absolute;left:0;right:0;top:var(--tray);bottom:var(--trayb);pointer-events:none;border-top:1.5px solid rgba(58,36,24,.35);background:linear-gradient(rgba(214,196,160,.42),rgba(214,196,160,.15))}
.olt-shelf:before{content:'';position:absolute;left:0;right:0;top:3px;border-top:1px solid rgba(58,36,24,.18)}
.olt.overtray .olt-shelf{background:linear-gradient(rgba(201,142,47,.35),rgba(201,142,47,.12))}
.olt-shelf-cap{position:absolute;left:calc(16px + var(--sl));top:6px;font-size:10px;letter-spacing:1.8px;text-transform:uppercase;opacity:.65}
.olt.holding .olt-shelf-cap{opacity:.9;color:#7a4a14}
.olt-labels{position:absolute;left:0;right:0;top:calc(var(--labels) - 4px);height:30px;pointer-events:none;overflow:hidden}
.olt-label{position:absolute;left:0;top:0;width:84px;margin-left:-42px;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-size:13.5px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.olt-label i{display:block;font-size:10px;font-family:'Nunito Sans',sans-serif;font-style:normal;letter-spacing:1.3px;opacity:.55;margin-bottom:1px}
.olt-result,.olt-menu,.olt-preparing{position:absolute;left:calc(16px + var(--sl));right:calc(16px + var(--sr));pointer-events:none;opacity:0;visibility:hidden;transform:translateY(12px);transition:opacity .35s,transform .35s,visibility 0s linear .35s}
.olt-result:not(.on) *,.olt-menu:not(.on) *,.olt-preparing:not(.on) *{pointer-events:none !important}
.olt-result.on,.olt-menu.on,.olt-preparing.on{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .35s,transform .35s,visibility 0s}
.olt-card{background:#f4ecd9;border:1.5px solid rgba(58,36,24,.7);border-radius:20px 16px 22px 15px;padding:14px 16px 12px;box-shadow:0 10px 30px rgba(74,48,32,.22)}
.olt-result{bottom:calc(var(--trayb) + 8px)}
.olt-r-title{font-family:'DM Serif Display',Georgia,serif;font-size:24px}
.olt-r-name{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;margin-top:2px}
.olt-r-stars{position:absolute;right:20px;top:18px;font-size:18px;letter-spacing:3px;color:rgba(58,36,24,.2)}.olt-r-stars .on{color:#c98e2f}
.olt-r-rows{margin:10px 0 2px;padding-top:8px;border-top:1px solid rgba(58,36,24,.25);display:flex;justify-content:space-between;gap:6px}
.olt-r-rows div{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.olt-r-rows b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:22px;line-height:1.1}
.olt-r-rows span{font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;opacity:.65;white-space:nowrap}
.olt-r-status{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:16px;margin-top:6px}
.olt-rank{font-size:10px;letter-spacing:1.2px;text-transform:uppercase;min-height:12px;margin:4px 0 0;opacity:.6}
.olt-actions{display:flex;gap:8px;margin-top:8px}
.olt-actions button{flex:1;height:46px;border-radius:14px 12px 15px 11px;border:1.5px solid rgba(58,36,24,.6);font-weight:700;font-size:14px;letter-spacing:.4px}
.olt-actions .primary{background:#3a2418;color:#f4ead4}
.olt-again{position:absolute;right:calc(16px + var(--sr));top:calc(var(--row) + 6px);display:none}
.olt-again.on{display:flex}
.olt-menu{top:calc(var(--top) + 58px);max-height:calc(var(--tray) - var(--top) - 40px);overflow:auto}
.olt-menu h3{margin:0 0 8px;font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:22px}
.olt-levels{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.olt-levels button{display:flex;align-items:center;gap:8px;text-align:left;height:40px;padding:0 10px;border:1.2px solid rgba(58,36,24,.4);border-radius:12px 10px 13px 9px;background:rgba(255,250,238,.5)}
.olt-levels button b{font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:18px;min-width:20px}
.olt-levels button i{font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.olt-levels button.cur{background:#3a2418;color:#f4ead4}
.olt-levels button.done b:after{content:' ✦';font-size:11px;color:#c98e2f}
.olt-levels button:disabled{opacity:.4}
.olt-levels .endless{grid-column:1 / -1}
.olt-menu-row{display:flex;gap:8px;margin-top:10px}
.olt-menu-row button{flex:1;min-height:42px;border:1.2px solid rgba(58,36,24,.5);border-radius:12px 10px 13px 9px;font-size:13px;padding:4px 8px}
.olt-menu-row button b{display:block;font-size:13px}
.olt-menu-row button span{display:block;font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:.65}
.olt-help{margin-top:10px;font-family:'Cormorant Garamond',Georgia,serif;font-size:16px;line-height:1.3}
.olt-help b{font-family:'Nunito Sans',sans-serif;font-size:12px}
.olt-preparing{top:calc(var(--row) - 60px);text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px}
.olt-coach{position:absolute;pointer-events:none;opacity:0;transition:opacity .4s}
.olt-coach *{pointer-events:none}
.olt.coach1 .olt-coach.c1,.olt.coach2 .olt-coach.c2{opacity:1}
.olt-coach .pill{position:absolute;white-space:nowrap;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:19px;background:rgba(244,236,218,.92);border:1.3px solid rgba(58,36,24,.5);border-radius:14px;padding:4px 12px}
.olt-coach.c1{left:0;right:0;top:0;bottom:0}
.olt-coach.c1 .pill{left:50%;transform:translateX(-50%);top:calc(var(--row) - 40px)}
.olt-coach.c1 .hand{position:absolute;left:calc(var(--sl) + 30px);top:calc(var(--tray) + 30px);width:40px;height:40px;animation:olt-hand 2.6s ease-in-out infinite}
.olt-coach.c1 .hand svg{width:40px;height:40px}
@keyframes olt-hand{0%{transform:translate(0,0);opacity:0}12%{opacity:1}55%{transform:translate(110px,-220px);opacity:1}75%{opacity:0}100%{transform:translate(110px,-220px);opacity:0}}
.olt-coach.c2{left:0;right:0;top:calc(var(--row) - 42px)}
.olt-coach.c2 .pill{left:50%;transform:translateX(-50%)}
</style>
<div class="olt-boot"><div class="olt-boot-t">One Last Thing</div><div class="olt-boot-s">opening the drawer…</div></div>
<div class="olt-shelf"><div class="olt-shelf-cap">The collection</div></div>
<div class="olt-labels"></div>
<div class="olt-top">
  <div class="olt-title"><span class="olt-no">No. 1</span><span class="olt-name"></span><div class="olt-sub"><span class="olt-count"></span><span class="olt-time"></span></div></div>
  <div class="olt-icons"><button class="olt-ib olt-sound" aria-label="Sound">${ICON.sound}</button><button class="olt-ib olt-menu-btn" aria-label="Drawers and options">${ICON.menu}</button></div>
</div>
<div class="olt-toast"></div>
<div class="olt-row">
  <div class="grp when-free">
    <button class="olt-b olt-undo" aria-label="Undo">${ICON.undo}<span>Undo</span></button>
    <button class="olt-b olt-reset" aria-label="Empty the drawer">${ICON.reset}<span>Empty</span></button>
    <button class="olt-b olt-view" aria-label="Reset view">${ICON.view}<span>View</span></button>
  </div>
  <div class="grp when-held">
    <button class="olt-b olt-turn" aria-label="Turn">${ICON.turn}<span>Turn</span></button>
    <button class="olt-b olt-tip" aria-label="Tip">${ICON.tip}<span>Tip</span></button>
    <button class="olt-b olt-roll" aria-label="Roll">${ICON.roll}<span>Roll</span></button>
    <button class="olt-b olt-fine" aria-label="Rotation step"><b>90°</b><span>step</span></button>
    <div class="olt-lift"><button class="olt-b olt-up" aria-label="Raise">${ICON.up}</button><button class="olt-b olt-down" aria-label="Lower">${ICON.down}</button></div>
    <button class="olt-b primary olt-place" aria-label="Place">${ICON.place}<span>Place</span></button>
  </div>
</div>
<span class="olt-lift-v" style="display:none"></span>
<button class="olt-back" style="display:none"></button>
<div class="olt-coach c1"><div class="hand">${ICON.hand}</div><div class="pill">Drag a piece up into the drawer</div></div>
<div class="olt-coach c2"><div class="pill">Turn, tip or roll it until it fits</div></div>
<div class="olt-preparing olt-card">Finding a drawer that everything fits in…</div>
<button class="olt-b olt-again" aria-label="Show results">${ICON.view}<span>Results</span></button>
<div class="olt-result olt-card">
  <div class="olt-r-title"></div><div class="olt-r-name"></div><div class="olt-r-stars"></div>
  <div class="olt-r-rows"></div><div class="olt-r-status"></div><div class="olt-rank"></div>
  <div class="olt-actions"><button class="olt-admire">Admire</button><button class="primary olt-next">Next drawer</button></div>
</div>
<div class="olt-menu olt-card">
  <h3>Drawers</h3>
  <div class="olt-levels"></div>
  <div class="olt-menu-row"><button class="olt-mode"><span>Mode</span><b>Fit everything</b></button><button class="olt-restart"><span>This drawer</span><b>Start again</b></button></div>
  <div class="olt-help"><b>DRAG</b> a piece from the shelf into the drawer · <b>TAP</b> a placed piece to pick it up · <b>TWIST</b> two fingers to turn it · <b>TURN / TIP / ROLL</b> rotate a quarter turn (or 15°) · <b>▲▼</b> raise or lower it under an overhang · <b>DRAG</b> empty space to look around, <b>PINCH</b> to zoom. Every drawer has been solved before you see it.</div>
  <div class="olt-menu-row"><button class="olt-menu-close"><b>Back to the drawer</b></button></div>
</div>
`;
