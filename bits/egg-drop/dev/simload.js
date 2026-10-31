// Load the physics core in Node for headless tests.
const fs = require('fs'), path = require('path'), vm = require('vm');
const pl = require('./vendor/planck.min.js');
const srcs = ['00_sim.js', '01_disturb.js'].map(f => path.join(__dirname, '..', 'src', f)).filter(f => fs.existsSync(f));
const sandbox = { Math, console };
vm.createContext(sandbox);
for (const f of srcs) vm.runInContext(fs.readFileSync(f, 'utf8') + '\n;this.createSim=typeof createSim!=="undefined"?createSim:undefined;this.SURFACES=typeof SURFACES!=="undefined"?SURFACES:undefined;this.GEOM=typeof GEOM!=="undefined"?GEOM:undefined;this.createDisturbance=typeof createDisturbance!=="undefined"?createDisturbance:undefined;', sandbox, { filename: f });
module.exports = { pl, createSim: sandbox.createSim, SURFACES: sandbox.SURFACES, GEOM: sandbox.GEOM, createDisturbance: sandbox.createDisturbance };
