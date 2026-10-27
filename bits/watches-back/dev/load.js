// Load the pure-JS simulation modules (no three.js, no DOM) for headless tests.
const fs = require('fs'), path = require('path');
module.exports = function load(extra) {
  const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => /^0[0-3]_/.test(f)).sort();
  const src = files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
  return new Function(src + '\nreturn {' + (extra || 'createSim, RULES, EYE_TYPES, ST, HELD, DEG, wrap, SIM_DT') + '};')();
};
