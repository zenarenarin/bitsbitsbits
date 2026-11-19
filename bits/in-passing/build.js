// Concatenate src/*.js into the single-file Plethora entry (main.js).
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const body = files.map(f => `// ---- ${f} ----\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const out = `// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md\n// IN PASSING — built from src/ by build.js; edit the sources, not this file.\nwindow.plethoraBit = (function () {\n'use strict';\n${body}\nreturn BIT;\n})();\n`;
fs.writeFileSync(path.join(__dirname, 'main.js'), out);
console.log('main.js', out.length, 'bytes from', files.length, 'files');
