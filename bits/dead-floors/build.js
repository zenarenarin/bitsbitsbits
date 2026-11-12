// Concatenate src/*.js into the single-file Plethora entry (main.js).
// Every part runs inside init(ctx), so they share one scope.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const body = files.map(f => `// ---- ${f} ----\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const out = `// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// DEAD FLOORS — an endless first-person zombie shooter for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
window.plethoraBit = {
  meta: {},
  async init(ctx) {
${body}
  }
};
})();
`;
fs.writeFileSync(path.join(__dirname, 'main.js'), out);
console.log('main.js', out.length, 'bytes from', files.join(', '));
