// ScoreManager and the collection: streak, bests, discovered themes, studies
// progress and the leaderboard records. Independent of rendering and puzzle logic.

// v2: the intersection puzzle. Results from the first (alignment) prototype are
// not comparable, so they are left behind rather than merged.
const PROFILE_KEY = 'orbit.profile.v2';

function emptyProfile() {
  return { v: 2, rev: 0, muted: false, seenIntro: false, streak: { count: 0, best: 0, last: 0 }, daily: {}, levels: { reached: 1, best: {} }, coll: [] };
}

function validProfile(p) {
  return p && p.v === 2 && typeof p.rev === 'number' && p.streak && typeof p.streak.count === 'number' &&
    p.daily && typeof p.daily === 'object' && p.levels && typeof p.levels.reached === 'number' && Array.isArray(p.coll);
}

// Merge two valid profiles without losing anything either side earned.
function mergeProfiles(a, b) {
  if (!validProfile(a)) return b;
  if (!validProfile(b)) return a;
  const out = emptyProfile();
  out.rev = Math.max(a.rev, b.rev);
  const newer = a.rev >= b.rev ? a : b;
  out.muted = newer.muted; out.seenIntro = a.seenIntro || b.seenIntro;
  const sa = a.streak, sb = b.streak;
  out.streak = sa.last > sb.last ? Object.assign({}, sa) : sb.last > sa.last ? Object.assign({}, sb) : { count: Math.max(sa.count, sb.count), best: 0, last: sa.last };
  out.streak.best = Math.max(sa.best || 0, sb.best || 0, out.streak.count);
  const better = (x, y) => !x ? y : !y ? x : (x[1] < y[1] || (x[1] === y[1] && x[0] <= y[0])) ? x : y;
  Object.keys(a.daily).concat(Object.keys(b.daily)).forEach(k => { out.daily[k] = better(a.daily[k], b.daily[k]); });
  out.levels.reached = Math.max(a.levels.reached, b.levels.reached);
  Object.keys(a.levels.best || {}).concat(Object.keys(b.levels.best || {})).forEach(k => { out.levels.best[k] = better((a.levels.best || {})[k], (b.levels.best || {})[k]); });
  const seen = {};
  a.coll.concat(b.coll).forEach(k => { if (typeof k === 'string' && !seen[k]) { seen[k] = 1; out.coll.push(k); } });
  return trimProfile(out);
}

// Keep the saved state well inside the 8 KB limit.
function trimProfile(p) {
  const trim = (obj, keep) => { const ks = Object.keys(obj).map(Number).sort((x, y) => y - x); ks.slice(keep).forEach(k => delete obj[k]); };
  trim(p.daily, 45);
  trim(p.levels.best, 30);
  if (p.coll.length > 520) p.coll = p.coll.slice(p.coll.length - 520);
  return p;
}

