// Load the simulation (no rendering) into Node for tests.
const fs = require('fs'), path = require('path');
module.exports = function load() {
  const dir = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(dir).filter(f => /^0[0-9]_.*\.js$/.test(f)).sort();
  const body = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const fn = new Function(body + '\nreturn { ENCOUNTERS, createWorld, stepWorld, setGaze, SIM_DT, ST, PLAYER, los, playerHead, gazeLosTo, supportAt, signalApi };');
  return fn();
};
