// Step through a plan printing every eye's world angle and state after each step.
// usage: node dev/trace.js <id> [plan]
const L = require('./load')('createSim, ENCOUNTERS, buildEncounter');
const { runPlan } = require('./policy');
const key = process.argv[2], id = parseInt(key), PL = require('./plans')[key], name = process.argv[3] || Object.keys(PL)[0];
const ctx = key.endsWith('cw') ? { habit: { dir: -1 } } : {};
const S = L.createSim(L.buildEncounter(L.ENCOUNTERS.find(e => e.id === id), ctx));
const d = x => Math.round(require('./load')().wrap(x) * 180 / Math.PI);
PL[name].forEach((st, i) => {
  runPlan(S, [st]);
  console.log(String(i).padStart(2), JSON.stringify(st).slice(0, 34).padEnd(34), `t=${S.t.toFixed(1)} P${S.P.k}@${d(S.playerTheta())} exp=${S.P.exposure.toFixed(2)}`, S.eyes.map(e => `${e.name}:${e.k}@${d(S.eyeTheta(e))}${e.state[0]}${e.type === 'sentinel' ? '>' + d(e.aim) : ''}`).join(' '), S.over ? 'OVER ' + S.over.type : S.reached ? 'REACHED' : '');
});
