// Load the pure simulation modules (no rendering) into Node for tests and the level solver.
const fs = require('fs'), path = require('path');
module.exports = function load() {
  const dir = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(dir).filter(f => /^0[0-4]_|^08_/.test(f)).sort();
  const src = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const names = ['U', 'G', 'World', 'Catalog', 'Packer', 'Levels'];
  const ret = '\nreturn {' + names.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',') + '};';
  return new Function(src + ret)();
};