function createScoreManager(ctx) {
  const caps = ctx.capabilities || {};
  const M = { profile: emptyProfile(), cloud: 'pending', listeners: [], disposed: false };
  ctx.onDestroy(() => { M.disposed = true; });

  // Device cache first: instant, synchronous, used for the first frame.
  try {
    if (caps.storage && ctx.storage) {
      const p = ctx.storage.get(PROFILE_KEY);
      if (validProfile(p)) M.profile = trimProfile(p);
    }
  } catch (e) { }

  let localChan = null;
  try { localChan = ctx.memory && ctx.memory.local ? ctx.memory.local('profile') : null; } catch (e) { localChan = null; }

  // Cloud hydrate. A failed read is not an empty profile: we keep working
  // locally and do not write over the account's saved state.
  M.hydrate = function () {
    if (!localChan) { M.cloud = 'unavailable'; return Promise.resolve(false); }
    return localChan.get().then(res => {
      if (M.disposed) return false;
      const v = res && res.value;
      if (v && validProfile(v)) M.profile = mergeProfiles(M.profile, v);
      M.cloud = 'ready';
      M.emit();
      return true;
    }).catch(err => {
      if (M.disposed) return false;
      M.cloud = 'failed';
      try { ctx.platform.error({ stage: 'profile_load', message: String(err && err.message || err) }); } catch (e) { }
      return false;
    });
  };

  let saveSeq = 0, saving = false, again = false;
  function cloudSave() {
    if (!localChan || M.cloud !== 'ready' || M.disposed) return;
    if (saving) { again = true; return; }
    saving = true;
    const snapshot = JSON.parse(JSON.stringify(M.profile));
    localChan.set(snapshot).catch(err => {
      try { ctx.platform.error({ stage: 'profile_save', message: String(err && err.message || err) }); } catch (e) { }
    }).then(() => {
      saving = false;
      if (again && !M.disposed) { again = false; cloudSave(); }
    });
  }
  M.save = function (immediate) {
    M.profile.rev++;
    trimProfile(M.profile);
    try { if (caps.storage && ctx.storage) ctx.storage.set(PROFILE_KEY, M.profile); } catch (e) { }
    // Coalesce cloud writes; only the latest scheduled save runs.
    const token = ++saveSeq;
    ctx.timeout(() => { if (token === saveSeq) cloudSave(); }, immediate ? 50 : 1500);
  };

  M.on = function (fn) { M.listeners.push(fn); };
  M.emit = function () { M.listeners.forEach(fn => { try { fn(M.profile); } catch (e) { } }); };

  M.currentStreak = function (today) {
    const s = M.profile.streak;
    return s.last === today || s.last === today - 1 ? s.count : 0;
  };
  M.dailyResult = function (day) { return M.profile.daily[day] || null; };
  M.bestDailyTime = function () {
    let best = null;
    Object.keys(M.profile.daily).forEach(k => { const d = M.profile.daily[k]; if (best === null || d[1] < best) best = d[1]; });
    return best;
  };
  M.hasTheme = function (key) { return M.profile.coll.indexOf(key) >= 0; };

  // Record a finished daily. Returns what changed, for the completion screen.
  M.completeDaily = function (day, moves, timeMs, hints, themeKey, stars) {
    const p = M.profile;
    const prevBest = M.bestDailyTime();
    const first = !p.daily[day];
    if (first) {
      const s = p.streak;
      if (s.last === day - 1) s.count += 1; else if (s.last !== day) s.count = 1;
      s.last = day;
      s.best = Math.max(s.best, s.count);
      p.daily[day] = [moves, timeMs, hints, stars || 0];
    }
    const newTheme = M.addTheme(themeKey);
    M.save(true);
    return { first, streak: p.streak.count, bestStreak: p.streak.best, prevBest, isBest: first && (prevBest === null || timeMs < prevBest), newTheme };
  };
  M.completeLevel = function (level, moves, timeMs, themeKey, stars) {
    const p = M.profile;
    const prev = p.levels.best[level];
    if (!prev || timeMs < prev[1]) p.levels.best[level] = [moves, timeMs, 0, stars || 0];
    p.levels.reached = Math.max(p.levels.reached, level + 1);
    const newTheme = M.addTheme(themeKey);
    M.save(true);
    return { newTheme, prev };
  };
  M.addTheme = function (key) {
    if (M.hasTheme(key)) return false;
    M.profile.coll.push(key);
    return true;
  };
  M.setFlag = function (name, v) { if (M.profile[name] !== v) { M.profile[name] = v; M.save(false); } };

  // ---- Leaderboard records ----------------------------------------------------
  // solve_time: fastest daily solve (asc). streak: longest daily streak (desc).
  let attempt = 0;
  M.newAttempt = function () { attempt++; return attempt; };
  function rec(id) { try { return ctx.memory && ctx.memory.record ? ctx.memory.record(id) : null; } catch (e) { return null; } }

  M.submitDaily = function (timeMs, moves, day, streak, onResult) {
    const owner = attempt;
    const r = rec('solve_time');
    if (!r) { onResult({ error: 'unavailable' }); return; }
    r.submit(Math.round(timeMs), { label: fmtTime(timeMs), metadata: { edition: day, moves } }).then(res => {
      if (M.disposed || owner !== attempt) return;
      onResult({ submitted: true, res });
      return r.leaderboard({ scope: 'global', period: 'daily', limit: 3 }).then(board => {
        if (M.disposed || owner !== attempt) return;
        onResult({ board });
      });
    }).catch(err => {
      if (M.disposed || owner !== attempt) return;
      onResult({ error: err && (err.code || err.message) || 'failed' });
    });
    const s = rec('streak');
    if (s && streak > 0) s.submit(streak, { label: streak + (streak === 1 ? ' day' : ' days') }).catch(err => {
      try { ctx.platform.error({ stage: 'streak_submit', message: String(err && err.message || err) }); } catch (e) { }
    });
  };
  M.readBest = function (onResult) {
    const owner = attempt;
    const r = rec('solve_time');
    if (!r || !r.rank) return;
    r.rank({ scope: 'global', period: 'all_time' }).then(st => {
      if (M.disposed || owner !== attempt) return;
      onResult(st && st.viewerRank ? st.viewerRank.value : null);
    }).catch(() => { });
  };
  return M;
}
