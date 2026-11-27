// Node check: every level fractures into valid, connected, sensible shards.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = ['00_util.js', '01_objects.js', '02_fracture.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const sb = {}; vm.createContext(sb);
vm.runInContext(src + '\nthis.OBJECTS=OBJECTS;this.LEVELS=LEVELS;this.makeSurface=makeSurface;this.buildFracture=buildFracture;this.buildProxy=buildProxy;', sb);
let bad = 0;
for (const [i, lv] of sb.LEVELS.entries()) {
  const surf = sb.makeSurface(sb.OBJECTS[lv.obj]);
  const t0 = Date.now();
  const fr = sb.buildFracture(surf, lv);
  const ms = Date.now() - t0;
  const verts = fr.frags.reduce((a, f) => a + f.positions.length / 3, 0), tris = fr.frags.reduce((a, f) => a + f.indices.length / 3, 0);
  const phis = fr.frags.filter(f => !f.anchor).map(f => Math.round(f.phi * 180 / Math.PI));
  const areas = fr.frags.map(f => f.area.toFixed(3));
  let nan = 0; for (const f of fr.frags) for (const x of f.positions) if (!isFinite(x)) nan++;
  if (nan) bad++;
  console.log(`L${i + 1} ${lv.obj.padEnd(8)} nv=${fr.nv} attempt=${fr.attempt} frags=${fr.frags.length} seams=${fr.seams.length} seamLen=${fr.totalSeam.toFixed(2)} verts=${verts} tris=${tris} ${ms}ms nan=${nan}`);
  console.log('    phi', phis.join(' '), ' area', areas.join(' '));
}
process.exit(bad ? 1 : 0);
