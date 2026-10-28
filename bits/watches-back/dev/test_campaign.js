// Every encounter: the solution must win; the naive attempt must not.
const api = require('./simload')();
const bot = require('./bot');
const SOL = require('./solutions');
const only = process.argv[2];
let fail = 0;
for (const def of api.ENCOUNTERS) {
  if (only && def.id !== only) continue;
  const s = SOL[def.id];
  if (!s) { console.log(def.id, 'NO SOLUTION'); fail++; continue; }
  const r = bot(api, def, s.solve, { trace: !!only });
  const line = [def.id, def.name.padEnd(24), r.ok ? 'SOLVED' : 'FAILED(' + r.W.status + ' step ' + r.step + ')', 't=' + r.W.t.toFixed(1)];
  if (!r.ok) fail++;
  if (s.naive) { const n = bot(api, def, s.naive, { maxT: 60 }); line.push('naive:' + (n.ok ? 'WON(!)' : n.W.status)); if (n.ok) fail++; }
  console.log(line.join('  '));
  if (only) console.log(r.log.join('\n'));
}
process.exit(fail ? 1 : 0);
