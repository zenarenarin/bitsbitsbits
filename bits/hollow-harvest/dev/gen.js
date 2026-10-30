// Endless generation check: 20 km of field per seed. Memory stays bounded, no obstacle sits inside a
// hiding place, obstacles are spaced for reaction, and cover is never too far apart.  node dev/gen.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = ['00_core.js', '01_world.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const c = {}; vm.createContext(c); vm.runInContext(src + '\nthis.createWorld = createWorld; this.clamp = clamp;', c);
let overlaps = 0, maxLive = 0, maxHideGap = 0, minObsGap = 99;
for (let seed = 1; seed <= 20; seed++) {
  const w = c.createWorld(seed), all = new Map();
  for (let d = 0; d < 20000; d += 5) {
    w.update(d, c.clamp((d / 7 - 15) / 70, 0, 1), Math.min(3, Math.floor(d / 140)));
    maxLive = Math.max(maxLive, w.feats.length + w.props.length);
    for (const f of w.feats) all.set(f.k + f.x0.toFixed(3), { k: f.k, x0: f.x0, x1: f.x1 });
  }
  const L = [...all.values()].sort((a, b) => a.x0 - b.x0), hides = L.filter(f => f.k === 'hide');
  let lastHide = 0, lastObs = -99;
  for (const f of L) {
    if (f.k === 'hide') { maxHideGap = Math.max(maxHideGap, f.x0 - lastHide); lastHide = f.x1; }
    else {
      minObsGap = Math.min(minObsGap, f.x0 - lastObs); lastObs = f.x1;
      if (hides.some(h => f.x1 > h.x0 && f.x0 < h.x1)) overlaps++;
    }
  }
}
const ok = !overlaps && maxHideGap < 62 && minObsGap >= 5.9 && maxLive < 80;
console.log({ maxLive, maxHideGap: +maxHideGap.toFixed(1), minObsGap: +minObsGap.toFixed(1), overlaps }, ok ? 'OK' : 'FAIL');
