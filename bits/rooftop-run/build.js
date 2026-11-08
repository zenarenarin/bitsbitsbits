// Concatenate src/*.js into the single-file Plethora entry (main.js).
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const body = files.map(f => `// ---- ${f} ----\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
// Binary assets (Bits cannot ship files): each assets/<name>.glb becomes a
// base64 constant ASSET_<NAME> at the top of the bundle.
const adir = path.join(__dirname, 'assets');
const assets = fs.existsSync(adir) ? fs.readdirSync(adir).filter(f => f.endsWith('.glb')).sort() : [];
const assetJs = assets.map(f => `const ASSET_${f.replace(/\.glb$/, '').replace(/\W/g, '_').toUpperCase()} = '${fs.readFileSync(path.join(adir, f)).toString('base64')}';`).join('\n');
const out = `// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md\n// THE LAST SIGNAL — a 3D rooftop traversal game for Plethora.\n// Built from src/ by build.js; edit the sources, not this file.\n(function () {\n'use strict';\n${assetJs}\n${body}\n})();\n`;
fs.writeFileSync(path.join(__dirname, 'main.js'), out);
console.log('main.js', out.length, 'bytes from', files.join(', ') + (assets.length ? ' + assets ' + assets.join(', ') : ''));
