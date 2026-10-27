// Endless: for many run seeds and depths, every spiral handed to the player must be
// start-safe and either bot-validated or a proven campaign spiral. Also reports cost.
const L = require('./load')('createSim, makeEndlessDef, generateEndless, botRun, startSafe, ENCOUNTERS, buildEncounter');
const seeds = +(process.argv[2] || 6), maxDepth = +(process.argv[3] || 20);
let pass = 0, total = 0, bot = 0, fallback = 0, worst = 0, sum = 0, n = 0;
const check = (name, c, info) => { total++; if (c) pass++; else console.log('FAIL ' + name + ' ' + JSON.stringify(info || {})); };
const types = {};
for (let s = 1; s <= seeds; s++) for (let d = 1; d <= maxDepth; d++) {
  const t0 = process.hrtime.bigint();
  const def = L.makeEndlessDef(d, s * 31337);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  worst = Math.max(worst, ms); sum += ms; n++;
  def.validated === 'bot' ? bot++ : fallback++;
  for (const e of def.eyes) types[e.type] = (types[e.type] || 0) + 1;
  check(`seed ${s} depth ${d} start is safe`, L.startSafe(def));
  if (def.validated === 'bot') { check(`seed ${s} depth ${d} bot can reach the centre`, L.botRun(def, 75).ok); if (d >= 3) check(`seed ${s} depth ${d} cannot be crossed without looking`, !L.botRun(def, 75, true).ok); }
}
console.log(`bot-validated ${bot}, campaign fallback ${fallback}; generation ms avg ${(sum / n).toFixed(1)} worst ${worst.toFixed(0)}`);
console.log('eye types used:', JSON.stringify(types));
console.log(pass + '/' + total + ' endless checks');
process.exit(pass === total ? 0 : 1);
