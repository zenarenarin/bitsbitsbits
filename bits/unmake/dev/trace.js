const fs = require('fs'), path = require('path');
const src = ['01_core.js', '02_encounters.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const api = new Function(src + '\nreturn { PATTERNS, validateSegment, simulateSolution, buildSegment, World, makeRng, Builder, PHYS, travSpeed };')();
const [name, solIdx = 0, seed = 1000, d = 0] = process.argv.slice(2);
const w = new api.World({ headless: true });
new api.Builder(w, -8, -1, api.makeRng(1), +d).deck(0, 8);
const meta = api.buildSegment(w, name, +seed, +d, 0, 0);
new api.Builder(w, meta.len, 1, api.makeRng(2), +d).deck(0, 10);
const tr = w.makeTraveller(-3, 0, api.travSpeed(+d));
const sol = meta.solutions[+solIdx]; const pending = sol.steps.slice();
let lastLog = -1;
while (w.t < 25) {
  for (let i = pending.length - 1; i >= 0; i--) { const st = pending[i]; const ok = st.atS !== undefined ? tr.s >= st.atS : st.when(w, meta.keys, tr); if (ok) { console.log(w.t.toFixed(2), 'ERASE', st.erase, !!w.erase(meta.keys[st.erase])); pending.splice(i, 1); } }
  w.step(api.PHYS.DT);
  for (const ev of w.events) if (!['wait', 'go'].includes(ev.type)) console.log(w.t.toFixed(2), 'EV', ev.type, ev.obj ? (ev.obj.key || ev.obj.kind) : '', ev.tag ? 'tag' + ev.tag.id + ':' + ev.tag.count : '', ev.reason || '');
  w.events.length = 0;
  if (Math.floor(w.t * 2) !== lastLog) { lastLog = Math.floor(w.t * 2);
    const ks = Object.entries(meta.keys).filter(([k, o]) => o.kind === 'plank' || o.kind === 'weight').map(([k, o]) => o.kind === 'plank' ? `${k}:ang${o.ang.toFixed(2)}${o.held ? 'H' : ''}` : `${k}:${o.state}@${o.cx.toFixed(1)},${o.cy.toFixed(1)}${o.gone ? 'X' : ''}`).join(' ');
    console.log(w.t.toFixed(2), `trav s=${tr.s.toFixed(2)} y=${tr.y.toFixed(2)} ${tr.state} ${tr.waitReason}`, ks); }
  if (tr.state === 'dead' || tr.s > meta.len + 1) { console.log('END', tr.state, tr.deathReason || ''); break; }
}
